// Saved bills, saved recipients and stop orders. Contract: shared/api.ts "Saved bills, saved recipients and stop orders".
import {
  MAX_SAVED_PER_BILLER,
  MAX_SAVED_RECIPIENTS,
  MAX_STOP_ORDERS,
  nextStopOrderDate,
  type LocalizedText,
  type SavedBill,
  type SavedBillBody,
  type SavedRecipient,
  type ServiceDef,
  type StopOrder,
  type StopOrderBody,
  type StopOrderRun,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso } from '../lib/time'
import * as catalogue from './catalogue'
import { ensurePairChat } from './chats'
import { payBill, sendMoney } from './money'
import { checkPin } from './pins'
import { displayName, getUser, requireWallet, toPublicUser, type UserRow } from './users'

const LEC = { name: { en: 'LEC', st: 'LEC' }, icon: 'flash', color: '#F59E0B' }

/** The field a saved account fills (the first required account, number or phone field) and the amount field. */
function billFields(def: ServiceDef): { account: string; amount: string } | null {
  const account = def.fields.find((f) => f.required && (f.type === 'text' || f.type === 'number' || f.type === 'phone'))
  const amount = def.fields.find((f) => f.type === 'amount')
  // Other required fields (a list, a date) can't be filled in by a saved bill.
  const others = def.fields.filter((f) => f.required && f !== account && f !== amount)
  return account && amount && others.length === 0 ? { account: account.key, amount: amount.key } : null
}

async function targetInfo(q: Queryable, target: string): Promise<{ name: LocalizedText; icon: string; color: string; image?: string; def?: ServiceDef }> {
  if (target === 'lec') return LEC
  const id = /^service:(.+)$/.exec(target)?.[1]
  if (!id) throw validation('target is "lec" or "service:<id>"')
  const def = await catalogue.requireService(q, id, { enabledOnly: true })
  if (!billFields(def)) throw validation(`${def.name.en} can't be saved: it needs more than an account and an amount`)
  return { name: def.name, icon: def.icon, color: def.color, image: def.image, def }
}

// ---------- saved bills ----------

interface SavedBillRow { id: string; target: string; account: string; nickname: string; created_at: Date }

export async function listSavedBills(q: Queryable, userId: string): Promise<SavedBill[]> {
  const rows = await q.query<SavedBillRow>('SELECT * FROM saved_bills WHERE user_id = $1 ORDER BY target, created_at', [userId])
  const out: SavedBill[] = []
  for (const r of rows) {
    // A biller since removed or turned off in the portal drops out of the list (its saved account stays, unused).
    const info = await targetInfo(q, r.target).catch(() => null)
    if (!info) continue
    out.push({ id: r.id, target: r.target, account: r.account, nickname: r.nickname, billerName: info.name, icon: info.icon, color: info.color, ...(info.image ? { image: info.image } : {}), createdAt: iso(r.created_at) })
  }
  return out
}

export async function saveBill(q: Queryable, userId: string, body: SavedBillBody): Promise<SavedBill> {
  const account = body.account.replace(/\s+/g, ' ').trim()
  const nickname = body.nickname.trim()
  if (account.length < 3 || account.length > 40) throw validation('The account number is 3 to 40 characters')
  if (!nickname || nickname.length > 30) throw validation('Give it a name of up to 30 characters, like "Home"')
  await targetInfo(q, body.target)
  const [{ n }] = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM saved_bills WHERE user_id = $1 AND target = $2', [userId, body.target])
  const [same] = await q.query<{ id: string }>('SELECT id FROM saved_bills WHERE user_id = $1 AND target = $2 AND account = $3', [userId, body.target, account])
  if (same) {
    await q.query('UPDATE saved_bills SET nickname = $2 WHERE id = $1', [same.id, nickname])
  } else {
    if (n >= MAX_SAVED_PER_BILLER) throw new AppError('LIMIT_EXCEEDED', `You can save up to ${MAX_SAVED_PER_BILLER} accounts for each biller. Remove one first`)
    await q.query('INSERT INTO saved_bills (id, user_id, target, account, nickname) VALUES ($1, $2, $3, $4, $5)', [newId(), userId, body.target, account, nickname])
  }
  const all = await listSavedBills(q, userId)
  return all.find((b) => b.target === body.target && b.account === account)!
}

