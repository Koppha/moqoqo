// Every money movement: one DB transaction, wallets locked by the ledger, a ledger row, chat messages,
// and realtime events delivered after COMMIT.
import {
  NO_PIN_TAP_LIMIT,
  type BillKey,
  type BillResult,
  type CashInBody,
  type CashOutBody,
  type ChargeBody,
  type CreateRequestBody,
  type Message,
  type MoneyResult,
  type PayBillBody,
  type PayMerchantBody,
  type PayRequestBody,
  type PayRequestResult,
  type PublicUser,
  type RegisterCustomerBody,
  type RequestKind,
  type SendManyBody,
  type SendManyResult,
  type SendMoneyBody,
  SEND_MANY_MAX,
  type TapBody,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { TransactionRow, TransferResult, TxKind } from '../ecocash/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { hashSecret, newId } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import type { Outbox } from '../realtime/outbox'
import { BILLERS, billerAccount, lecTokenText, parseBill, vendLecToken } from './billers'
import { announceUpdate, ensurePairChat, loadMessages, postMessage, requireMember } from './chats'
import { checkPin, parsePin } from './pins'
import { declineShare, payShareNow } from './splits'
import { recordBlocked, RiskBlocked } from './risk'
import { toTransaction } from './transactions'
import { displayName, getUser, getUsers, requireByNumberOrUsername, requireWallet, toPublicUser, type UserRow } from './users'

function emitBalances(out: Outbox, result: TransferResult) {
  for (const [userId, cents] of result.balances) out.balance(userId, cents)
}

async function moneyResult(q: Queryable, me: UserRow, result: TransferResult, message?: Message): Promise<MoneyResult> {
  const users = await getUsers(q, [result.tx.from_user_id, result.tx.to_user_id].filter((x): x is string => !!x))
  const balance = result.balances.get(me.id) ?? users.get(me.id)?.balance_cents ?? me.balance_cents
  const r: MoneyResult = { balance: fromCents(balance), transaction: toTransaction(result.tx, me.id, users) }
  if (message) r.message = message
  return r
}

const clean = (s: string | undefined | null, max: number, field: string): string | null => {
  const v = s?.trim()
  if (!v) return null
  if (v.length > max) throw validation(`${field} must be at most ${max} characters`)
  return v
}

/** Posts an LEC token text from the LEC official account into its official chat with `userId`. */
async function deliverLecToken(q: Queryable, out: Outbox, userId: string, account: string, amountCents: number) {
  const lec = await billerAccount(q, 'lec')
  const { token, units, kwh } = vendLecToken(amountCents)
  const { chatId } = await ensurePairChat(q, out, lec.id, userId, { kind: 'official' })
  const message = await postMessage(q, out, { chatId, senderId: lec.id, kind: 'text', text: lecTokenText(account, amountCents, token, kwh) })
  return { token, units, message }
}

const billLabel = (bill: BillKey, account: string) => `${BILLERS[bill].label} · ${account}`

// ---------- send (money / mpho) ----------

/** `pinConfirmed`: a stop order paying on its day (the PIN was given when it was set up). */
export interface PayOptions { pinConfirmed?: boolean }

export async function sendMoney(ctx: Ctx, me: UserRow, body: SendMoneyBody, opts: PayOptions = {}): Promise<MoneyResult> {
  const amountCents = paymentCents(body.amount)
  const note = clean(body.note, 140, 'note')
  await requireMember(ctx.db, body.chatId, me.id)
  if (body.toUserId === me.id) throw validation('You cannot send money to yourself')
  const [member] = await ctx.db.query<{ kind: string }>(
    'SELECT u.kind FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = $1 AND cm.user_id = $2',
    [body.chatId, body.toUserId],
  )
  if (!member) throw validation('toUserId must be a member of the chat')
  if (member.kind !== 'person') throw validation('Use bill payments to pay a biller')
  if (!opts.pinConfirmed) await checkPin(ctx.db, me, body.pin)

  return ctx.tx(async (q, out) => {
    const messageId = newId()
    const result = await ctx.ledger.transfer(q, {
      kind: body.kind === 'mpho' ? 'mpho' : 'send',
      fromUserId: me.id,
      toUserId: body.toUserId,
      amountCents,
      note,
      messageId,
    })
    const message = await postMessage(q, out, {
      id: messageId,
      chatId: body.chatId,
      senderId: me.id,
      clientId: body.clientId,
      kind: body.kind,
      amountCents,
      note,
    })
    emitBalances(out, result)
    return moneyResult(q, me, result, message)
  })
}

/**
 * Send to many: one PIN, then each person is paid in their own DB transaction (as the EcoCash API pays one person per
 * call), so a failure for one person does not stop the others. Each person gets the money in their chat with you.
 * A retry with the same clientId skips whoever was already paid (their chat already has the message).
 */
export async function sendMany(ctx: Ctx, me: UserRow, body: SendManyBody): Promise<SendManyResult> {
  if (!body.recipients.length) throw validation('Add at least one person')
  if (body.recipients.length > SEND_MANY_MAX) throw validation(`Send to at most ${SEND_MANY_MAX} people at once`)
  const note = clean(body.note, 140, 'note')
  const list = body.recipients.map((r) => ({ to: r.to, amountCents: paymentCents(r.amount) }))
  const totalCents = list.reduce((a, x) => a + x.amountCents, 0)
  await checkPin(ctx.db, me, body.pin)

  // One batch per clientId, so a retry is the same batch for the velocity rule.
  const [batch] = await ctx.db.query<{ id: string }>(
    `INSERT INTO send_batches (id, user_id, client_id, total_cents, recipients, note, result) VALUES ($1, $2, $3, $4, $5, $6, '{}')
     ON CONFLICT (user_id, client_id) DO UPDATE SET total_cents = EXCLUDED.total_cents RETURNING id`,
    [newId(), me.id, body.clientId, totalCents, list.length, note],
  )
  const payments: SendManyResult['payments'] = []
  const seen = new Set<string>()
  let sentCents = 0
  for (const { to, amountCents } of list) {
    const amount = fromCents(amountCents)
    let user: UserRow | null = null
    try {
      user = await requireByNumberOrUsername(ctx.db, to)
      if (user.id === me.id) throw validation('You cannot send money to yourself')
      if (seen.has(user.id)) throw validation(`${displayName(user)} is already in this list`)
      seen.add(user.id)
      const payee = user
      const paid = await ctx.tx(async (q, out) => {
        const { chatId } = await ensurePairChat(q, out, me.id, payee.id, { creatorId: me.id })
        const [done] = await q.query<{ id: string }>('SELECT id FROM messages WHERE chat_id = $1 AND sender_id = $2 AND client_id = $3', [chatId, me.id, body.clientId])
        if (done) {
          const [message] = await loadMessages(q, [done.id])
          const [row] = await q.query<TransactionRow>('SELECT * FROM transactions WHERE message_id = $1', [done.id])
          return { chatId, message, transaction: toTransaction(row, me.id, await getUsers(q, [me.id, payee.id])) }
        }
        const messageId = newId()
        const result = await ctx.ledger.transfer(q, { kind: 'send', fromUserId: me.id, toUserId: payee.id, amountCents, note, messageId, batchId: batch.id })
        const message = await postMessage(q, out, { id: messageId, chatId, senderId: me.id, clientId: body.clientId, kind: 'money', amountCents, note })
        emitBalances(out, result)
        return { chatId, message, transaction: toTransaction(result.tx, me.id, await getUsers(q, [me.id, payee.id])) }
      })
      sentCents += amountCents
      payments.push({ to, amount, user: toPublicUser(user), ok: true, ...paid })
    } catch (e) {
      if (!(e instanceof AppError)) throw e
      // The request carries on, so a blocked payment is recorded here rather than by the error handler.
      if (e instanceof RiskBlocked) await recordBlocked(ctx.db, e)
      payments.push({ to, amount, user: user && toPublicUser(user), ok: false, error: { code: e.code, message: e.message } })
    }
  }
  const balance = fromCents((await getUser(ctx.db, me.id))!.balance_cents)
  const result: SendManyResult = { balance, total: fromCents(sentCents), payments }
  await ctx.db.query('UPDATE send_batches SET result = $2 WHERE id = $1', [batch.id, JSON.stringify(result)])
  return result
}

// ---------- requests ----------

export async function createRequest(ctx: Ctx, me: UserRow, body: CreateRequestBody): Promise<Message> {
  const amountCents = paymentCents(body.amount)
  const chat = await requireMember(ctx.db, body.chatId, me.id)
  if (chat.kind === 'official') throw validation('You cannot send requests to an official account')
  const note = clean(body.note, 140, 'note')
  const detail = clean(body.detail, 140, 'detail')
  let toUserId = me.id
  let bill: BillKey | null = null
  let account: string | null = null
  if (body.kind === 'bill') {
    bill = parseBill(body.bill)
    account = clean(body.account, 40, 'account')
    if (!account) throw validation('account is required for bill requests')
    toUserId = (await billerAccount(ctx.db, bill)).id
  }
  return ctx.tx((q, out) =>
    postMessage(q, out, {
      chatId: body.chatId,
      senderId: me.id,
      clientId: body.clientId,
      kind: 'request',
      request: { kind: body.kind, requesterId: me.id, toUserId, amountCents, bill, account, detail, note },
    }),
  )
}

interface RequestRow {
  message_id: string
  kind: RequestKind
  requester_id: string
  to_user_id: string
  amount_cents: number
  paid_cents: number
  status: string
  bill: BillKey | null
  account: string | null
  paid_by_name: string | null
  note: string | null
  chat_id: string
  chat_kind: string
}

async function loadRequest(q: Queryable, messageId: string, me: UserRow, lock = false): Promise<RequestRow> {
  const [r] = await q.query<RequestRow>(
    `SELECT r.*, m.chat_id, c.kind AS chat_kind
     FROM requests r JOIN messages m ON m.id = r.message_id JOIN chats c ON c.id = m.chat_id
     WHERE r.message_id = $1 ${lock ? 'FOR UPDATE OF r' : ''}`,
    [messageId],
  )
  if (!r) throw notFound('Request not found')
  await requireMember(q, r.chat_id, me.id)
  if (r.requester_id === me.id) throw forbidden('This is your own request')
  return r
}

const LEDGER_KIND: Record<RequestKind, TxKind> = { money: 'request', bill: 'bill', cashout: 'cashout', merchant: 'merchant', split: 'request' }

export async function payRequest(ctx: Ctx, me: UserRow, messageId: string, body: PayRequestBody): Promise<PayRequestResult> {
  const pre = await loadRequest(ctx.db, messageId, me)
  if (pre.status !== 'pending') throw conflict(`This request is already ${pre.status}`)
  if (body.amount !== undefined) paymentCents(body.amount)
  await checkPin(ctx.db, me, body.pin)

  return ctx.tx(async (q, out) => {
    const r = await loadRequest(q, messageId, me, true)
    if (r.status !== 'pending') throw conflict(`This request is already ${r.status}`)
    if (r.kind === 'split') return payShareNow(ctx, q, out, me, messageId, body)
    const due = r.amount_cents - r.paid_cents
    const payCents = body.amount === undefined ? due : paymentCents(body.amount)
    if (payCents > due) throw validation(`Only ${formatM(due)} is still due`)
    if (payCents < due && r.chat_kind !== 'group') throw validation('Partial payments are only possible in group chats')

    const result = await ctx.ledger.transfer(q, {
      kind: LEDGER_KIND[r.kind],
      fromUserId: me.id,
      toUserId: r.to_user_id,
      amountCents: payCents,
      label: r.bill ? billLabel(r.bill, r.account ?? '') : null,
      note: r.note,
      messageId,
    })
    const names = new Set((r.paid_by_name ?? '').split(', ').filter(Boolean))
    names.add(me.name)
    const paid = r.paid_cents + payCents
    await q.query(
      `UPDATE requests SET paid_cents = $2, status = $3, paid_by_name = $4, updated_at = now() WHERE message_id = $1`,
      [messageId, paid, paid >= r.amount_cents ? 'paid' : 'pending', [...names].join(', ')],
    )
    const message = await announceUpdate(q, out, messageId)
    emitBalances(out, result)
    const res: PayRequestResult = { ...(await moneyResult(q, me, result)), message }
    if (r.bill === 'lec') {
      // The token belongs to whoever asked for the electricity: post it to the REQUESTER.
      const lec = await deliverLecToken(q, out, r.requester_id, r.account ?? '', payCents)
      res.token = lec.token
      res.units = lec.units
    }
    return res
  })
}

export async function declineRequest(ctx: Ctx, me: UserRow, messageId: string): Promise<Message> {
  return ctx.tx(async (q, out) => {
    const r = await loadRequest(q, messageId, me, true)
    if (r.kind === 'split') return declineShare(ctx, q, out, me, messageId)
    if (r.status !== 'pending') throw conflict(`This request is already ${r.status}`)
    await q.query(`UPDATE requests SET status = 'declined', updated_at = now() WHERE message_id = $1`, [messageId])
    return announceUpdate(q, out, messageId)
  })
}

// ---------- bills ----------

export async function payBill(ctx: Ctx, me: UserRow, body: PayBillBody, opts: PayOptions = {}): Promise<BillResult> {
  const bill = parseBill(body.bill)
  const account = clean(body.account, 40, 'account')
  if (!account) throw validation('account is required')
  const amountCents = paymentCents(body.amount)
  if (!opts.pinConfirmed) await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    const biller = await billerAccount(q, bill)
    const result = await ctx.ledger.transfer(q, { kind: 'bill', fromUserId: me.id, toUserId: biller.id, amountCents, label: billLabel(bill, account) })
    emitBalances(out, result)
    const res: BillResult = await moneyResult(q, me, result)
    if (bill === 'lec') {
      const lec = await deliverLecToken(q, out, me.id, account, amountCents)
      Object.assign(res, { token: lec.token, units: lec.units, message: lec.message })
    }
    return res
  })
}

