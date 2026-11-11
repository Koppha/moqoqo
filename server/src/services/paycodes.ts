// Pay merchant: the customer's one-time payment code (Quick Pay), and paying a person by their receive QR.
import {
  PAYCODE_DIGITS,
  PAYCODE_TTL_SECONDS,
  type Me,
  type MoneyResult,
  type PayCode,
  type Payee,
  type PaymentIntent,
  type PayPersonBody,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { hashToken, newId, randomDigits } from '../lib/crypto'
import { paymentCents } from '../lib/money'
import { iso } from '../lib/time'
import { ensurePairChat, postMessage } from './chats'
import { merchantIntentRow, requireTerminalPin, settleIntent } from './intents'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { getUser, toMe, type UserRow } from './users'

/** Payment codes start with 62 so a scanner can tell them from other barcodes; the rest is random. */
const PREFIX = '62'

export async function enableQuickPay(ctx: Ctx, me: UserRow, pin: string): Promise<Me> {
  await checkPin(ctx.db, me, pin)
  const [u] = await ctx.db.query<UserRow>('UPDATE users SET quick_pay_at = COALESCE(quick_pay_at, now()) WHERE id = $1 RETURNING *', [me.id])
  return toMe(u)
}

export async function disableQuickPay(ctx: Ctx, me: UserRow): Promise<Me> {
  return ctx.tx(async (q) => {
    await q.query('DELETE FROM pay_codes WHERE user_id = $1 AND used_at IS NULL', [me.id])
    const [u] = await q.query<UserRow>('UPDATE users SET quick_pay_at = NULL WHERE id = $1 RETURNING *', [me.id])
    return toMe(u)
  })
}

/** A fresh code. Earlier unused codes stay valid until they expire, so a refresh mid-scan doesn't fail the sale. */
export async function issuePayCode(ctx: Ctx, me: UserRow): Promise<PayCode> {
  if (!me.quick_pay_at) throw forbidden('Turn on Quick Pay first')
  // Housekeeping: spent and expired codes are of no further use.
  await ctx.db.query(`DELETE FROM pay_codes WHERE user_id = $1 AND expires_at < now() - interval '1 hour'`, [me.id])
  for (let attempt = 0; ; attempt++) {
    const code = PREFIX + randomDigits(PAYCODE_DIGITS - PREFIX.length)
    try {
      const [row] = await ctx.db.query<{ expires_at: Date }>(
        `INSERT INTO pay_codes (code_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) RETURNING expires_at`,
        [hashToken(code), me.id, PAYCODE_TTL_SECONDS],
      )
      return { code, expiresAt: iso(row.expires_at) }
    } catch (err) {
      if ((err as { code?: string }).code === '23505' && attempt < 4) continue
      throw err
    }
  }
}

const invalidCode = () => notFound('This payment code is invalid or expired. Ask the customer to refresh it')

/** Merchant terminal scanned a customer's payment code: the code's owner pays the intent. */
export async function payCodeIntent(ctx: Ctx, merchant: UserRow, id: string, body: { code: string; pin?: string }): Promise<PaymentIntent> {
  const code = body.code.replace(/\s/g, '')
  if (!new RegExp(`^\\d{${PAYCODE_DIGITS}}$`).test(code)) throw validation(`code must be ${PAYCODE_DIGITS} digits`)
  const hash = hashToken(code)
  const row = await merchantIntentRow(ctx.db, merchant, id)
  const [owner] = await ctx.db.query<UserRow>(
    `SELECT u.* FROM pay_codes c JOIN users u ON u.id = c.user_id
     WHERE c.code_hash = $1 AND c.used_at IS NULL AND c.expires_at > now() AND u.quick_pay_at IS NOT NULL AND u.kind = 'person'`,
    [hash],
  )
  if (!owner) throw invalidCode()
  if (owner.status === 'suspended') throw new AppError('SUSPENDED', "The customer's wallet is suspended")
  if (owner.id === merchant.id) throw validation('You cannot pay yourself')
  requireTerminalPin(row, body.pin)
  if (body.pin !== undefined) await checkPin(ctx.db, owner, body.pin)
  // Spend the code in the payment's own transaction: of two terminals scanning the same code, one wins.
  const claim = async (q: Queryable) => {
    const spent = await q.query(
      `UPDATE pay_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING code_hash`,
      [hash],
    )
    if (!spent.length) throw invalidCode()
  }
  return (await settleIntent(ctx, owner, id, 'paycode', merchant.id, claim)).intent
}

// ---------- a person's receive QR ----------

/** +26662000021 → +266 62•• ••21 (same as the app). */
const mask = (msisdn: string) => {
  const local = msisdn.replace(/^\+266/, '')
  return `+266 ${local.slice(0, 2)}•• ••${local.slice(-2)}`
}

async function requirePayee(q: Queryable, id: string): Promise<UserRow> {
  const u = await getUser(q, id)
  if (!u || u.kind !== 'person' || !u.msisdn || u.status === 'suspended') throw notFound('This QR code is no longer valid')
  return u
}

export async function payee(ctx: Ctx, id: string): Promise<Payee> {
  const u = await requirePayee(ctx.db, id)
  return { id: u.id, name: u.name, maskedMsisdn: mask(u.msisdn!) }
}

/** Pays the owner of a receive QR; the money message lands in their direct chat, created if needed. */
export async function payPerson(ctx: Ctx, me: UserRow, body: PayPersonBody): Promise<MoneyResult> {
  const amountCents = paymentCents(body.amount)
  const note = body.note?.trim() || null
  if (note && note.length > 140) throw validation('note must be at most 140 characters')
  const to = await requirePayee(ctx.db, body.toUserId)
  if (to.id === me.id) throw validation('You cannot pay yourself')
  await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    const { chatId } = await ensurePairChat(q, out, me.id, to.id, { creatorId: me.id })
    // Retries with the same clientId return the first result instead of paying twice.
    const [dup] = await q.query<{ id: string }>('SELECT id FROM messages WHERE chat_id = $1 AND sender_id = $2 AND client_id = $3', [
      chatId,
      me.id,
      body.clientId,
    ])
    if (dup) throw conflict('This payment was already sent')
    const messageId = newId()
    const result = await ctx.ledger.transfer(q, { kind: 'send', fromUserId: me.id, toUserId: to.id, amountCents, note, messageId })
    const message = await postMessage(q, out, { id: messageId, chatId, senderId: me.id, clientId: body.clientId, kind: 'money', amountCents, note })
    for (const [userId, cents] of result.balances) out.balance(userId, cents)
    return moneyResult(q, me, result, message)
  })
}
