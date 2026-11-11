// Donate: causes people give to. Contract: shared/api.ts "Donate".
// Each cause holds its money in its own system wallet, so giving and withdrawing go through the ledger (KYC, risk).
// The organiser withdraws to their own wallet; staff can suspend a cause in the portal, which stops both.
import type { AdminCause, Cause, CauseCard, CauseStatus, CreateCauseBody, DonateBody, DonateSettings, Message, MoneyResult, MyCauses } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { conflict, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso } from '../lib/time'
import { postMessage, requireMember } from './chats'
import { setSetting } from './maintenance'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { getUsers, toPublicUser, type UserRow } from './users'

interface CauseRow {
  id: string
  code: string
  organiser_id: string
  wallet_user_id: string
  title: string
  description: string
  target_cents: number
  raised_cents: number
  donor_count: number
  status: CauseStatus
  status_reason: string | null
  ends_at: Date | null
  target_told: boolean
  created_at: Date
  balance_cents: number
}

const SELECT = 'SELECT c.*, w.balance_cents FROM causes c JOIN users w ON w.id = c.wallet_user_id'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I, easy to read out

const DEFAULTS: DonateSettings = { enabled: true, minKycTier: 2, maxTarget: 50000, maxOpenPerUser: 3 }

export async function getDonateSettings(q: Queryable): Promise<DonateSettings> {
  const [row] = await q.query<{ value: Partial<DonateSettings> | null }>(`SELECT value FROM app_settings WHERE key = 'donate'`)
  const v = row?.value ?? {}
  const num = (x: unknown, d: number) => (typeof x === 'number' && x > 0 ? x : d)
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULTS.enabled,
    minKycTier: v.minKycTier === 1 || v.minKycTier === 2 ? v.minKycTier : DEFAULTS.minKycTier,
    maxTarget: num(v.maxTarget, DEFAULTS.maxTarget),
    maxOpenPerUser: num(v.maxOpenPerUser, DEFAULTS.maxOpenPerUser),
  }
}

export async function setDonateSettings(q: Queryable, s: DonateSettings): Promise<DonateSettings> {
  await setSetting(q, 'donate', s)
  return s
}

const card = (r: CauseRow): CauseCard => ({
  id: r.id,
  code: r.code,
  title: r.title,
  target: fromCents(Number(r.target_cents)),
  raised: fromCents(Number(r.raised_cents)),
  donorCount: r.donor_count,
  status: r.status,
})

async function byCode(q: Queryable, code: string): Promise<CauseRow> {
  const [r] = await q.query<CauseRow>(`${SELECT} WHERE c.code = $1`, [code.trim().toUpperCase()])
  if (!r) throw notFound('No cause with that code')
  return { ...r, balance_cents: Number(r.balance_cents) }
}

async function byId(q: Queryable, id: string, lock = false): Promise<CauseRow> {
  const [r] = await q.query<CauseRow>(`${SELECT} WHERE c.id = $1 ${lock ? 'FOR UPDATE OF c' : ''}`, [id])
  if (!r) throw notFound('Cause not found')
  return { ...r, balance_cents: Number(r.balance_cents) }
}

/** Past its end date: closes itself (read paths call this first). */
async function closeEnded(q: Queryable) {
  await q.query(`UPDATE causes SET status = 'closed', status_reason = 'Ended' WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at <= now()`)
}

async function toCause(q: Queryable, r: CauseRow, me: UserRow): Promise<Cause> {
  const rows = await q.query<{ donor_id: string; amount_cents: number; note: string | null; anonymous: boolean; created_at: Date }>(
    'SELECT donor_id, amount_cents, note, anonymous, created_at FROM donations WHERE cause_id = $1 ORDER BY created_at DESC LIMIT 30',
    [r.id],
  )
  const [{ total }] = await q.query<{ total: number }>('SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM donations WHERE cause_id = $1 AND donor_id = $2', [r.id, me.id])
  const users = await getUsers(q, [r.organiser_id, ...rows.map((d) => d.donor_id)])
  const mine = r.organiser_id === me.id
  const c: Cause = {
    ...card(r),
    description: r.description,
    organiser: toPublicUser(users.get(r.organiser_id)!),
    createdAt: iso(r.created_at),
    mine,
    myTotal: fromCents(Number(total)),
    donations: rows.map((d) => {
      const x: Cause['donations'][number] = { name: d.anonymous ? null : users.get(d.donor_id)?.name ?? null, amount: fromCents(Number(d.amount_cents)), at: iso(d.created_at) }
      if (d.note) x.note = d.note
      return x
    }),
  }
  if (r.ends_at) c.endsAt = iso(r.ends_at)
  if (r.status_reason) c.statusReason = r.status_reason
  if (mine) c.balance = fromCents(r.balance_cents)
  return c
}

