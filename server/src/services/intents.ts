// Payment intents ("Receive money" on a merchant terminal) and NFC tags.
import {
  INTENT_TTL_MINUTES,
  NO_PIN_TAP_LIMIT,
  type CreateIntentBody,
  type MoneyResult,
  type NfcTag,
  type PaymentIntent,
  type PublicUser,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { TransactionRow } from '../ecocash/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { newId, randomDigits } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { moneyResult, payMerchantInTx } from './money'
import { checkPin } from './pins'
import { toTransaction } from './transactions'
import { displayName, getUser, getUsers, toPublicUser, type UserRow } from './users'

export type IntentMethod = 'qr' | 'code' | 'tap' | 'paycode'

interface IntentRow {
  id: string
  code: string
  merchant_id: string
  amount_cents: number
  note: string | null
  status: PaymentIntent['status']
  created_at: Date
  expires_at: Date
  paid_by: string | null
  method: IntentMethod | null
  transaction_id: string | null
  purpose: PaymentIntent['purpose']
}

export const merchantView = (u: UserRow): PublicUser & { code: string } => ({ ...toPublicUser(u), code: u.code ?? '' })

async function toIntent(q: Queryable, r: IntentRow): Promise<PaymentIntent> {
  const users = await getUsers(q, [r.merchant_id, r.paid_by].filter((x): x is string => !!x))
  const merchant = users.get(r.merchant_id)!
  // Open intents past their expiry read as expired even before the sweeper marks them.
  const status = r.status === 'open' && new Date(r.expires_at).getTime() <= Date.now() ? 'expired' : r.status
  const intent: PaymentIntent = {
    id: r.id,
    code: r.code,
    purpose: r.purpose,
    merchant: merchantView(merchant),
    amount: fromCents(r.amount_cents),
    status,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
  }
  if (r.note) intent.note = r.note
  if (r.paid_by && users.get(r.paid_by)) intent.paidBy = toPublicUser(users.get(r.paid_by)!)
  if (r.method) intent.method = r.method
  if (r.transaction_id) {
    const [tx] = await q.query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [r.transaction_id])
    if (tx) intent.transaction = toTransaction(tx, r.merchant_id, users)
  }
  return intent
}

/** Marks overdue open intents expired and queues intent.updated for their merchants. */
export async function expireDueIntents(q: Queryable, out: Outbox): Promise<number> {
  const rows = await q.query<IntentRow>(
    `UPDATE payment_intents SET status = 'expired', updated_at = now() WHERE status = 'open' AND expires_at <= now() RETURNING *`,
  )
  for (const r of rows) out.to([r.merchant_id], { type: 'intent.updated', intent: await toIntent(q, r) })
  return rows.length
}

