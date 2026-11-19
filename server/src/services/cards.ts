// Saved cards and card → wallet top-ups. Contract: shared/api.ts "money in and out".
import type { AddCardBody, Card, CardBrand, Topup, TopupBody, TopupResult, TopupStart, TopupStatus } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso, startOfMaseruDay } from '../lib/time'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { cardTopupFeeCents, getTariff } from './tariff'
import type { UserRow } from './users'
import { openText, sealText } from '../lib/vault'

export const MAX_CARDS = 10
export const TOPUP_TTL_MINUTES = 10
export const MAX_OTP_ATTEMPTS = 3

const BRAND_NAME: Record<CardBrand, string> = { visa: 'Visa', mastercard: 'Mastercard' }
/** "Visa •• 4242" */
export const cardLabel = (c: { brand: CardBrand; last4: string }) => `${BRAND_NAME[c.brand]} •• ${c.last4}`

interface CardRow {
  id: string
  user_id: string
  gateway_token: string
  brand: CardBrand
  last4: string
  exp_month: number
  exp_year: number
  holder_name: string
  created_at: Date
  removed_at: Date | null
}

const toCard = (c: CardRow): Card => ({
  id: c.id,
  brand: c.brand,
  last4: c.last4,
  expMonth: c.exp_month,
  expYear: c.exp_year,
  holderName: c.holder_name,
  createdAt: iso(c.created_at),
})

// ---------- cards ----------

export async function listCards(q: Queryable, me: UserRow): Promise<Card[]> {
  const rows = await q.query<CardRow>('SELECT * FROM cards WHERE user_id = $1 AND removed_at IS NULL ORDER BY created_at DESC, id DESC', [me.id])
  return rows.map(toCard)
}