// ---------- people ----------

export async function myCauses(q: Queryable, me: UserRow): Promise<MyCauses> {
  await closeEnded(q)
  const mine = await q.query<CauseRow>(`${SELECT} WHERE c.organiser_id = $1 ORDER BY (c.status = 'open') DESC, c.created_at DESC LIMIT 50`, [me.id])
  const supported = await q.query<CauseRow>(
    `${SELECT} WHERE c.id IN (SELECT cause_id FROM donations WHERE donor_id = $1) AND c.organiser_id <> $1 ORDER BY c.created_at DESC LIMIT 50`,
    [me.id],
  )
  return { mine: mine.map(card), supported: supported.map(card) }
}

export async function getCause(q: Queryable, me: UserRow, code: string): Promise<Cause> {
  await closeEnded(q)
  return toCause(q, await byCode(q, code), me)
}

async function uniqueCode(q: Queryable): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
    if (!(await q.query('SELECT 1 FROM causes WHERE code = $1', [code])).length) return code
  }
  throw conflict('Try again')
}

export async function createCause(ctx: Ctx, me: UserRow, body: CreateCauseBody): Promise<Cause> {
  const settings = await getDonateSettings(ctx.db)
  if (!settings.enabled) throw validation('Starting a cause is closed for now')
  if (me.kyc_tier < settings.minKycTier) throw forbidden('Verify your ID first (Me › Update KYC) to start a cause')
  const title = body.title.trim()
  const description = body.description.trim()
  if (title.length < 3 || title.length > 60) throw validation('The title is 3 to 60 characters')
  if (description.length < 10 || description.length > 1000) throw validation('Tell people what it is for, in 10 to 1,000 characters')
  // A target is not a payment: the per-payment limit does not apply to it.
  const targetCents = Math.round(body.target * 100)
  if (!(targetCents > 0)) throw validation('Enter a target above M0')
  if (targetCents > settings.maxTarget * 100) throw validation(`The target can be at most ${formatM(settings.maxTarget * 100)}`)
  const endsAt = body.endsAt ? new Date(body.endsAt) : null
  if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt.getTime() < Date.now() + 3600_000)) throw validation('The end date must be in the future')
  const [{ n }] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM causes WHERE organiser_id = $1 AND status = 'open'`, [me.id])
  if (n >= settings.maxOpenPerUser) throw conflict(`You already run ${n} open causes. Close one first`)
  const id = newId()
  await ctx.tx(async (q) => {
    const wallet = newId()
    await q.query(
      `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, kyc_tier) VALUES ($1, NULL, $2, 'merchant', 'system', false, $2, 2)`,
      [wallet, title],
    )
    await q.query(
      'INSERT INTO causes (id, code, organiser_id, wallet_user_id, title, description, target_cents, ends_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, await uniqueCode(q), me.id, wallet, title, description, targetCents, endsAt],
    )
  })
  return toCause(ctx.db, await byId(ctx.db, id), me)
}

export async function donate(ctx: Ctx, me: UserRow, causeId: string, body: DonateBody): Promise<MoneyResult> {
  await closeEnded(ctx.db)
  const pre = await byId(ctx.db, causeId)
  if (pre.status !== 'open') throw conflict(pre.status === 'suspended' ? 'This cause is on hold' : 'This cause is closed')
  const amountCents = paymentCents(body.amount)
  const note = body.note?.trim().slice(0, 80) || null
  await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    const [dup] = await q.query('SELECT 1 FROM donations WHERE donor_id = $1 AND client_id = $2', [me.id, body.clientId])
    if (dup) throw conflict('Already given')
    const c = await byId(q, causeId, true)
    if (c.status !== 'open') throw conflict('This cause is closed')
    const result = await ctx.ledger.transfer(q, { kind: 'send', fromUserId: me.id, toUserId: c.wallet_user_id, amountCents, label: `Donation · ${c.title}`, note })
    for (const [userId, cents] of result.balances) out.balance(userId, cents)
    const [{ first }] = await q.query<{ first: boolean }>('SELECT NOT EXISTS (SELECT 1 FROM donations WHERE cause_id = $1 AND donor_id = $2) AS first', [c.id, me.id])
    await q.query(
      'INSERT INTO donations (id, cause_id, donor_id, amount_cents, note, anonymous, transaction_id, client_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [newId(), c.id, me.id, amountCents, note, !!body.anonymous, result.tx.id, body.clientId],
    )
    const raised = Number(c.raised_cents) + amountCents
    const reached = !c.target_told && raised >= Number(c.target_cents)
    await q.query(
      'UPDATE causes SET raised_cents = $2, donor_count = donor_count + $3, target_told = target_told OR $4 WHERE id = $1',
      [c.id, raised, first ? 1 : 0, reached],
    )
    if (me.id !== c.organiser_id) {
      out.notify({
        userIds: [c.organiser_id],
        category: 'money',
        title: reached ? `${c.title}: target reached 🎉` : c.title,
        body: `${body.anonymous ? 'Someone' : me.name} gave ${formatM(amountCents)}${note ? `: “${note}”` : ''}. ${formatM(raised)} of ${formatM(Number(c.target_cents))} raised.`,
        data: { url: `/donate/${c.code}` },
      })
    }
    return moneyResult(q, me, result)
  })
}

async function requireOrganiser(q: Queryable, me: UserRow, causeId: string): Promise<CauseRow> {
  const c = await byId(q, causeId)
  if (c.organiser_id !== me.id) throw forbidden('Only the organiser can do this')
  return c
}

export async function withdraw(ctx: Ctx, me: UserRow, causeId: string, amount: number, pin: string): Promise<MoneyResult> {
  const pre = await requireOrganiser(ctx.db, me, causeId)
  if (pre.status === 'suspended') throw conflict('This cause is on hold. EcoCash support will contact you')
  const amountCents = paymentCents(amount)
  if (amountCents > pre.balance_cents) throw validation(`The cause has ${formatM(pre.balance_cents)}`)
  await checkPin(ctx.db, me, pin)
  return ctx.tx(async (q, out) => {
    const c = await byId(q, causeId, true)
    if (c.status === 'suspended') throw conflict('This cause is on hold')
    const result = await ctx.ledger.transfer(q, { kind: 'send', fromUserId: c.wallet_user_id, toUserId: me.id, amountCents, label: `Withdrawn from ${c.title}`, note: null })
    for (const [userId, cents] of result.balances) out.balance(userId, cents)
    return moneyResult(q, me, result)
  })
}

export async function closeCause(ctx: Ctx, me: UserRow, causeId: string): Promise<Cause> {
  const c = await requireOrganiser(ctx.db, me, causeId)
  if (c.status !== 'open') throw conflict(`This cause is already ${c.status}`)
  await ctx.db.query(`UPDATE causes SET status = 'closed', status_reason = 'Closed by the organiser' WHERE id = $1`, [causeId])
  return toCause(ctx.db, await byId(ctx.db, causeId), me)
}

/** Posts the cause as a card in a chat I am in, so the others can give from there. */
export async function shareCause(ctx: Ctx, me: UserRow, causeId: string, chatId: string): Promise<Message> {
  const c = await byId(ctx.db, causeId)
  await requireMember(ctx.db, chatId, me.id)
  return ctx.tx((q, out) => postMessage(q, out, { chatId, senderId: me.id, kind: 'cause', causeId: c.id, text: c.title }))
}

// ---------- portal ----------

export async function adminCauses(q: Queryable): Promise<AdminCause[]> {
  await closeEnded(q)
  const rows = await q.query<CauseRow>(`${SELECT} ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 200`)
  const users = await getUsers(q, rows.map((r) => r.organiser_id))
  return rows.map((r) => {
    const a: AdminCause = { ...card(r), organiser: toPublicUser(users.get(r.organiser_id)!), balance: fromCents(Number(r.balance_cents)), createdAt: iso(r.created_at) }
    if (r.status_reason) a.statusReason = r.status_reason
    return a
  })
}

/** Staff put a cause on hold (no giving, no withdrawing) or open it again; the organiser is told. */
export async function setCauseHold(q: Queryable, out: Parameters<Parameters<Ctx['tx']>[0]>[1], causeId: string, hold: boolean, reason: string | null): Promise<CauseRow> {
  const c = await byId(q, causeId, true)
  if (hold) {
    if (!reason?.trim()) throw validation('Give the reason the organiser will see')
    if (c.status === 'suspended') throw conflict('Already on hold')
    await q.query(`UPDATE causes SET status = 'suspended', status_reason = $2 WHERE id = $1`, [causeId, reason.trim()])
    out.notify({ userIds: [c.organiser_id], category: 'security', title: `${c.title} is on hold`, body: `EcoCash put your cause on hold: ${reason.trim()}`, data: { url: `/donate/${c.code}` } })
  } else {
    if (c.status !== 'suspended') throw conflict('This cause is not on hold')
    await q.query(`UPDATE causes SET status = 'open', status_reason = NULL WHERE id = $1`, [causeId])
    out.notify({ userIds: [c.organiser_id], category: 'money', title: c.title, body: 'Your cause is open again.', data: { url: `/donate/${c.code}` } })
  }
  return c
}
