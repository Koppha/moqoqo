// Cardless ATM withdrawal. Creating one holds amount + fee in the ATM system wallet and gives the customer a code;
// at the ATM the cash comes out (held money leaves the system, the fee goes to EcoCash Super App fees). Unused codes expire and
// the held money goes back to the wallet.
import { ATM_CODE_MINUTES, ATM_NOTE, type AtmWithdrawal } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, notFound, validation } from '../errors'
import { hashToken, newId, randomDigits } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { checkPin } from './pins'
import { feesAccount, getTariff } from './tariff'
import type { UserRow } from './users'

/** The ATM holding wallet (users.kind 'system'). Ensured by db/seed.ts ensureBillers. */
export const ATM_ACCOUNT = { name: 'EcoCash ATM', biller: 'atm' } as const
const MAX_WRONG_CODES = 3

interface Row {
  id: string
  reference: string
  user_id: string
  amount_cents: number
  fee_cents: number
  code: string
  code_hash: string
  status: AtmWithdrawal['status']
  wrong_tries: number
  atm: string | null
  created_at: Date
  expires_at: Date
  redeemed_at: Date | null
}

const toWithdrawal = (r: Row, owner: boolean): AtmWithdrawal => {
  const w: AtmWithdrawal = {
    id: r.id, reference: r.reference, amount: fromCents(r.amount_cents), fee: fromCents(r.fee_cents), status: r.status,
    expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
  }
  if (owner && r.status === 'active') w.code = r.code
  if (r.redeemed_at) w.redeemedAt = iso(r.redeemed_at)
  if (r.atm) w.atm = r.atm
  return w
}

async function atmAccount(q: Queryable): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [ATM_ACCOUNT.biller])
  if (!u) throw notFound('ATM account missing (seed not run?)')
  return u
}

const codeHash = (id: string, code: string) => hashToken(`${id}:${code}`)

export async function createWithdrawal(ctx: Ctx, me: UserRow, body: { amount: number; pin: string; clientId: string }): Promise<AtmWithdrawal> {
  const [dup] = await ctx.db.query<Row>('SELECT * FROM atm_withdrawals WHERE user_id = $1 AND client_id = $2', [me.id, body.clientId])
  if (dup) return toWithdrawal(dup, true)
  const amountCents = paymentCents(body.amount)
  if (amountCents % (ATM_NOTE * 100) !== 0) throw validation(`ATMs pay out in M${ATM_NOTE} notes: choose a multiple of M${ATM_NOTE}`)
  const tariff = await getTariff(ctx.db)
  if (amountCents > tariff.atmMax * 100) throw new AppError('LIMIT_EXCEEDED', `The most you can take out at an ATM is ${formatM(tariff.atmMax * 100)}`)
  const feeCents = Math.round(tariff.atmFee * 100)
  await checkPin(ctx.db, me, body.pin)
  const id = newId()
  const code = randomDigits(8)
  return ctx.tx(async (q, out) => {
    const atm = await atmAccount(q)
    const [row] = await q.query<Row>(
      `INSERT INTO atm_withdrawals (id, user_id, client_id, amount_cents, fee_cents, code_hash, code, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8)) RETURNING *`,
      [id, me.id, body.clientId, amountCents, feeCents, codeHash(id, code), code, ATM_CODE_MINUTES],
    )
    const held = await ctx.ledger.transfer(q, {
      kind: 'atm', fromUserId: me.id, toUserId: atm.id, amountCents: amountCents + feeCents,
      label: `ATM withdrawal ${row.reference}${feeCents ? ` (incl. fee ${formatM(feeCents)})` : ''}`,
    })
    for (const [userId, cents] of held.balances) out.balance(userId, cents)
    return toWithdrawal(row, true)
  })
}

