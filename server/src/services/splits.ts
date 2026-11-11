// Split bill per the EcoCash pinless payment flow. Contract: shared/api.ts (CreateSplitBody … CancelSplitBody).
//
// Creating a split sends each person a pinless payment payload for their share (ctx.pinless). Each person approves
// once with their PIN; from then on their share is collected without a PIN: what the wallet can spare right away
// (never below SplitSettings.balanceFloor), then whenever money arrives (ctx.onCredit, and the sweeper as a backstop),
// oldest split first, until paid or the collection deadline passes. Not approved in time counts as declined. The
// organiser decides about declined, expired and lapsed shares: move it to someone else, cover it, or cancel.
// The organiser pays their own cut when creating the split. Limits live in app_settings 'split' (portal).
import {
  SPLIT_PROBLEM,
  type ApproveShareBody,
  type CancelSplitBody,
  type CreateSplitBody,
  type Message,
  type PayRequestBody,
  type PayRequestResult,
  type ResolveShareBody,
  type SplitMode,
  type SplitSettings,
  type SplitShareStatus,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { TransferResult } from '../ecocash/index'
import type { PinlessGateway } from '../gateways/pinless'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, paymentCents } from '../lib/money'
import type { Outbox } from '../realtime/outbox'
import { announceUpdate, loadMessages, postMessage, requireMember } from './chats'
import { setSetting } from './maintenance'
import { moneyResult, requireMerchant } from './money'
import { checkPin } from './pins'
import { getUser, getUsers, requireByNumberOrUsername, type UserRow } from './users'

// ---------- settings ----------