/** Periodic sweep (every 15 s with the config watcher) so terminals see expiry without polling. */
export function createIntentSweeper(ctx: Ctx, everyMs = 15_000) {
  let timer: NodeJS.Timeout | null = null
  const sweep = () => ctx.tx((q, out) => expireDueIntents(q, out)).catch((err) => ctx.log.error({ err }, 'intent sweep failed'))
  return {
    sweep,
    start() {
      timer = setInterval(() => void sweep(), everyMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}

// ---------- merchant ----------

/** A sale request (merchant) or a cash-out request (agent): `purpose` follows the creator's role. */
export async function createIntent(ctx: Ctx, merchant: UserRow, body: CreateIntentBody): Promise<PaymentIntent> {
  const amountCents = paymentCents(body.amount)
  const note = body.note?.trim() || null
  const purpose: PaymentIntent['purpose'] = merchant.role === 'agent' ? 'cashout' : 'sale'
  if (note && note.length > 140) throw validation('note must be at most 140 characters')
  if (!merchant.code) throw validation(`This ${merchant.role} has no code`)
  for (let attempt = 0; ; attempt++) {
    try {
      return await ctx.tx(async (q, out) => {
        await expireDueIntents(q, out) // frees codes of expired intents
        let code = ''
        for (let i = 0; i < 20; i++) {
          code = randomDigits(6)
          const [taken] = await q.query(`SELECT 1 FROM payment_intents WHERE code = $1 AND status = 'open'`, [code])
          if (!taken) break
        }
        const [row] = await q.query<IntentRow>(
          `INSERT INTO payment_intents (id, code, merchant_id, amount_cents, note, purpose, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) RETURNING *`,
          [newId(), code, merchant.id, amountCents, note, purpose, INTENT_TTL_MINUTES],
        )
        return toIntent(q, row)
      })
    } catch (err) {
      // Two terminals drew the same code at the same instant: the unique index refused one; draw again.
      if ((err as { code?: string }).code === '23505' && attempt < 4) continue
      throw err
    }
  }
}

export async function merchantIntentRow(q: Queryable, merchant: UserRow, id: string, lock = false): Promise<IntentRow> {
  const [row] = await q.query<IntentRow>(`SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, merchant.id])
  if (!row) throw notFound('Payment not found')
  return row
}

export async function getMerchantIntent(ctx: Ctx, merchant: UserRow, id: string): Promise<PaymentIntent> {
  return ctx.tx(async (q, out) => {
    const row = await merchantIntentRow(q, merchant, id)
    if (row.status === 'open' && new Date(row.expires_at).getTime() <= Date.now()) await expireDueIntents(q, out)
    return toIntent(q, (await merchantIntentRow(q, merchant, id))!)
  })
}

export async function cancelIntent(ctx: Ctx, merchant: UserRow, id: string): Promise<PaymentIntent> {
  const intent = await ctx.tx(async (q, out) => {
    const row = await merchantIntentRow(q, merchant, id, true)
    const current = (await toIntent(q, row)).status
    if (current !== 'open') throw conflict(`This payment is already ${current}`)
    const [u] = await q.query<IntentRow>(`UPDATE payment_intents SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`, [id])
    const intent = await toIntent(q, u)
    out.to([merchant.id], { type: 'intent.updated', intent })
    return intent
  })
  return intent
}

// ---------- customer ----------

export async function lookupIntent(ctx: Ctx, query: { id?: string; code?: string; business?: string }): Promise<PaymentIntent> {
  if (query.business) {
    // The agent's or merchant's own code (AGENT-0101): their newest open request.
    const [row] = await ctx.db.query<IntentRow>(
      `SELECT i.* FROM payment_intents i JOIN users u ON u.id = i.merchant_id
       WHERE u.code = $1 AND i.status = 'open' AND i.expires_at > now() ORDER BY i.created_at DESC LIMIT 1`,
      [query.business.trim().toUpperCase()],
    )
    if (!row) throw notFound(`${query.business.trim().toUpperCase()} has no open payment request. Ask them to start one`)
    return toIntent(ctx.db, row)
  }
  if (!query.id && !query.code) throw validation('Give id, code or business')
  if (query.code && !/^\d{6}$/.test(query.code)) throw validation('code must be 6 digits')
  const [row] = await ctx.db.query<IntentRow>(
    `SELECT * FROM payment_intents WHERE status = 'open' AND expires_at > now() AND ${query.id ? 'id = $1' : 'code = $1'}`,
    [query.id ?? query.code],
  )
  if (!row) throw notFound('No open payment with that code. Ask the merchant for a new one')
  return toIntent(ctx.db, row)
}

const METHOD_LABEL: Record<IntentMethod, string> = { qr: 'QR payment', code: 'Paid with code', tap: 'Tap to pay', paycode: 'Payment code' }

/**
 * Pays an open intent exactly once. The intent row is locked FOR UPDATE, so of two concurrent payers one
 * wins and the other sees CONFLICT. PIN checks happen before this (outside the money transaction).
 * `claim` runs first inside the same transaction (e.g. spending a payment code), so both commit or neither.
 */
export async function settleIntent(
  ctx: Ctx,
  payer: UserRow,
  intentId: string,
  method: IntentMethod,
  merchantId?: string,
  claim?: (q: Queryable) => Promise<void>,
) {
  return ctx.tx(async (q, out) => {
    const [row] = await q.query<IntentRow>('SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE', [intentId])
    if (!row || (merchantId && row.merchant_id !== merchantId)) throw notFound('Payment not found')
    const status = (await toIntent(q, row)).status
    if (status !== 'open') throw conflict(`This payment is ${status}`)
    if (claim) await claim(q)
    const merchant = (await getUser(q, row.merchant_id))!
    const label = row.purpose === 'cashout' ? `Cash-out${merchant.code ? ` · ${merchant.code}` : ''}` : METHOD_LABEL[method]
    const { result, message } = await payMerchantInTx(
      ctx,
      q,
      out,
      payer,
      merchant,
      row.amount_cents,
      row.purpose === 'cashout' ? 'cashout' : method === 'tap' ? 'tap' : 'qr',
      row.note ? `${row.note} · ${displayName(merchant)}` : `${label} · ${displayName(merchant)}`,
    )
    const [paid] = await q.query<IntentRow>(
      `UPDATE payment_intents SET status = 'paid', paid_by = $2, method = $3, transaction_id = $4, updated_at = now() WHERE id = $1 RETURNING *`,
      [intentId, payer.id, method, result.tx.id],
    )
    const intent = await toIntent(q, paid)
    out.to([merchant.id, payer.id], { type: 'intent.updated', intent })
    return { intent, money: await moneyResult(q, payer, result, message) }
  })
}

export async function payIntent(ctx: Ctx, payer: UserRow, id: string, body: { pin: string; method: 'qr' | 'code' }): Promise<MoneyResult> {
  const [row] = await ctx.db.query<IntentRow>('SELECT * FROM payment_intents WHERE id = $1', [id])
  if (!row) throw notFound('Payment not found')
  if (row.merchant_id === payer.id) throw validation('You cannot pay yourself')
  await checkPin(ctx.db, payer, body.pin)
  return (await settleIntent(ctx, payer, id, body.method)).money
}

// ---------- NFC tags ----------

/**
 * Payments taken on the business's own device (card tap, scanned payment code): the customer types their PIN
 * there above NO_PIN_TAP_LIMIT, and always for a cash-out, since cash leaves the counter.
 */
export function requireTerminalPin(row: Pick<IntentRow, 'amount_cents' | 'purpose'>, pin: string | undefined) {
  if (pin !== undefined) return
  if (row.purpose === 'cashout') throw validation('The customer must enter their PIN to cash out')
  if (row.amount_cents > NO_PIN_TAP_LIMIT * 100) {
    throw validation(`The customer must enter their PIN for payments over ${formatM(NO_PIN_TAP_LIMIT * 100)}`)
  }
}

/**
 * SECURITY: a bare NFC tag UID is NOT a secure credential: it is readable by any phone and trivially
 * cloned/emulated. It is acceptable for this pilot only together with the NO_PIN_TAP_LIMIT cap. Production
 * needs secure-element cards (e.g. EMV/DESFire with dynamic cryptograms) or HCE tokens with per-tap cryptograms.
 */
export function normalizeTagId(raw: unknown): string {
  if (typeof raw !== 'string') throw validation('tagId must be a hex string')
  const id = raw.replace(/[\s:\-]/g, '').toUpperCase()
  if (!/^[0-9A-F]{8,20}$/.test(id)) throw validation('tagId must be 4 to 10 bytes of hex, e.g. 04A2246A8B6D80')
  return id
}

/** Merchant terminal read a customer's tag: the tag owner pays the intent. */
export async function tapIntent(ctx: Ctx, merchant: UserRow, id: string, body: { tagId: string; pin?: string }): Promise<PaymentIntent> {
  const tagId = normalizeTagId(body.tagId)
  const row = await merchantIntentRow(ctx.db, merchant, id)
  const [owner] = await ctx.db.query<UserRow>(
    `SELECT u.* FROM nfc_tags t JOIN users u ON u.id = t.user_id WHERE t.tag_id = $1 AND u.kind = 'person'`,
    [tagId],
  )
  if (!owner) throw new AppError('NOT_REGISTERED', 'This card is not linked to an EcoCash wallet')
  if (owner.status === 'suspended') throw new AppError('SUSPENDED', "The card owner's wallet is suspended")
  if (owner.id === merchant.id) throw validation('You cannot pay yourself')
  requireTerminalPin(row, body.pin)
  if (body.pin !== undefined) await checkPin(ctx.db, owner, body.pin)
  return (await settleIntent(ctx, owner, id, 'tap', merchant.id)).intent
}

interface TagRow {
  id: string
  tag_id: string
  label: string
  created_at: Date
}
const toTag = (r: TagRow): NfcTag => ({ id: r.id, tagId: r.tag_id, label: r.label, createdAt: iso(r.created_at) })

export async function listTags(q: Queryable, userId: string): Promise<NfcTag[]> {
  return (await q.query<TagRow>('SELECT * FROM nfc_tags WHERE user_id = $1 ORDER BY created_at', [userId])).map(toTag)
}

export async function addTag(q: Queryable, userId: string, body: { tagId: string; label: string }): Promise<NfcTag> {
  const tagId = normalizeTagId(body.tagId)
  const label = body.label?.trim()
  if (!label || label.length > 40) throw validation('label must be 1 to 40 characters')
  const [exists] = await q.query('SELECT 1 FROM nfc_tags WHERE tag_id = $1', [tagId])
  if (exists) throw conflict('This card is already linked to a wallet')
  const [row] = await q.query<TagRow>('INSERT INTO nfc_tags (id, tag_id, user_id, label) VALUES ($1, $2, $3, $4) RETURNING *', [
    newId(),
    tagId,
    userId,
    label,
  ])
  return toTag(row)
}

export async function deleteTag(q: Queryable, userId: string, id: string): Promise<void> {
  const rows = await q.query('DELETE FROM nfc_tags WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId])
  if (!rows.length) throw notFound('Card not found')
}