export async function myWithdrawals(q: Queryable, me: UserRow): Promise<AtmWithdrawal[]> {
  const rows = await q.query<Row>('SELECT * FROM atm_withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [me.id])
  return rows.map((r) => toWithdrawal(r, true))
}

/** Gives the held amount + fee back (cancelled by the customer, or expired). Inside a transaction, row locked. */
async function giveBack(ctx: Ctx, q: Queryable, out: Outbox, r: Row, status: 'cancelled' | 'expired'): Promise<Row> {
  const atm = await atmAccount(q)
  const back = await ctx.ledger.transfer(q, {
    kind: 'atm_refund', fromUserId: atm.id, toUserId: r.user_id, amountCents: Number(r.amount_cents) + Number(r.fee_cents),
    label: `ATM withdrawal ${r.reference} ${status === 'expired' ? 'expired' : 'cancelled'}: money back`,
  })
  for (const [userId, cents] of back.balances) out.balance(userId, cents)
  const [updated] = await q.query<Row>(`UPDATE atm_withdrawals SET status = $2, closed_at = now() WHERE id = $1 RETURNING *`, [r.id, status])
  return updated
}

export async function cancelWithdrawal(ctx: Ctx, me: UserRow, id: string): Promise<AtmWithdrawal> {
  return ctx.tx(async (q, out) => {
    const [r] = await q.query<Row>('SELECT * FROM atm_withdrawals WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, me.id])
    if (!r) throw notFound('Withdrawal not found')
    if (r.status !== 'active') throw new AppError('CONFLICT', r.status === 'redeemed' ? 'The cash was already taken out' : 'This withdrawal is already closed')
    return toWithdrawal(await giveBack(ctx, q, out, r, 'cancelled'), true)
  })
}

/** Money back for every code past its time. Run by the sweeper. */
export async function expireWithdrawals(ctx: Ctx): Promise<number> {
  const due = await ctx.db.query<{ id: string }>(`SELECT id FROM atm_withdrawals WHERE status = 'active' AND expires_at <= now()`)
  for (const { id } of due) {
    await ctx.tx(async (q, out) => {
      const [r] = await q.query<Row>(`SELECT * FROM atm_withdrawals WHERE id = $1 AND status = 'active' FOR UPDATE`, [id])
      if (!r) return
      // The refund itself sends the money-in alert ("… expired: money back").
      await giveBack(ctx, q, out, r, 'expired')
    })
  }
  return due.length
}

/**
 * At the ATM (the ATM switch; for now the portal's ATM simulator): number + code + amount. Three wrong codes close
 * the withdrawal and give the money back.
 */
export async function redeem(ctx: Ctx, body: { msisdn: string; code: string; amount: number; atm: string }): Promise<AtmWithdrawal> {
  const msisdn = normalizeMsisdn(body.msisdn)
  const amountCents = paymentCents(body.amount)
  const result = await ctx.tx(async (q, out) => {
    const rows = await q.query<Row>(
      `SELECT w.* FROM atm_withdrawals w JOIN users u ON u.id = w.user_id
       WHERE u.msisdn = $1 AND w.status = 'active' AND w.expires_at > now() ORDER BY w.created_at FOR UPDATE OF w`,
      [msisdn],
    )
    if (!rows.length) return { error: 'No withdrawal is waiting for this number' }
    const r = rows.find((x) => x.code_hash === codeHash(x.id, body.code.trim()))
    if (!r) {
      // Count the wrong code against the oldest active one.
      const first = rows[0]
      const [after] = await q.query<Row>('UPDATE atm_withdrawals SET wrong_tries = wrong_tries + 1 WHERE id = $1 RETURNING *', [first.id])
      if (after.wrong_tries >= MAX_WRONG_CODES) {
        await giveBack(ctx, q, out, after, 'cancelled')
        out.notify({ userIds: [first.user_id], category: 'security', title: 'ATM withdrawal stopped', body: `A wrong code was entered ${MAX_WRONG_CODES} times for ${first.reference}, so it was cancelled and the money is back in your wallet.` })
      }
      return { error: 'Wrong code' }
    }
    if (Number(r.amount_cents) !== amountCents) return { error: `The amount must be ${formatM(Number(r.amount_cents))}` }
    const atm = await atmAccount(q)
    const fees = await feesAccount(q)
    // The cash leaves the system; the fee goes to EcoCash Super App.
    await ctx.ledger.transfer(q, { kind: 'atm', fromUserId: atm.id, toUserId: null, amountCents: Number(r.amount_cents), label: `ATM cash ${r.reference} · ${body.atm}` })
    if (Number(r.fee_cents) > 0) await ctx.ledger.transfer(q, { kind: 'fee', fromUserId: atm.id, toUserId: fees.id, amountCents: Number(r.fee_cents), label: `ATM fee ${r.reference}` })
    const [done] = await q.query<Row>(`UPDATE atm_withdrawals SET status = 'redeemed', redeemed_at = now(), closed_at = now(), atm = $2 WHERE id = $1 RETURNING *`, [r.id, body.atm])
    out.notify({ userIds: [r.user_id], category: 'money', title: 'Cash withdrawn', body: `${formatM(Number(r.amount_cents))} taken out at ${body.atm} (${r.reference}). If this wasn't you, call EcoCash customer care now.`, data: { screen: 'transactions' } })
    return { done }
  })
  if ('error' in result) throw validation(result.error ?? 'Refused')
  return toWithdrawal(result.done, false)
}

export function createAtmSweeper(ctx: Ctx, everyMs = 30_000) {
  let timer: NodeJS.Timeout | null = null
  const sweep = () => expireWithdrawals(ctx).catch((err) => ctx.log.error({ err }, 'atm sweep failed'))
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