export async function deleteSavedBill(q: Queryable, userId: string, id: string) {
  const [used] = await q.query<{ label: string }>(`SELECT label FROM stop_orders WHERE saved_bill_id = $1 AND status <> 'ended'`, [id])
  if (used) throw conflict(`The stop order "${used.label}" pays this. Cancel it first`)
  const [r] = await q.query('DELETE FROM saved_bills WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId])
  if (!r) throw notFound('Saved bill not found')
}

// ---------- saved recipients ----------

interface RecipientRow { id: string; contact_id: string; nickname: string; created_at: Date }

async function toRecipient(q: Queryable, r: RecipientRow): Promise<SavedRecipient> {
  const u = await getUser(q, r.contact_id)
  return { id: r.id, user: toPublicUser(u!), nickname: r.nickname, createdAt: iso(r.created_at) }
}

export async function listRecipients(q: Queryable, userId: string): Promise<SavedRecipient[]> {
  const rows = await q.query<RecipientRow>('SELECT * FROM saved_recipients WHERE user_id = $1 ORDER BY created_at', [userId])
  return Promise.all(rows.map((r) => toRecipient(q, r)))
}

export async function saveRecipient(q: Queryable, me: UserRow, msisdn: string, nickname = ''): Promise<SavedRecipient> {
  const who = await requireWallet(q, normalizeMsisdn(msisdn))
  if (who.id === me.id) throw validation('That is your own number')
  const nick = nickname.trim().slice(0, 30)
  const [same] = await q.query<RecipientRow>('SELECT * FROM saved_recipients WHERE user_id = $1 AND contact_id = $2', [me.id, who.id])
  if (same) {
    const [r] = await q.query<RecipientRow>('UPDATE saved_recipients SET nickname = $2 WHERE id = $1 RETURNING *', [same.id, nick])
    return toRecipient(q, r)
  }
  const [{ n }] = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM saved_recipients WHERE user_id = $1', [me.id])
  if (n >= MAX_SAVED_RECIPIENTS) throw new AppError('LIMIT_EXCEEDED', `You can save up to ${MAX_SAVED_RECIPIENTS} people. Remove one first`)
  const [r] = await q.query<RecipientRow>('INSERT INTO saved_recipients (id, user_id, contact_id, nickname) VALUES ($1, $2, $3, $4) RETURNING *', [newId(), me.id, who.id, nick])
  return toRecipient(q, r)
}

export async function deleteRecipient(q: Queryable, userId: string, id: string) {
  const [used] = await q.query<{ label: string }>(`SELECT label FROM stop_orders WHERE recipient_id = $1 AND status <> 'ended'`, [id])
  if (used) throw conflict(`The stop order "${used.label}" pays this person. Cancel it first`)
  const [r] = await q.query('DELETE FROM saved_recipients WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId])
  if (!r) throw notFound('Saved person not found')
}

// ---------- stop orders ----------

interface OrderRow {
  id: string; user_id: string; kind: 'bill' | 'send'; saved_bill_id: string | null; recipient_id: string | null; label: string
  amount_cents: string; frequency: StopOrder['frequency']; day: number; next_run: string; retry_of: string | null; end_date: string | null
  remaining: number | null; status: StopOrder['status']; note: string | null; created_at: Date
}
const ORDER_COLS = `id, user_id, kind, saved_bill_id, recipient_id, label, amount_cents, frequency, day, next_run::text AS next_run,
  retry_of::text AS retry_of, end_date::text AS end_date, remaining, status, note, created_at`

/** Today's date in Maseru (UTC+2), YYYY-MM-DD. */
export const maseruToday = (now = new Date()) => new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

async function toOrder(q: Queryable, r: OrderRow): Promise<StopOrder> {
  const [last] = await q.query<{ status: StopOrderRun['status']; error: string | null; created_at: Date }>(
    'SELECT status, error, created_at FROM stop_order_runs WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [r.id])
  return {
    id: r.id, kind: r.kind, label: r.label, amount: fromCents(Number(r.amount_cents)), frequency: r.frequency, day: r.day, nextRun: r.next_run,
    status: r.status, createdAt: iso(r.created_at),
    ...(r.saved_bill_id ? { savedBillId: r.saved_bill_id } : {}),
    ...(r.recipient_id ? { recipientId: r.recipient_id } : {}),
    ...(r.end_date ? { endDate: r.end_date } : {}),
    ...(r.remaining !== null ? { remaining: r.remaining } : {}),
    ...(r.note ? { note: r.note } : {}),
    ...(last ? { last: { at: iso(last.created_at), status: last.status, ...(last.error ? { error: last.error } : {}) } } : {}),
  }
}

export async function listStopOrders(q: Queryable, userId: string): Promise<StopOrder[]> {
  const rows = await q.query<OrderRow>(`SELECT ${ORDER_COLS} FROM stop_orders WHERE user_id = $1 ORDER BY status = 'ended', next_run, created_at`, [userId])
  return Promise.all(rows.map((r) => toOrder(q, r)))
}

async function requireOrder(q: Queryable, userId: string, id: string): Promise<OrderRow> {
  const [r] = await q.query<OrderRow>(`SELECT ${ORDER_COLS} FROM stop_orders WHERE id = $1 AND user_id = $2`, [id, userId])
  if (!r) throw notFound('Stop order not found')
  return r
}

export async function createStopOrder(ctx: Ctx, me: UserRow, body: StopOrderBody, now = new Date()): Promise<StopOrder> {
  const amountCents = paymentCents(body.amount)
  if (body.frequency === 'monthly' ? !(Number.isInteger(body.day) && body.day >= 0 && body.day <= 28) : !(Number.isInteger(body.day) && body.day >= 0 && body.day <= 6)) {
    throw validation(body.frequency === 'monthly' ? 'Pick a day of the month from 1 to 28, or the last day' : 'Pick a day of the week')
  }
  const today = maseruToday(now)
  if (body.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) throw validation('endDate is YYYY-MM-DD')
  if (body.endDate && body.endDate < today) throw validation('The end date has passed')
  if (body.payments !== undefined && !(Number.isInteger(body.payments) && body.payments >= 1 && body.payments <= 120)) throw validation('Number of payments: 1 to 120')
  const note = body.note?.trim().slice(0, 60) || null

  let label: string
  if (body.kind === 'bill') {
    const [b] = await ctx.db.query<SavedBillRow>('SELECT * FROM saved_bills WHERE id = $1 AND user_id = $2', [body.savedBillId ?? '', me.id])
    if (!b) throw validation('Pick one of your saved bills')
    const info = await targetInfo(ctx.db, b.target)
    label = `${info.name.en} · ${b.nickname}`
  } else {
    const [r] = await ctx.db.query<RecipientRow>('SELECT * FROM saved_recipients WHERE id = $1 AND user_id = $2', [body.recipientId ?? '', me.id])
    if (!r) throw validation('Pick one of your saved people')
    const u = await getUser(ctx.db, r.contact_id)
    label = r.nickname || displayName(u!)
  }
  const [{ n }] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stop_orders WHERE user_id = $1 AND status <> 'ended'`, [me.id])
  if (n >= MAX_STOP_ORDERS) throw new AppError('LIMIT_EXCEEDED', `You can have up to ${MAX_STOP_ORDERS} stop orders. Cancel one first`)
  await checkPin(ctx.db, me, body.pin)

  const first = nextStopOrderDate(body.frequency, body.day, today)
  if (body.endDate && first > body.endDate) throw validation('The first payment would be after the end date')
  const id = newId()
  await ctx.db.query(
    `INSERT INTO stop_orders (id, user_id, kind, saved_bill_id, recipient_id, label, amount_cents, frequency, day, next_run, end_date, remaining, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, me.id, body.kind, body.kind === 'bill' ? body.savedBillId : null, body.kind === 'send' ? body.recipientId : null, label, amountCents,
      body.frequency, body.day, first, body.endDate ?? null, body.payments ?? null, note],
  )
  return toOrder(ctx.db, await requireOrder(ctx.db, me.id, id))
}

export async function setStopOrderStatus(q: Queryable, userId: string, id: string, status: 'active' | 'paused', now = new Date()): Promise<StopOrder> {
  const r = await requireOrder(q, userId, id)
  if (r.status === 'ended') throw conflict('This stop order has ended. Set up a new one')
  // Resuming after a pause: the next date from today, not the ones missed while paused.
  const next = status === 'active' && r.status === 'paused' ? nextStopOrderDate(r.frequency, r.day, maseruToday(now)) : r.next_run
  await q.query('UPDATE stop_orders SET status = $3, next_run = $4, retry_of = NULL WHERE id = $1 AND user_id = $2', [id, userId, status, next])
  return toOrder(q, await requireOrder(q, userId, id))
}

export async function cancelStopOrder(q: Queryable, userId: string, id: string) {
  await requireOrder(q, userId, id)
  await q.query(`UPDATE stop_orders SET status = 'ended' WHERE id = $1`, [id])
}

export async function stopOrderRuns(q: Queryable, userId: string, id: string): Promise<StopOrderRun[]> {
  await requireOrder(q, userId, id)
  const rows = await q.query<{ id: string; due_on: string; status: StopOrderRun['status']; amount_cents: string; reference: string | null; error: string | null; created_at: Date }>(
    'SELECT id, due_on::text AS due_on, status, amount_cents, reference, error, created_at FROM stop_order_runs WHERE order_id = $1 ORDER BY created_at DESC LIMIT 50', [id])
  return rows.map((r) => ({ id: r.id, dueOn: r.due_on, at: iso(r.created_at), status: r.status, amount: fromCents(Number(r.amount_cents)), ...(r.reference ? { reference: r.reference } : {}), ...(r.error ? { error: r.error } : {}) }))
}

/** Pays one order once, as the person, without their PIN (given when it was set up). Returns a reference. */
async function pay(ctx: Ctx, me: UserRow, r: OrderRow, dueOn: string): Promise<string> {
  const amount = fromCents(Number(r.amount_cents))
  if (r.kind === 'send') {
    const [rec] = await ctx.db.query<RecipientRow>('SELECT * FROM saved_recipients WHERE id = $1', [r.recipient_id ?? ''])
    if (!rec) throw validation('The saved person was removed')
    const { chatId } = await ctx.tx((q, out) => ensurePairChat(q, out, me.id, rec.contact_id, { creatorId: me.id }))
    const res = await sendMoney(ctx, me, { chatId, toUserId: rec.contact_id, amount, pin: '', kind: 'money', note: r.note ?? `Stop order · ${r.label}`, clientId: `so-${r.id}-${dueOn}` }, { pinConfirmed: true })
    return res.transaction.reference
  }
  const [b] = await ctx.db.query<SavedBillRow>('SELECT * FROM saved_bills WHERE id = $1', [r.saved_bill_id ?? ''])
  if (!b) throw validation('The saved bill was removed')
  if (b.target === 'lec') {
    const res = await payBill(ctx, me, { bill: 'lec', account: b.account, amount, pin: '' }, { pinConfirmed: true })
    return res.transaction.reference
  }
  const info = await targetInfo(ctx.db, b.target)
  const keys = billFields(info.def!)!
  const res = await catalogue.submit(ctx, me, info.def!.id, { values: { [keys.account]: b.account, [keys.amount]: amount.toFixed(2) }, pin: '', clientId: `so-${r.id}-${dueOn}` }, { pinConfirmed: true })
  return res.reference
}

const shortOfMoney = (e: unknown) => {
  const err = e as { code?: string; message?: string }
  return err?.code === 'INSUFFICIENT_FUNDS' || (err?.code === '23514' && /balance/.test(err.message ?? ''))
}

/**
 * Pays every stop order due today (or earlier, e.g. after downtime). Short of money: tried again tomorrow once, then
 * missed. Either way the next date is worked out from the date it was due, and the person is told.
 */
export async function runDueStopOrders(ctx: Ctx, now = new Date()): Promise<{ paid: number; failed: number; retrying: number }> {
  const today = maseruToday(now)
  const due = await ctx.db.query<OrderRow>(`SELECT ${ORDER_COLS} FROM stop_orders WHERE status = 'active' AND next_run <= $1 ORDER BY next_run`, [today])
  const tally = { paid: 0, failed: 0, retrying: 0 }
  for (const r of due) {
    const me = await getUser(ctx.db, r.user_id)
    if (!me) continue
    const dueOn = r.retry_of ?? r.next_run
    const amount = formatM(Number(r.amount_cents))
    let status: StopOrderRun['status']
    let reference: string | null = null
    let error: string | null = null
    try {
      reference = await pay(ctx, me, r, dueOn)
      status = 'paid'
    } catch (e) {
      error = (e as Error).message || 'Payment failed'
      status = shortOfMoney(e) && !r.retry_of ? 'retrying' : 'failed'
      if (shortOfMoney(e)) error = 'Not enough money in the wallet'
    }
    await ctx.db.query('INSERT INTO stop_order_runs (id, order_id, due_on, status, amount_cents, reference, error) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [newId(), r.id, dueOn, status, r.amount_cents, reference, error])
    tally[status]++

    if (status === 'retrying') {
      await ctx.db.query('UPDATE stop_orders SET next_run = $2, retry_of = $3 WHERE id = $1', [r.id, addDays(today, 1), dueOn])
    } else {
      const remaining = r.remaining === null ? null : status === 'paid' ? r.remaining - 1 : r.remaining
      const next = nextStopOrderDate(r.frequency, r.day, addDays(dueOn, 1))
      const ended = remaining === 0 || (r.end_date !== null && next > r.end_date)
      await ctx.db.query('UPDATE stop_orders SET next_run = $2, retry_of = NULL, remaining = $3, status = $4 WHERE id = $1', [r.id, next, remaining, ended ? 'ended' : 'active'])
    }
    void ctx.notifier.send({
      userIds: [r.user_id],
      category: 'money',
      title: status === 'paid' ? 'Stop order paid' : status === 'retrying' ? 'Stop order: not enough money' : 'Stop order missed',
      body: status === 'paid' ? `${amount} paid: ${r.label}.`
        : status === 'retrying' ? `${amount} for ${r.label} could not be paid today. Top up: we try again tomorrow.`
        : `${amount} for ${r.label} was not paid${error ? ` (${error})` : ''}. It continues on its next date.`,
      data: { screen: 'transactions' },
    })
  }
  return tally
}

/** Checks for due stop orders every few minutes (they run once a day, on their date). */
export function createStopOrderSweeper(ctx: Ctx, everyMs = 5 * 60_000) {
  let timer: NodeJS.Timeout | null = null
  let busy = false
  const sweep = async () => {
    if (busy) return
    busy = true
    try {
      await runDueStopOrders(ctx)
    } catch (err) {
      ctx.log.error({ err }, 'stop order sweep failed')
    } finally {
      busy = false
    }
  }
  return {
    sweep,
    start() {
      timer = setInterval(() => void sweep(), everyMs)
      timer.unref()
      void sweep()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