/** PLACEHOLDER limits until ETL confirms them (also seeded by migration 024). */
export const DEFAULT_SPLIT: SplitSettings = {
  approvalHours: 48,
  reminderHours: [1, 24],
  collectionDays: 30,
  maxShare: 500,
  maxShareTier1: 200,
  maxOpenOwed: 1000,
  maxParticipants: 20,
  balanceFloor: 20,
  merchantDirect: true,
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

export async function getSplitSettings(q: Queryable): Promise<SplitSettings> {
  const [row] = await q.query<{ value: Partial<SplitSettings> | null }>(`SELECT value FROM app_settings WHERE key = 'split'`)
  const v = row?.value ?? {}
  const d = DEFAULT_SPLIT
  return {
    approvalHours: num(v.approvalHours, d.approvalHours),
    reminderHours: Array.isArray(v.reminderHours) ? v.reminderHours.filter((h) => typeof h === 'number' && h > 0) : d.reminderHours,
    collectionDays: num(v.collectionDays, d.collectionDays),
    maxShare: num(v.maxShare, d.maxShare),
    maxShareTier1: num(v.maxShareTier1, d.maxShareTier1),
    maxOpenOwed: num(v.maxOpenOwed, d.maxOpenOwed),
    maxParticipants: num(v.maxParticipants, d.maxParticipants),
    balanceFloor: num(v.balanceFloor, d.balanceFloor),
    merchantDirect: typeof v.merchantDirect === 'boolean' ? v.merchantDirect : d.merchantDirect,
  }
}

export async function setSplitSettings(q: Queryable, s: SplitSettings): Promise<SplitSettings> {
  if (s.approvalHours < 1) throw validation('People need at least 1 hour to approve')
  if (s.collectionDays < 1) throw validation('Collection must run for at least 1 day')
  if (s.maxParticipants < 2) throw validation('A split needs at least 2 people')
  if (s.maxShareTier1 > s.maxShare) throw validation('The tier 1 share limit can’t be more than the share limit')
  if (s.maxShare > s.maxOpenOwed) throw validation('The share limit can’t be more than the most a person may owe')
  if (s.balanceFloor < 0) throw validation('The minimum balance can’t be negative')
  const reminderHours = [...new Set(s.reminderHours)].sort((a, b) => a - b)
  if (reminderHours.some((h) => h <= 0 || h >= s.approvalHours)) throw validation('Reminders must come before the approval time runs out')
  const clean: SplitSettings = { ...s, reminderHours }
  await setSetting(q, 'split', clean)
  return clean
}

// ---------- rows ----------

interface SplitRow {
  message_id: string
  requester_id: string
  to_user_id: string
  amount_cents: number
  paid_cents: number
  status: string
  note: string | null
  split_method: string
  split_mode: SplitMode
  split_payee_id: string | null
  chat_id: string
}

interface ShareRow {
  message_id: string
  user_id: string
  position: number
  amount_cents: number | null
  paid_cents: number
  status: SplitShareStatus
  created_at: Date
  approve_by: Date | null
  collect_until: Date | null
  reminders: number
  payload_id: string | null
}

const toShare = (r: ShareRow): ShareRow => ({
  ...r,
  amount_cents: r.amount_cents == null ? null : Number(r.amount_cents),
  paid_cents: Number(r.paid_cents),
})
/** What is still owed on a share (0 when the member has not set an amount yet). */
const owed = (s: ShareRow) => (s.amount_cents == null ? 0 : s.amount_cents - s.paid_cents)
const label = (note: string | null) => `Split bill${note ? ` · ${note}` : ''}`
const quoted = (note: string | null) => (note ? `“${note}”` : 'the split bill')
const hours = (h: number) => new Date(Date.now() + h * 3600_000)

async function loadSplit(q: Queryable, messageId: string, lock = false): Promise<SplitRow> {
  const [r] = await q.query<SplitRow>(
    `SELECT r.message_id, r.requester_id, r.to_user_id, r.amount_cents, r.paid_cents, r.status, r.note, r.split_method,
            r.split_mode, r.split_payee_id, m.chat_id
     FROM requests r JOIN messages m ON m.id = r.message_id WHERE r.message_id = $1 AND r.kind = 'split' ${lock ? 'FOR UPDATE OF r' : ''}`,
    [messageId],
  )
  if (!r) throw notFound('Split bill not found')
  return { ...r, amount_cents: Number(r.amount_cents), paid_cents: Number(r.paid_cents) }
}

async function loadShare(q: Queryable, messageId: string, userId: string, lock = false): Promise<ShareRow | null> {
  const [s] = await q.query<ShareRow>(`SELECT * FROM split_shares WHERE message_id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [messageId, userId])
  return s ? toShare(s) : null
}

/** Paid when nothing is left open; problem shares keep it pending until the organiser decides. */
async function settle(q: Queryable, messageId: string) {
  const [{ open }] = await q.query<{ open: number }>(
    `SELECT count(*)::int AS open FROM split_shares WHERE message_id = $1 AND status IN ('awaiting', 'collecting', 'declined', 'expired', 'lapsed')`,
    [messageId],
  )
  await q.query(`UPDATE requests SET status = $2, updated_at = now() WHERE message_id = $1 AND status = 'pending'`, [messageId, open ? 'pending' : 'paid'])
}

async function closeShare(q: Queryable, pinless: PinlessGateway, s: ShareRow, status: SplitShareStatus) {
  await q.query('UPDATE split_shares SET status = $3, closed_at = now() WHERE message_id = $1 AND user_id = $2', [s.message_id, s.user_id, status])
  if (s.payload_id) await pinless.close(s.payload_id, status as Parameters<PinlessGateway['close']>[1])
}

function emitBalances(out: Outbox, result: TransferResult) {
  for (const [userId, cents] of result.balances) out.balance(userId, cents)
}

/** Sends a pinless payload for a share; the payee is whoever the money goes to. */
async function createPayload(ctx: Ctx, q: Queryable, splitId: string, payer: UserRow, amountCents: number | null, mode: SplitMode, toUserId: string, note: string | null, expiresAt: Date) {
  const to = await getUser(q, toUserId)
  const payee = mode === 'merchant_direct' && to?.code ? { merchantCode: to.code } : { msisdn: to?.msisdn ?? '' }
  const { payloadId } = await ctx.pinless.create({ splitId, payerMsisdn: payer.msisdn ?? '', payee, amountCents, expiresAt, note })
  return payloadId
}

// ---------- create ----------

/** Spreads `totalCents` over `n` shares; the spare cents go to the first shares (the organiser when included). */
export function equalShares(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n)
  return Array.from({ length: n }, (_, i) => base + (i < totalCents % n ? 1 : 0))
}

export async function createSplit(ctx: Ctx, me: UserRow, body: CreateSplitBody): Promise<Message> {
  const settings = await getSplitSettings(ctx.db)
  const chat = await requireMember(ctx.db, body.chatId, me.id)
  if (chat.kind === 'official') throw validation('You cannot split a bill with an official account')
  const note = body.note?.trim() || null
  if (note && note.length > 60) throw validation('note must be at most 60 characters')

  // Organiser first, so they absorb any spare cents of an even split; no one twice.
  const seen = new Set<string>()
  const people = [...body.participants.filter((p) => p.userId === me.id), ...body.participants.filter((p) => p.userId !== me.id)]
    .filter((p) => !seen.has(p.userId) && seen.add(p.userId))
  if (!people.some((p) => p.userId !== me.id)) throw validation('Choose at least one other person')
  if (people.length > settings.maxParticipants) throw validation(`A split can have at most ${settings.maxParticipants} people`)
  const members = await ctx.db.query<{ user_id: string }>(
    `SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = $1 AND u.kind = 'person'`,
    [body.chatId],
  )
  const inChat = new Set(members.map((m) => m.user_id))
  if (people.some((p) => !inChat.has(p.userId))) throw validation('Everyone in the split must be in this chat')

  // Who receives the money.
  let mode: SplitMode = 'organiser'
  let toUserId = me.id
  let payee: UserRow | null = null
  if (body.payTo && 'subscriber' in body.payTo) {
    payee = await requireByNumberOrUsername(ctx.db, body.payTo.subscriber)
    if (payee.id === me.id) throw validation('Leave “Pay to” as yourself to receive the money')
    if (payee.kind !== 'person') throw validation('Choose a person’s wallet')
    mode = 'subscriber'
    toUserId = payee.id
  } else if (body.payTo && 'merchantCode' in body.payTo) {
    payee = await requireMerchant(ctx.db, body.payTo.merchantCode)
    if (payee.id === me.id) throw validation('You cannot pay yourself')
    if (!body.payTo.organiserCovers && !settings.merchantDirect) throw validation('Pay the merchant in full now, and the split brings the shares back to you')
    mode = body.payTo.organiserCovers ? 'merchant_cover' : 'merchant_direct'
    toUserId = body.payTo.organiserCovers ? me.id : payee.id
  }
  if (payee && people.some((p) => p.userId === payee.id)) throw validation('The person being paid can’t also share the bill')
  if (body.method === 'enter' && mode !== 'organiser') throw validation('Choose equal or specific amounts when the money goes to someone else')

  let amounts: (number | null)[]
  let totalCents: number
  if (body.method === 'equal') {
    if (body.total === undefined) throw validation('Enter the total')
    totalCents = paymentCents(body.total)
    if (totalCents < people.length) throw validation('The total is too small to split')
    amounts = equalShares(totalCents, people.length)
  } else if (body.method === 'specific') {
    amounts = people.map((p) => {
      if (p.amount === undefined) throw validation('Enter an amount for everyone')
      return paymentCents(p.amount)
    })
    totalCents = amounts.reduce<number>((a, c) => a + (c ?? 0), 0)
  } else {
    amounts = people.map(() => null)
    totalCents = body.total === undefined ? 0 : paymentCents(body.total)
  }
  const maxCents = Math.round(settings.maxShare * 100)
  people.forEach((p, i) => {
    if (p.userId !== me.id && (amounts[i] ?? 0) > maxCents) throw validation(`A share can be at most ${formatM(maxCents)}`)
  })

  const myIndex = people.findIndex((p) => p.userId === me.id)
  const myCutCents = myIndex >= 0 ? amounts[myIndex] ?? 0 : 0
  // What the organiser pays now: nothing when the money comes to them; their cut to another payee; the whole bill
  // when they cover a merchant.
  const payNowCents = mode === 'merchant_cover' ? totalCents : mode === 'organiser' ? 0 : myCutCents
  await checkPin(ctx.db, me, body.pin)

  const users = await getUsers(ctx.db, people.map((p) => p.userId))
  const message = await ctx.tx(async (q, out) => {
    // Retries with the same clientId return the split already sent.
    const [dup] = await q.query<{ id: string }>('SELECT id FROM messages WHERE chat_id = $1 AND sender_id = $2 AND client_id = $3', [body.chatId, me.id, body.clientId])
    if (dup) throw conflict('This split bill was already sent')
    const messageId = newId()
    if (payNowCents > 0) {
      const result = await ctx.ledger.transfer(q, {
        kind: mode === 'subscriber' ? 'request' : 'merchant',
        fromUserId: me.id,
        toUserId: payee!.id,
        amountCents: payNowCents,
        label: mode === 'merchant_cover' ? `${label(note)} · paid in full` : `${label(note)} · my share`,
      })
      emitBalances(out, result)
    }
    const approveBy = hours(settings.approvalHours)
    const shares = []
    for (const [i, p] of people.entries()) {
      const mine = p.userId === me.id
      shares.push({
        userId: p.userId,
        amountCents: amounts[i],
        paidCents: mine ? amounts[i] ?? 0 : 0,
        status: (mine ? 'paid' : 'awaiting') as SplitShareStatus,
        approveBy: mine ? null : approveBy,
        payloadId: mine ? null : await createPayload(ctx, q, messageId, users.get(p.userId)!, amounts[i], mode, toUserId, note, approveBy),
      })
    }
    const msg = await postMessage(q, out, {
      id: messageId,
      chatId: body.chatId,
      senderId: me.id,
      clientId: body.clientId,
      kind: 'request',
      request: {
        kind: 'split',
        requesterId: me.id,
        toUserId,
        amountCents: totalCents,
        paidCents: myCutCents,
        note,
        splitMethod: body.method,
        splitMode: mode,
        splitPayeeId: payee?.id ?? null,
        splitShares: shares,
      },
    })
    if (payee && mode !== 'merchant_cover') {
      out.notify({
        userIds: [payee.id],
        category: 'money',
        title: 'Split bill for you',
        body: `${me.name} started a split bill${note ? ` for “${note}”` : ''} of ${formatM(totalCents)} to pay you. You’ll receive each share as it is paid.`,
      })
    }
    return msg
  })
  return message
}

// ---------- the participant: approve, decline, pay now ----------

export async function approveShare(ctx: Ctx, me: UserRow, messageId: string, body: ApproveShareBody): Promise<Message> {
  const settings = await getSplitSettings(ctx.db)
  const r = await loadSplit(ctx.db, messageId)
  await requireMember(ctx.db, r.chat_id, me.id)
  const pre = await loadShare(ctx.db, messageId, me.id)
  if (!pre) throw forbidden('You are not part of this split bill')
  if (r.status !== 'pending') throw conflict(`This split bill is already ${r.status}`)
  if (pre.status !== 'awaiting') throw conflict(pre.status === 'collecting' ? 'You already approved your share' : 'This share is closed')
  if (pre.approve_by && pre.approve_by.getTime() <= Date.now()) throw conflict('The time to approve has passed')
  let amountCents = pre.amount_cents
  if (amountCents == null) {
    if (body.amount === undefined) throw validation('Enter your share')
    amountCents = paymentCents(body.amount)
  } else if (body.amount !== undefined && paymentCents(body.amount) !== amountCents) {
    throw validation(`Your share is ${formatM(amountCents)}`)
  }
  const maxCents = Math.round((me.kyc_tier === 1 ? settings.maxShareTier1 : settings.maxShare) * 100)
  if (amountCents > maxCents) {
    throw validation(`Automatic collection is limited to ${formatM(maxCents)}${me.kyc_tier === 1 ? ' until your ID is verified' : ''}. Pay your share now instead`)
  }
  const [{ open }] = await ctx.db.query<{ open: number }>(
    `SELECT COALESCE(sum(s.amount_cents - s.paid_cents), 0)::bigint AS open FROM split_shares s JOIN requests r ON r.message_id = s.message_id
     WHERE s.user_id = $1 AND s.status = 'collecting' AND r.status = 'pending'`,
    [me.id],
  )
  const maxOwed = Math.round(settings.maxOpenOwed * 100)
  if (Number(open) + amountCents > maxOwed) {
    throw validation(`You can owe at most ${formatM(maxOwed)} across your split bills. You owe ${formatM(Number(open))} now`)
  }
  await checkPin(ctx.db, me, body.pin)

  await ctx.tx(async (q, out) => {
    const r2 = await loadSplit(q, messageId, true)
    const s = await loadShare(q, messageId, me.id, true)
    if (r2.status !== 'pending' || s?.status !== 'awaiting') throw conflict('This share changed. Open the split again')
    if (s.payload_id) await ctx.pinless.approve(s.payload_id, amountCents)
    await q.query(
      `UPDATE split_shares SET status = 'collecting', amount_cents = $3, approved_at = now(), collect_until = now() + make_interval(days => $4)
       WHERE message_id = $1 AND user_id = $2`,
      [messageId, me.id, amountCents, settings.collectionDays],
    )
    await announceUpdate(q, out, messageId)
  })
  // Collect what the wallet can spare right away; the rest follows as money arrives.
  await collectFor(ctx, me.id)
  const [message] = await loadMessages(ctx.db, [messageId])
  return message
}

/** Inside payRequest's transaction (request row locked): pay everything still owed on my share now, with my PIN. */
export async function payShareNow(ctx: Ctx, q: Queryable, out: Outbox, me: UserRow, messageId: string, body: PayRequestBody): Promise<PayRequestResult> {
  const r = await loadSplit(q, messageId, true)
  const s = await loadShare(q, messageId, me.id, true)
  if (!s) throw forbidden('You are not part of this split bill')
  if (s.status !== 'awaiting' && s.status !== 'collecting') throw conflict(s.status === 'paid' ? 'You already paid your share' : 'This share is closed')
  let amountCents = s.amount_cents
  if (amountCents == null) {
    if (body.amount === undefined) throw validation('Enter the amount you are paying')
    amountCents = paymentCents(body.amount)
  }
  const due = amountCents - s.paid_cents
  if (body.amount !== undefined && s.amount_cents != null && paymentCents(body.amount) !== due) throw validation(`You owe ${formatM(due)}`)
  const result = await ctx.ledger.transfer(q, { kind: 'request', fromUserId: me.id, toUserId: r.to_user_id, amountCents: due, label: label(r.note), messageId })
  await q.query(
    `UPDATE split_shares SET amount_cents = $3, paid_cents = $3, status = 'paid', paid_at = now(), closed_at = now(),
       approved_at = COALESCE(approved_at, now()) WHERE message_id = $1 AND user_id = $2`,
    [messageId, me.id, amountCents],
  )
  if (s.payload_id) await ctx.pinless.close(s.payload_id, 'paid')
  await q.query('UPDATE requests SET paid_cents = paid_cents + $2, updated_at = now() WHERE message_id = $1', [messageId, due])
  await settle(q, messageId)
  const message = await announceUpdate(q, out, messageId)
  emitBalances(out, result)
  return { ...(await moneyResult(q, me, result)), message }
}

/** Inside declineRequest's transaction: decline my share (only before approving). */
export async function declineShare(ctx: Ctx, q: Queryable, out: Outbox, me: UserRow, messageId: string): Promise<Message> {
  const r = await loadSplit(q, messageId, true)
  if (r.status !== 'pending') throw conflict(`This split bill is already ${r.status}`)
  const s = await loadShare(q, messageId, me.id, true)
  if (!s) throw forbidden('You are not part of this split bill')
  if (s.status !== 'awaiting') throw conflict(s.status === 'collecting' ? 'You already approved this. Pay the rest now, or talk to the organiser' : 'This share is closed')
  await closeShare(q, ctx.pinless, s, 'declined')
  out.notify({
    userIds: [r.requester_id],
    category: 'requests',
    title: 'Share declined',
    body: `${me.name} declined their share${s.amount_cents != null ? ` (${formatM(s.amount_cents)})` : ''} of ${quoted(r.note)}. Open it to move it to someone else, cover it, or cancel.`,
    data: { chatId: r.chat_id },
  })
  return announceUpdate(q, out, messageId)
}

// ---------- collection ----------

/**
 * Collects what `userId` owes on approved shares, oldest first, keeping the minimum balance. One DB transaction per
 * share, so a refusal (risk, KYC) on one does not stop the others. Returns the cents collected.
 */
export async function collectFor(ctx: Ctx, userId: string): Promise<number> {
  const due = await ctx.db.query<{ message_id: string }>(
    `SELECT s.message_id FROM split_shares s JOIN requests r ON r.message_id = s.message_id
     WHERE s.user_id = $1 AND s.status = 'collecting' AND r.status = 'pending' ORDER BY s.approved_at, s.message_id`,
    [userId],
  )
  if (!due.length) return 0
  const floor = Math.round((await getSplitSettings(ctx.db)).balanceFloor * 100)
  let collected = 0
  for (const { message_id } of due) {
    try {
      const took = await ctx.tx(async (q, out) => {
        const [u] = await q.query<{ balance_cents: number; status: string; name: string }>('SELECT balance_cents, status, name FROM users WHERE id = $1', [userId])
        const spare = Number(u.balance_cents) - floor
        if (u.status !== 'active' || spare <= 0) return -1
        const r = await loadSplit(q, message_id, true)
        const s = await loadShare(q, message_id, userId, true)
        if (r.status !== 'pending' || s?.status !== 'collecting') return 0
        const take = Math.min(owed(s), spare)
        if (take <= 0) return 0
        if (s.payload_id) await ctx.pinless.collect(s.payload_id, take)
        const result = await ctx.ledger.transfer(q, { kind: 'request', fromUserId: userId, toUserId: r.to_user_id, amountCents: take, label: label(r.note), messageId: message_id })
        const left = owed(s) - take
        await q.query(
          `UPDATE split_shares SET paid_cents = paid_cents + $3, status = $4, paid_at = CASE WHEN $4 = 'paid' THEN now() END,
             closed_at = CASE WHEN $4 = 'paid' THEN now() END WHERE message_id = $1 AND user_id = $2`,
          [message_id, userId, take, left === 0 ? 'paid' : 'collecting'],
        )
        if (left === 0 && s.payload_id) await ctx.pinless.close(s.payload_id, 'paid')
        await q.query('UPDATE requests SET paid_cents = paid_cents + $2, updated_at = now() WHERE message_id = $1', [message_id, take])
        await settle(q, message_id)
        await announceUpdate(q, out, message_id)
        emitBalances(out, result)
        out.notify({
          userIds: [userId],
          category: 'requests',
          title: 'Split bill payment',
          body: `${formatM(take)} paid towards ${quoted(r.note)}. ${left === 0 ? 'Your share is fully paid.' : `${formatM(left)} still to pay; it is taken as money comes in.`}`,
          data: { chatId: r.chat_id },
        })
        return take
      })
      if (took < 0) break // nothing to spare: later shares can't be paid either
      collected += took
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      ctx.log.warn({ err, userId, splitId: message_id }, 'split collection refused')
    }
  }
  return collected
}

// ---------- the organiser: resolve, cancel ----------

async function requireOrganiser(q: Queryable, messageId: string, me: UserRow, lock = false) {
  const r = await loadSplit(q, messageId, lock)
  if (r.requester_id !== me.id) throw forbidden('Only the person who started the split can do this')
  if (r.status !== 'pending') throw conflict(`This split bill is already ${r.status}`)
  return r
}

export async function resolveShare(ctx: Ctx, me: UserRow, messageId: string, userId: string, body: ResolveShareBody): Promise<Message> {
  const settings = await getSplitSettings(ctx.db)
  const r = await requireOrganiser(ctx.db, messageId, me)
  const pre = await loadShare(ctx.db, messageId, userId)
  if (!pre) throw notFound('That person is not in this split')
  if (!SPLIT_PROBLEM.includes(pre.status)) throw conflict('Only declined, expired or unpaid shares can be changed')

  if (body.action === 'reassign') {
    if (body.userId === me.id) throw validation('To pay it yourself, choose “I’ll cover it”')
    const [member] = await ctx.db.query<{ kind: string }>(
      'SELECT u.kind FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = $1 AND cm.user_id = $2',
      [r.chat_id, body.userId],
    )
    if (member?.kind !== 'person') throw validation('Choose someone in this chat')
    if (await loadShare(ctx.db, messageId, body.userId)) throw validation('That person is already in this split')
    if (body.userId === r.split_payee_id) throw validation('The person being paid can’t also share the bill')
    if (pre.amount_cents == null) throw validation('This share has no amount yet. Cover it or cancel the split')
    const target = (await getUser(ctx.db, body.userId))!
    return ctx.tx(async (q, out) => {
      const s = await loadShare(q, messageId, userId, true)
      if (!s || !SPLIT_PROBLEM.includes(s.status)) throw conflict('This share changed. Open the split again')
      const amountCents = owed(s)
      await closeShare(q, ctx.pinless, s, 'reassigned')
      const approveBy = hours(settings.approvalHours)
      const payloadId = await createPayload(ctx, q, messageId, target, amountCents, r.split_mode, r.to_user_id, r.note, approveBy)
      const [{ next }] = await q.query<{ next: number }>('SELECT COALESCE(max(position), 0) + 1 AS next FROM split_shares WHERE message_id = $1', [messageId])
      await q.query(
        `INSERT INTO split_shares (message_id, user_id, position, amount_cents, paid_cents, status, approve_by, payload_id)
         VALUES ($1, $2, $3, $4, 0, 'awaiting', $5, $6)`,
        [messageId, target.id, next, amountCents, approveBy, payloadId],
      )
      out.notify({
        userIds: [target.id],
        category: 'requests',
        title: 'Split bill',
        body: `${me.name} asked you to approve ${formatM(amountCents)} for ${quoted(r.note)}.`,
        data: { chatId: r.chat_id },
      })
      return announceUpdate(q, out, messageId)
    })
  }

  // cover: the organiser takes over what is still owed.
  const left = owed(pre)
  const moves = r.to_user_id !== me.id && left > 0
  if (moves) {
    if (!body.pin) throw validation('Enter your PIN to pay this share')
    await checkPin(ctx.db, me, body.pin)
  }
  return ctx.tx(async (q, out) => {
    const s = await loadShare(q, messageId, userId, true)
    if (!s || !SPLIT_PROBLEM.includes(s.status)) throw conflict('This share changed. Open the split again')
    if (moves) {
      const result = await ctx.ledger.transfer(q, { kind: 'request', fromUserId: me.id, toUserId: r.to_user_id, amountCents: owed(s), label: label(r.note), messageId })
      await q.query('UPDATE requests SET paid_cents = paid_cents + $2 WHERE message_id = $1', [messageId, owed(s)])
      emitBalances(out, result)
    }
    await closeShare(q, ctx.pinless, s, 'covered')
    await settle(q, messageId)
    return announceUpdate(q, out, messageId)
  })
}

export async function cancelSplit(ctx: Ctx, me: UserRow, messageId: string, body: CancelSplitBody): Promise<Message> {
  const r = await requireOrganiser(ctx.db, messageId, me)
  if (body.refund && r.to_user_id !== me.id) throw validation('The money went to the person being paid. Ask them to refund it')
  await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    await requireOrganiser(q, messageId, me, true)
    const shares = (await q.query<ShareRow>('SELECT * FROM split_shares WHERE message_id = $1 ORDER BY position FOR UPDATE', [messageId])).map(toShare)
    for (const s of shares) if (s.status === 'awaiting' || s.status === 'collecting') await closeShare(q, ctx.pinless, s, 'cancelled')
    let refunded = 0
    if (body.refund) {
      for (const s of shares.filter((x) => x.user_id !== me.id && x.paid_cents > 0)) {
        const result = await ctx.ledger.transfer(q, { kind: 'request', fromUserId: me.id, toUserId: s.user_id, amountCents: s.paid_cents, label: `${label(r.note)} · refund`, messageId })
        emitBalances(out, result)
        refunded += s.paid_cents
      }
    }
    await q.query(`UPDATE requests SET status = 'cancelled', paid_cents = paid_cents - $2, updated_at = now() WHERE message_id = $1`, [messageId, refunded])
    const affected = shares.filter((s) => s.user_id !== me.id && (s.status === 'awaiting' || s.status === 'collecting' || (body.refund && s.paid_cents > 0)))
    out.notify({
      userIds: affected.map((s) => s.user_id),
      category: 'requests',
      title: 'Split bill cancelled',
      body: `${me.name} cancelled ${quoted(r.note)}. Nothing more will be taken${body.refund ? ', and what you paid is back in your wallet' : ''}.`,
      data: { chatId: r.chat_id },
    })
    return announceUpdate(q, out, messageId)
  })
}

/** Split bills I organised or am part of, newest first. */
export async function listSplits(q: Queryable, userId: string): Promise<Message[]> {
  const rows = await q.query<{ message_id: string }>(
    `SELECT r.message_id FROM requests r JOIN messages m ON m.id = r.message_id
     WHERE r.kind = 'split' AND (r.requester_id = $1 OR EXISTS (SELECT 1 FROM split_shares s WHERE s.message_id = r.message_id AND s.user_id = $1))
     ORDER BY m.seq DESC LIMIT 100`,
    [userId],
  )
  return (await loadMessages(q, rows.map((r) => r.message_id))).reverse()
}

// ---------- sweeper: reminders, expiry, lapse, collection ----------

/** One pass: remind, expire unapproved shares, lapse overdue collection, and collect from everyone who can pay. */
export async function sweepSplits(ctx: Ctx): Promise<void> {
  const settings = await getSplitSettings(ctx.db)
  const now = Date.now()
  const open = (
    await ctx.db.query<ShareRow & { requester_id: string; note: string | null; chat_id: string; organiser: string }>(
      `SELECT s.*, r.requester_id, r.note, m.chat_id, u.name AS organiser FROM split_shares s
       JOIN requests r ON r.message_id = s.message_id JOIN messages m ON m.id = r.message_id JOIN users u ON u.id = r.requester_id
       WHERE s.status IN ('awaiting', 'collecting') AND r.status = 'pending'`,
    )
  ).map((s) => ({ ...s, ...toShare(s) }))

  for (const s of open) {
    const ended = s.status === 'awaiting' ? s.approve_by && new Date(s.approve_by).getTime() <= now : s.collect_until && new Date(s.collect_until).getTime() <= now
    if (ended) {
      const status: SplitShareStatus = s.status === 'awaiting' ? 'expired' : 'lapsed'
      await ctx.tx(async (q, out) => {
        const cur = await loadShare(q, s.message_id, s.user_id, true)
        if (cur?.status !== s.status) return
        await closeShare(q, ctx.pinless, cur, status)
        const name = (await getUser(q, s.user_id))?.name ?? 'Someone'
        const what = status === 'expired'
          ? `${name} didn’t approve their share of ${quoted(s.note)} in time`
          : `Collection from ${name} for ${quoted(s.note)} stopped with ${formatM(owed(cur))} unpaid`
        out.notify({ userIds: [s.requester_id], category: 'requests', title: 'Split bill needs you', body: `${what}. Open it to move it to someone else, cover it, or cancel.`, data: { chatId: s.chat_id } })
        out.notify({
          userIds: [s.user_id],
          category: 'requests',
          title: 'Split bill closed',
          body: status === 'expired' ? `The request for ${quoted(s.note)} expired.` : `Nothing more will be taken for ${quoted(s.note)}. You still owe ${s.organiser} ${formatM(owed(cur))}.`,
          data: { chatId: s.chat_id },
        })
        await announceUpdate(q, out, s.message_id)
      })
      continue
    }
    const at = settings.reminderHours[s.reminders]
    if (s.status === 'awaiting' && at !== undefined && now - new Date(s.created_at).getTime() >= at * 3600_000) {
      await ctx.tx(async (q, out) => {
        const [bumped] = await q.query('UPDATE split_shares SET reminders = reminders + 1 WHERE message_id = $1 AND user_id = $2 AND reminders = $3 RETURNING 1', [s.message_id, s.user_id, s.reminders])
        if (!bumped) return
        out.notify({
          userIds: [s.user_id],
          category: 'requests',
          title: 'Split bill waiting',
          body: `${s.organiser} asked you to approve ${s.amount_cents != null ? formatM(s.amount_cents) : 'your share'} for ${quoted(s.note)}. Approve or decline it in the chat.`,
          data: { chatId: s.chat_id },
        })
      })
    }
  }
  for (const userId of new Set(open.filter((s) => s.status === 'collecting').map((s) => s.user_id))) await collectFor(ctx, userId)
}

export function createSplitSweeper(ctx: Ctx, everyMs = 60_000) {
  let timer: NodeJS.Timeout | null = null
  // One collection per wallet at a time; money that arrives meanwhile triggers one more pass.
  const running = new Set<string>()
  const again = new Set<string>()
  const onCredit = (userId: string) => {
    if (running.has(userId)) {
      again.add(userId)
      return
    }
    running.add(userId)
    void (async () => {
      try {
        do {
          again.delete(userId)
          await collectFor(ctx, userId)
        } while (again.has(userId))
      } catch (err) {
        ctx.log.error({ err, userId }, 'split collection failed')
      } finally {
        running.delete(userId)
      }
    })()
  }
  const sweep = () => sweepSplits(ctx).catch((err) => ctx.log.error({ err }, 'split sweep failed'))
  return {
    sweep,
    onCredit,
    /** Settles when no collection is running (tests). */
    async idle() {
      while (running.size) await new Promise((r) => setTimeout(r, 5))
    },
    start() {
      timer = setInterval(() => void sweep(), everyMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