// ---------- tap ----------

export async function tap(ctx: Ctx, me: UserRow, body: TapBody): Promise<MoneyResult> {
  const amountCents = paymentCents(body.amount)
  const merchant = await requireMerchant(ctx.db, body.merchantCode)
  if (merchant.id === me.id) throw validation('You cannot pay yourself')
  if (amountCents > NO_PIN_TAP_LIMIT * 100 && body.pin === undefined) {
    throw validation(`A PIN is required for taps over ${formatM(NO_PIN_TAP_LIMIT * 100)}`)
  }
  if (body.pin !== undefined) await checkPin(ctx.db, me, body.pin)

  return ctx.tx(async (q, out) => {
    const { result, message } = await payMerchantInTx(ctx, q, out, me, merchant, amountCents, 'tap', `Tap to pay · ${displayName(merchant)}`)
    return moneyResult(q, me, result, message)
  })
}

/**
 * Customer → merchant (or agent, for a cash-out) inside an open DB transaction: ledger row (wallets locked by
 * the ledger), a receipt from the payer in their direct chat with the business (created if needed), balance events.
 */
export async function payMerchantInTx(
  ctx: Ctx,
  q: Queryable,
  out: Outbox,
  payer: UserRow,
  merchant: UserRow,
  amountCents: number,
  kind: 'tap' | 'qr' | 'cashout',
  note: string,
): Promise<{ result: TransferResult; message: Message }> {
  if (payer.id === merchant.id) throw validation('You cannot pay yourself')
  const messageId = newId()
  const result = await ctx.ledger.transfer(q, { kind, fromUserId: payer.id, toUserId: merchant.id, amountCents, note: kind === 'tap' ? null : note, messageId })
  const { chatId } = await ensurePairChat(q, out, payer.id, merchant.id, { creatorId: payer.id })
  const message = await postMessage(q, out, { id: messageId, chatId, senderId: payer.id, kind: 'receipt', amountCents, note })
  emitBalances(out, result)
  return { result, message }
}