export async function addCard(ctx: Ctx, me: UserRow, body: AddCardBody): Promise<Card> {
  const [{ n }] = await ctx.db.query<{ n: number }>('SELECT count(*) AS n FROM cards WHERE user_id = $1 AND removed_at IS NULL', [me.id])
  if (n >= MAX_CARDS) throw validation(`You can save up to ${MAX_CARDS} cards. Remove one first`)
  // Two-digit years ("28") are read as 20xx.
  const expYear = body.expYear >= 0 && body.expYear < 100 ? 2000 + body.expYear : body.expYear
  // The number and CVV go to the gateway only; nothing but the token, brand, last 4 and expiry is kept.
  const tok = await ctx.cards.tokenize({ ...body, expYear })
  const [row] = await ctx.db.query<CardRow>(
    `INSERT INTO cards (id, user_id, gateway_token, brand, last4, exp_month, exp_year, holder_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [newId(), me.id, sealText(tok.token), tok.brand, tok.last4, body.expMonth, expYear, body.holderName.trim().replace(/\s+/g, ' ')],
  )
  return toCard(row)
}

export async function removeCard(q: Queryable, me: UserRow, id: string): Promise<void> {
  const rows = await q.query('UPDATE cards SET removed_at = now() WHERE id = $1 AND user_id = $2 AND removed_at IS NULL RETURNING id', [id, me.id])
  if (!rows.length) throw notFound('Card not found')
}

// ---------- top-ups ----------

interface TopupRow {
  id: string
  reference: string
  user_id: string
  card_id: string
  amount_cents: number
  fee_cents: number
  status: TopupStatus
  otp_attempts: number
  failure_reason: string | null
  gateway_ref: string | null
  client_id: string
  transaction_id: string | null
  created_at: Date
  expires_at: Date
  completed_at: Date | null
  // joined
  brand: CardBrand
  last4: string
}

const TOPUP_SELECT = `SELECT t.*, c.brand, c.last4 FROM card_topups t JOIN cards c ON c.id = t.card_id`

const isExpired = (t: TopupRow) => t.status === 'pending_otp' && new Date(t.expires_at).getTime() <= Date.now()

function toTopup(t: TopupRow): Topup {
  const status: TopupStatus = isExpired(t) ? 'expired' : t.status
  const r: Topup = {
    id: t.id,
    reference: t.reference,
    card: { id: t.card_id, brand: t.brand, last4: t.last4 },
    amount: fromCents(t.amount_cents),
    fee: fromCents(t.fee_cents),
    charged: fromCents(t.amount_cents + t.fee_cents),
    status,
    createdAt: iso(t.created_at),
  }
  if (t.failure_reason) r.failureReason = t.failure_reason
  return r
}

async function loadTopup(q: Queryable, where: string, params: unknown[]): Promise<TopupRow | null> {
  const [row] = await q.query<TopupRow>(`${TOPUP_SELECT} WHERE ${where}`, params)
  return row ?? null
}

/** Completed and still-pending top-ups today (Maseru day), in cents. */
async function topupsToday(q: Queryable, userId: string): Promise<number> {
  const [{ used }] = await q.query<{ used: number }>(
    `SELECT COALESCE(sum(amount_cents), 0) AS used FROM card_topups
     WHERE user_id = $1 AND created_at >= $2 AND (status = 'completed' OR (status = 'pending_otp' AND expires_at > now()))`,
    [userId, startOfMaseruDay()],
  )
  return used
}

function checkDaily(used: number, amountCents: number, dailyCents: number) {
  if (used + amountCents <= dailyCents) return
  const left = Math.max(0, dailyCents - used)
  throw new AppError('LIMIT_EXCEEDED', `Card top-ups are limited to ${formatM(dailyCents)} a day. You can still top up ${formatM(left)} today`)
}

export async function startTopup(ctx: Ctx, me: UserRow, body: TopupBody): Promise<{ start: TopupStart; created: boolean }> {
  const amountCents = paymentCents(body.amount)
  const [card] = await ctx.db.query<CardRow>('SELECT * FROM cards WHERE id = $1 AND user_id = $2 AND removed_at IS NULL', [body.cardId, me.id])
  if (!card) throw notFound('Card not found')
  await checkPin(ctx.db, me, body.pin)

  // Retries with the same clientId get the original top-up back.
  const existing = await loadTopup(ctx.db, 't.user_id = $1 AND t.client_id = $2', [me.id, body.clientId])
  if (existing) return { start: { topup: toTopup(existing), otpHint: ctx.cards.otpHint }, created: false }

  const tariff = await getTariff(ctx.db)
  if (amountCents > Math.round(tariff.cardTopupMax * 100)) {
    throw new AppError('LIMIT_EXCEEDED', `The most you can top up at once is ${formatM(Math.round(tariff.cardTopupMax * 100))}`)
  }
  const dailyCents = Math.round(tariff.dailyMax * 100)
  // Checked before the gateway starts a charge, and again under the wallet lock below.
  checkDaily(await topupsToday(ctx.db, me.id), amountCents, dailyCents)
  const feeCents = cardTopupFeeCents(tariff, amountCents)
  const charge = await ctx.cards.startCharge(openText(card.gateway_token), amountCents + feeCents)

  const row = await ctx.tx(async (q) => {
    // One top-up start at a time per wallet, so the daily limit cannot be raced.
    await q.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [me.id])
    const dup = await loadTopup(q, 't.user_id = $1 AND t.client_id = $2', [me.id, body.clientId])
    if (dup) return dup
    checkDaily(await topupsToday(q, me.id), amountCents, dailyCents)
    const id = newId()
    await q.query(
      `INSERT INTO card_topups (id, user_id, card_id, amount_cents, fee_cents, gateway_ref, client_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8))`,
      [id, me.id, card.id, amountCents, feeCents, charge.gatewayRef, body.clientId, TOPUP_TTL_MINUTES],
    )
    return (await loadTopup(q, 't.id = $1', [id]))!
  })
  return { start: { topup: toTopup(row), otpHint: charge.otpHint }, created: true }
}

/**
 * Completes a pending top-up with the card holder's one-time code. The row is locked FOR UPDATE, so concurrent
 * confirms are serialised and only one can credit the wallet. Status changes that come with an error (wrong code,
 * expired, declined) are committed first and the error is thrown afterwards.
 */
export async function confirmTopup(ctx: Ctx, me: UserRow, id: string, otp: string): Promise<TopupResult> {
  const outcome = await ctx.tx(async (q, out): Promise<{ error: AppError } | { result: TopupResult }> => {
    const t = await loadTopup(q, 't.id = $1 AND t.user_id = $2 FOR UPDATE OF t', [id, me.id])
    if (!t) throw notFound('Top-up not found')
    if (t.status === 'completed') throw conflict('This top-up is already completed')
    if (t.status === 'failed') throw conflict('This top-up failed. Start a new one')
    if (t.status === 'expired') throw conflict('This top-up has expired. Start a new one')
    if (isExpired(t)) {
      await q.query(`UPDATE card_topups SET status = 'expired' WHERE id = $1`, [id])
      return { error: conflict('This top-up has expired. Start a new one') }
    }

    // Mock gateway call inside the transaction (row locked). A real gateway confirms over the network; the lock
    // still guarantees one credit per top-up.
    const res = await ctx.cards.confirmCharge(t.gateway_ref ?? '', otp)
    if (res.status === 'wrong_code') {
      const attempts = t.otp_attempts + 1
      const left = MAX_OTP_ATTEMPTS - attempts
      if (left <= 0) {
        await q.query(`UPDATE card_topups SET otp_attempts = $2, status = 'failed', failure_reason = 'Too many wrong codes' WHERE id = $1`, [id, attempts])
        return { error: validation('Wrong code. No tries left: start a new top-up') }
      }
      await q.query('UPDATE card_topups SET otp_attempts = $2 WHERE id = $1', [id, attempts])
      return { error: validation(`Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left`) }
    }
    if (res.status === 'declined') {
      await q.query(`UPDATE card_topups SET status = 'failed', failure_reason = $2 WHERE id = $1`, [id, res.reason])
      return { error: new AppError('CARD_DECLINED', res.reason) }
    }

    const result = await ctx.ledger.transfer(q, {
      kind: 'topup',
      fromUserId: null,
      toUserId: me.id,
      amountCents: t.amount_cents,
      label: `Card top-up · ${cardLabel(t)}`,
    })
    await q.query(`UPDATE card_topups SET status = 'completed', transaction_id = $2, completed_at = now() WHERE id = $1`, [id, result.tx.id])
    for (const [userId, cents] of result.balances) out.balance(userId, cents)
    const fresh = (await loadTopup(q, 't.id = $1', [id]))!
    return { result: { topup: toTopup(fresh), money: await moneyResult(q, me, result) } }
  })
  if ('error' in outcome) throw outcome.error
  return outcome.result
}