export { moneyResult }

/** A merchant wallet by its code (1042, 1001). Throws NOT_FOUND. */
export async function requireMerchant(q: Queryable, rawCode: unknown): Promise<UserRow> {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  const [merchant] = await q.query<UserRow>(`SELECT * FROM users WHERE code = $1 AND role = 'merchant' AND kind = 'person'`, [code])
  if (!merchant) throw notFound(`No merchant with code ${code || '(empty)'}`)
  return merchant
}

/** Static merchant QR (printed sticker): the customer types the amount. PIN always. */
export async function payMerchantQr(ctx: Ctx, me: UserRow, body: PayMerchantBody): Promise<MoneyResult> {
  const amountCents = paymentCents(body.amount)
  const note = clean(body.note, 140, 'note')
  const merchant = await requireMerchant(ctx.db, body.merchantCode)
  if (merchant.id === me.id) throw validation('You cannot pay yourself')
  await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    const { result, message } = await payMerchantInTx(ctx, q, out, me, merchant, amountCents, 'qr', note ?? `QR payment · ${displayName(merchant)}`)
    return moneyResult(q, me, result, message)
  })
}

// ---------- agents ----------

export async function cashIn(ctx: Ctx, agent: UserRow, body: CashInBody): Promise<MoneyResult> {
  const amountCents = paymentCents(body.amount)
  const customer = await requireWallet(ctx.db, normalizeMsisdn(body.customerMsisdn, 'customerMsisdn'))
  if (customer.id === agent.id) throw validation('You cannot cash in to your own wallet')
  await checkPin(ctx.db, agent, body.pin)
  return ctx.tx(async (q, out) => {
    const messageId = newId()
    const result = await ctx.ledger.transfer(q, { kind: 'cashin', fromUserId: agent.id, toUserId: customer.id, amountCents, messageId })
    const { chatId } = await ensurePairChat(q, out, agent.id, customer.id, { creatorId: agent.id })
    const message = await postMessage(q, out, {
      id: messageId,
      chatId,
      senderId: agent.id,
      kind: 'money',
      amountCents,
      note: `Cash-in · ${agent.code ?? displayName(agent)}`,
    })
    emitBalances(out, result)
    return moneyResult(q, agent, result, message)
  })
}

/** Business user asks a customer (in their direct chat) to approve a payment. */
async function businessRequest(ctx: Ctx, from: UserRow, msisdn: string, kind: 'cashout' | 'merchant', amount: number, note: string | null) {
  const amountCents = paymentCents(amount)
  const customer = await requireWallet(ctx.db, normalizeMsisdn(msisdn, 'customerMsisdn'))
  if (customer.id === from.id) throw validation('You cannot charge yourself')
  return ctx.tx(async (q, out) => {
    const { chatId } = await ensurePairChat(q, out, from.id, customer.id, { creatorId: from.id })
    return postMessage(q, out, {
      chatId,
      senderId: from.id,
      kind: 'request',
      request: {
        kind,
        requesterId: from.id,
        toUserId: from.id,
        amountCents,
        detail: kind === 'cashout' ? `Cash-out at ${displayName(from)}${from.code ? ` · ${from.code}` : ''}` : displayName(from),
        note,
      },
    })
  })
}

export const cashOut = (ctx: Ctx, agent: UserRow, body: CashOutBody) => businessRequest(ctx, agent, body.customerMsisdn, 'cashout', body.amount, null)

export const charge = (ctx: Ctx, merchant: UserRow, body: ChargeBody) =>
  businessRequest(ctx, merchant, body.customerMsisdn, 'merchant', body.amount, clean(body.note, 140, 'note'))

export async function registerCustomer(ctx: Ctx, agent: UserRow, body: RegisterCustomerBody): Promise<PublicUser> {
  const msisdn = normalizeMsisdn(body.msisdn)
  const name = clean(body.name, 60, 'name')
  if (!name) throw validation('name is required')
  const { hash, salt } = await hashSecret(parsePin(body.pin))
  return ctx.tx(async (q) => {
    const [exists] = await q.query('SELECT 1 FROM users WHERE msisdn = $1', [msisdn])
    if (exists) throw conflict(`${msisdn} already has a wallet`)
    const id = newId()
    await q.query(
      `INSERT INTO users (id, msisdn, name, role, kyc_tier, pin_hash, pin_salt) VALUES ($1, $2, $3, 'customer', 1, $4, $5)`,
      [id, msisdn, name, hash, salt],
    )
    // Zero-value ledger row so the registration shows in the agent's activity.
    await ctx.ledger.transfer(q, { kind: 'register', fromUserId: agent.id, toUserId: id, amountCents: 0 })
    return toPublicUser((await getUser(q, id))!)
  })
}

