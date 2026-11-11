import type { AssistantAction, BillKey, CauseStatus, ChatKind, NotifyCategory, ChatSummary, Message, MessageKind, RequestInfo, RequestKind, RequestStatus, SplitMethod, SplitMode, SplitShare, SplitShareStatus } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents } from '../lib/money'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { displayName, getUsers, toPublicUser, type UserRow } from './users'

// ---------- messages ----------

interface MessageRow {
  id: string
  seq: number
  chat_id: string
  sender_id: string
  client_id: string | null
  kind: MessageKind
  text: string | null
  amount_cents: number | null
  note: string | null
  action: AssistantAction | null
  created_at: Date
  c_id: string | null
  c_code: string | null
  c_title: string | null
  c_target: number | null
  c_raised: number | null
  c_donors: number | null
  c_status: CauseStatus | null
  r_kind: RequestKind | null
  r_requester: string | null
  r_to: string | null
  r_amount: number | null
  r_paid: number | null
  r_status: RequestStatus | null
  r_bill: BillKey | null
  r_account: string | null
  r_detail: string | null
  r_note: string | null
  r_paid_by: string | null
  r_split: SplitMethod | null
  r_split_mode: SplitMode | null
  r_split_payee: string | null
}

const MESSAGE_SELECT = `
  SELECT m.id, m.seq, m.chat_id, m.sender_id, m.client_id, m.kind, m.text, m.amount_cents, m.note, m.action, m.created_at,
         r.kind AS r_kind, r.requester_id AS r_requester, r.to_user_id AS r_to, r.amount_cents AS r_amount,
         r.paid_cents AS r_paid, r.status AS r_status, r.bill AS r_bill, r.account AS r_account,
         r.detail AS r_detail, r.note AS r_note, r.paid_by_name AS r_paid_by, r.split_method AS r_split,
         r.split_mode AS r_split_mode, r.split_payee_id AS r_split_payee,
         c.id AS c_id, c.code AS c_code, c.title AS c_title, c.target_cents AS c_target, c.raised_cents AS c_raised,
         c.donor_count AS c_donors, c.status AS c_status
  FROM messages m LEFT JOIN requests r ON r.message_id = m.id LEFT JOIN causes c ON c.id = m.cause_id`

function toMessage(r: MessageRow): Message {
  const m: Message = { id: r.id, chatId: r.chat_id, senderId: r.sender_id, kind: r.kind, createdAt: iso(r.created_at) }
  if (r.client_id) m.clientId = r.client_id
  if (r.text != null) m.text = r.text
  if (r.amount_cents != null) m.amount = fromCents(r.amount_cents)
  if (r.note != null) m.note = r.note
  if (r.action) m.action = r.action
  if (r.c_id) {
    m.cause = {
      id: r.c_id,
      code: r.c_code!,
      title: r.c_title!,
      target: fromCents(Number(r.c_target)),
      raised: fromCents(Number(r.c_raised)),
      donorCount: r.c_donors ?? 0,
      status: r.c_status!,
    }
  }
  if (r.r_kind) {
    const req: RequestInfo = {
      kind: r.r_kind,
      amount: fromCents(r.r_amount),
      paid: fromCents(r.r_paid),
      status: r.r_status!,
      toUserId: r.r_to!,
    }
    if (r.r_bill) req.bill = r.r_bill
    if (r.r_account) req.account = r.r_account
    if (r.r_detail) req.detail = r.r_detail
    if (r.r_note) req.note = r.r_note
    if (r.r_paid_by) req.paidByName = r.r_paid_by
    if (r.r_split) {
      req.split = { method: r.r_split, mode: r.r_split_mode ?? 'organiser', shares: [] }
      if (r.r_split_payee) req.split.payee = { id: r.r_split_payee, name: '' }
    }
    m.request = req
  }
  return m
}

/** Rows → messages, with split-bill shares filled in (one extra query when the page has splits). */
async function toMessages(q: Queryable, rows: MessageRow[]): Promise<Message[]> {
  const messages = rows.map(toMessage)
  const splits = messages.filter((m) => m.request?.split)
  if (!splits.length) return messages
  const shares = await q.query<{
    message_id: string; user_id: string; name: string; amount_cents: number | null; paid_cents: number; paid_at: Date | null
    status: SplitShareStatus; approve_by: Date | null; collect_until: Date | null
  }>(
    `SELECT s.message_id, s.user_id, u.name, s.amount_cents, s.paid_cents, s.paid_at, s.status, s.approve_by, s.collect_until
     FROM split_shares s JOIN users u ON u.id = s.user_id WHERE s.message_id = ANY($1) ORDER BY s.position`,
    [splits.map((m) => m.id)],
  )
  const payees = await getUsers(q, splits.map((m) => m.request!.split!.payee?.id).filter((x): x is string => !!x))
  for (const m of splits) {
    const payee = m.request!.split!.payee
    if (payee) payee.name = (payees.get(payee.id) && displayName(payees.get(payee.id)!)) || payee.name
    m.request!.split!.shares = shares.filter((s) => s.message_id === m.id).map((s) => {
      const share: SplitShare = { userId: s.user_id, name: s.name, paid: fromCents(Number(s.paid_cents)), status: s.status }
      if (s.amount_cents != null) share.amount = fromCents(Number(s.amount_cents))
      if (s.paid_at) share.paidAt = iso(s.paid_at)
      if (s.status === 'awaiting' && s.approve_by) share.approveBy = iso(s.approve_by)
      if (s.status === 'collecting' && s.collect_until) share.collectUntil = iso(s.collect_until)
      return share
    })
  }
  return messages
}

export async function loadMessages(q: Queryable, ids: string[]): Promise<Message[]> {
  if (!ids.length) return []
  const rows = await q.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ANY($1) ORDER BY m.seq`, [ids])
  return toMessages(q, rows)
}

export async function loadMessage(q: Queryable, id: string): Promise<Message> {
  const [m] = await loadMessages(q, [id])
  if (!m) throw notFound('Message not found')
  return m
}

/** Page of messages, oldest first, strictly before the `before` message when given. */
export async function listMessages(q: Queryable, chatId: string, before: string | undefined, limit: number): Promise<Message[]> {
  let beforeSeq: number | null = null
  if (before) {
    const [b] = await q.query<{ seq: number }>('SELECT seq FROM messages WHERE id = $1 AND chat_id = $2', [before, chatId])
    if (!b) throw new AppError('VALIDATION', 'before must be a message id in this chat')
    beforeSeq = b.seq
  }
  const rows = await q.query<MessageRow>(
    `SELECT * FROM (${MESSAGE_SELECT} WHERE m.chat_id = $1 AND ($2::bigint IS NULL OR m.seq < $2) ORDER BY m.seq DESC LIMIT $3) page ORDER BY seq`,
    [chatId, beforeSeq, limit],
  )
  return toMessages(q, rows)
}

// ---------- chats ----------

interface ChatRow {
  id: string
  kind: ChatKind
  title: string | null
  pair_key: string | null
  created_by: string | null
  updated_at: Date
}

export async function memberIds(q: Queryable, chatId: string): Promise<string[]> {
  return (await q.query<{ user_id: string }>('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId])).map((r) => r.user_id)
}

/** Throws NOT_FOUND unless userId is a member (do not reveal other people's chats). */
export async function requireMember(q: Queryable, chatId: string, userId: string): Promise<ChatRow> {
  const [c] = await q.query<ChatRow>(
    'SELECT c.* FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2 WHERE c.id = $1 AND c.deleted_at IS NULL',
    [chatId, userId],
  )
  if (!c) throw notFound('Chat not found')
  return c
}

/** Chat summaries as seen by viewerId (titles differ per viewer for direct chats). Newest first. */
export async function chatSummaries(q: Queryable, viewerId: string, onlyIds?: string[]): Promise<ChatSummary[]> {
  const chats = await q.query<ChatRow & { unread: number; last_id: string | null; request_status: string | null }>(
    `SELECT c.*, cm.request_status,
       (SELECT count(*) FROM messages m
          WHERE m.chat_id = c.id AND m.sender_id <> $1 AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)) AS unread,
       (SELECT m.id FROM messages m WHERE m.chat_id = c.id ORDER BY m.seq DESC LIMIT 1) AS last_id
     FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
     WHERE ($2::text[] IS NULL OR c.id = ANY($2)) AND cm.request_status IS DISTINCT FROM 'declined' AND c.deleted_at IS NULL
     ORDER BY c.updated_at DESC, c.id`,
    [viewerId, onlyIds ?? null],
  )
  if (!chats.length) return []
  const ids = chats.map((c) => c.id)
  const members = await q.query<UserRow & { chat_id: string }>(
    'SELECT cm.chat_id, u.* FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ANY($1) ORDER BY cm.joined_at, u.name',
    [ids],
  )
  const byChat = new Map<string, UserRow[]>()
  for (const m of members) {
    const list = byChat.get(m.chat_id) ?? []
    list.push(m)
    byChat.set(m.chat_id, list)
  }
  const lastMessages = new Map((await loadMessages(q, chats.map((c) => c.last_id).filter((x): x is string => !!x))).map((m) => [m.id, m]))
  return chats.map((c) => {
    const users = byChat.get(c.id) ?? []
    const others = users.filter((u) => u.id !== viewerId)
    const title = c.kind === 'group' ? c.title ?? 'Group' : others[0] ? displayName(others[0]) : 'Chat'
    const s: ChatSummary = {
      id: c.id,
      kind: c.kind,
      title,
      members: users.map(toPublicUser),
      unread: c.unread,
      updatedAt: iso(c.updated_at),
    }
    if (c.kind === 'official' && others[0]?.biller === 'assistant') s.assistant = true
    if (c.kind === 'official' && others[0]?.biller === 'support') s.support = true
    if (c.request_status === 'pending') s.request = true
    if (c.kind === 'group' && c.created_by) s.createdBy = c.created_by
    const last = c.last_id ? lastMessages.get(c.last_id) : undefined
    if (last) s.lastMessage = last
    return s
  })
}

/**
 * A request or split in the chat that is still open: for anyone (`userId` null), or one the user owes or is owed.
 * Groups can't be deleted, or left, while one is: nobody's share is stranded.
 */
async function openRequests(q: Queryable, chatId: string, userId: string | null): Promise<boolean> {
  const rows = await q.query(
    `SELECT 1 FROM requests r JOIN messages m ON m.id = r.message_id
     WHERE m.chat_id = $1 AND r.status = 'pending'
       AND ($2::text IS NULL OR r.requester_id = $2 OR r.to_user_id = $2
         OR EXISTS (SELECT 1 FROM split_shares s WHERE s.message_id = r.message_id AND s.user_id = $2 AND s.status IN ('awaiting', 'collecting')))
     LIMIT 1`,
    [chatId, userId],
  )
  return rows.length > 0
}

/** The person who made a group deletes it for everyone. Hidden, not erased: payments keep pointing at its messages. */
export async function deleteGroup(q: Queryable, out: Outbox, chatId: string, userId: string) {
  const chat = await requireMember(q, chatId, userId)
  if (chat.kind !== 'group') throw validation('Only groups can be deleted')
  if (chat.created_by !== userId) throw forbidden('Only the person who made this group can delete it. You can leave it')
  if (await openRequests(q, chatId, null)) throw conflict('This group has requests or split bills still open. Settle or cancel them first')
  const members = await memberIds(q, chatId)
  await q.query('UPDATE chats SET deleted_at = now() WHERE id = $1', [chatId])
  out.to(members, { type: 'chat.removed', chatId })
}

/** A member leaves a group (the one who made it deletes it instead). The others see "Name left". */
export async function leaveGroup(q: Queryable, out: Outbox, chatId: string, userId: string) {
  const chat = await requireMember(q, chatId, userId)
  if (chat.kind !== 'group') throw validation('Only groups can be left')
  if (chat.created_by === userId) throw validation('You made this group. Delete it instead')
  if (await openRequests(q, chatId, userId)) throw conflict('You still owe, or are owed, money in this group. Settle it first')
  const me = (await getUsers(q, [userId])).get(userId)
  await q.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
  out.to([userId], { type: 'chat.removed', chatId })
  await postMessage(q, out, { chatId, senderId: userId, kind: 'system', text: `${me ? displayName(me) : 'Someone'} left the group` })
}

export async function announceChat(q: Queryable, out: Outbox, chatId: string, userIds: string[]) {
  for (const userId of userIds) {
    const [summary] = await chatSummaries(q, userId, [chatId])
    if (summary) out.to([userId], { type: 'chat.created', chat: summary })
  }
}

/**
 * Get-or-create the 1:1 chat between two wallets (kind 'direct', or 'official' when one side is an
 * official system account). New chats are announced with chat.created to every member except `creatorId`.
 */
export async function ensurePairChat(
  q: Queryable,
  out: Outbox,
  a: string,
  b: string,
  opts: { kind?: 'direct' | 'official'; creatorId?: string } = {},
): Promise<{ chatId: string; created: boolean }> {
  if (a === b) throw new AppError('VALIDATION', 'You cannot start a chat with yourself')
  const kind = opts.kind ?? 'direct'
  const pairKey = `${kind}:${[a, b].sort().join(':')}`
  const id = newId()
  const inserted = await q.query<{ id: string }>(
    `INSERT INTO chats (id, kind, pair_key, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (pair_key) DO NOTHING RETURNING id`,
    [id, kind, pairKey, opts.creatorId ?? null],
  )
  if (!inserted.length) {
    const [existing] = await q.query<{ id: string }>('SELECT id FROM chats WHERE pair_key = $1', [pairKey])
    return { chatId: existing.id, created: false }
  }
  await q.query('INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3)', [id, a, b])
  if (kind === 'direct' && opts.creatorId) {
    const other = opts.creatorId === a ? b : a
    await q.query(
      `UPDATE chat_members SET request_status = 'pending' WHERE chat_id = $1 AND user_id = $2
         AND (SELECT message_policy FROM users WHERE id = $2) = 'friends'
         AND NOT EXISTS (SELECT 1 FROM friendships WHERE user_id = $2 AND friend_id = $3)`,
      [id, other, opts.creatorId],
    )
  }
  await announceChat(q, out, id, [a, b].filter((u) => u !== opts.creatorId))
  return { chatId: id, created: true }
}

export async function createGroup(q: Queryable, out: Outbox, creatorId: string, title: string, memberIds: string[]): Promise<string> {
  const id = newId()
  await q.query('INSERT INTO chats (id, kind, title, created_by) VALUES ($1, $2, $3, $4)', [id, 'group', title, creatorId])
  const all = [creatorId, ...memberIds.filter((m) => m !== creatorId)]
  for (const userId of new Set(all)) await q.query('INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)', [id, userId])
  await announceChat(q, out, id, all.filter((u) => u !== creatorId))
  return id
}

export async function markRead(q: Queryable, chatId: string, userId: string) {
  await q.query('UPDATE chat_members SET last_read_at = now() WHERE chat_id = $1 AND user_id = $2', [chatId, userId])
}

// ---------- posting ----------

export interface NewRequest {
  kind: RequestKind
  requesterId: string
  toUserId: string
  amountCents: number
  paidCents?: number
  status?: RequestStatus
  bill?: BillKey | null
  account?: string | null
  detail?: string | null
  note?: string | null
  paidByName?: string | null
  splitMethod?: SplitMethod | null
  splitMode?: SplitMode | null
  splitPayeeId?: string | null
  /** Split bills: one row per participant, in display order. paid = the organiser's own share. */
  splitShares?: { userId: string; amountCents: number | null; paidCents: number; status: SplitShareStatus; approveBy: Date | null; payloadId: string | null }[]
}

export interface NewMessage {
  id?: string
  chatId: string
  senderId: string
  kind: MessageKind
  clientId?: string | null
  text?: string | null
  amountCents?: number | null
  note?: string | null
  request?: NewRequest
  action?: AssistantAction | null
  /** kind cause: the cause shown as a card. */
  causeId?: string | null
  createdAt?: Date
  /** No push/SMS/email (e.g. the assistant's welcome when the chat is first created). */
  silent?: boolean
}

function pushBody(m: Message): string {
  switch (m.kind) {
    case 'text':
    case 'system':
    case 'action':
      return m.text ?? ''
    case 'money':
      return `Sent you ${formatM(Math.round((m.amount ?? 0) * 100))}${m.note ? ` · ${m.note}` : ''}`
    case 'mpho':
      return `Mpho ${formatM(Math.round((m.amount ?? 0) * 100))} 🎁`
    case 'receipt':
      return `Receipt ${formatM(Math.round((m.amount ?? 0) * 100))}${m.note ? ` · ${m.note}` : ''}`
    case 'cause':
      return `Please support: ${m.cause?.title ?? 'a cause'}`
    case 'request':
      if (m.request?.split) return `Split bill${m.request.note ? ` · ${m.request.note}` : ''}: approve your share in the chat`
      return `Requests ${formatM(Math.round((m.request?.amount ?? 0) * 100))}${m.request?.detail ? ` · ${m.request.detail}` : ''}`
  }
}

/** Which notification switch a chat message falls under. */
function categoryOf(m: Message, sender: UserRow | undefined): NotifyCategory {
  if (sender?.biller === 'ecosure') return 'ecosure'
  if (m.kind === 'request') return 'requests'
  if (m.kind === 'money' || m.kind === 'mpho' || m.kind === 'receipt') return 'money'
  return 'chats'
}

/** Inserts a message (and its request row), bumps the chat and queues message.created for every member. */
export async function postMessage(q: Queryable, out: Outbox, nm: NewMessage): Promise<Message> {
  const id = nm.id ?? newId()
  await q.query(
    `INSERT INTO messages (id, chat_id, sender_id, client_id, kind, text, amount_cents, note, action, created_at, cause_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()), $11)`,
    [id, nm.chatId, nm.senderId, nm.clientId ?? null, nm.kind, nm.text ?? null, nm.amountCents ?? null, nm.note ?? null, nm.action ? JSON.stringify(nm.action) : null, nm.createdAt ?? null, nm.causeId ?? null],
  )
  if (nm.request) {
    const r = nm.request
    await q.query(
      `INSERT INTO requests (message_id, kind, requester_id, to_user_id, amount_cents, paid_cents, status, bill, account, detail, note, paid_by_name, split_method, split_mode, split_payee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, r.kind, r.requesterId, r.toUserId, r.amountCents, r.paidCents ?? 0, r.status ?? 'pending', r.bill ?? null, r.account ?? null, r.detail ?? null, r.note ?? null, r.paidByName ?? null, r.splitMethod ?? null, r.splitMode ?? null, r.splitPayeeId ?? null],
    )
    for (const [i, s] of (r.splitShares ?? []).entries()) {
      await q.query(
        `INSERT INTO split_shares (message_id, user_id, position, amount_cents, paid_cents, status, paid_at, closed_at, approve_by, payload_id)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'paid' THEN now() END, CASE WHEN $6 = 'paid' THEN now() END, $7, $8)`,
        [id, s.userId, i, s.amountCents, s.paidCents, s.status, s.approveBy, s.payloadId],
      )
    }
  }
  const at = nm.createdAt ?? null
  await q.query('UPDATE chats SET updated_at = GREATEST(updated_at, COALESCE($2, now())) WHERE id = $1', [nm.chatId, at])
  // The sender has read everything up to their own message.
  await q.query('UPDATE chat_members SET last_read_at = COALESCE($3, now()) WHERE chat_id = $1 AND user_id = $2', [nm.chatId, nm.senderId, at])

  const message = await loadMessage(q, id)
  const members = await memberIds(q, nm.chatId)
  out.to(members, { type: 'message.created', message })

  const quiet = new Set((await q.query<{ user_id: string }>('SELECT user_id FROM chat_members WHERE chat_id = $1 AND request_status IS NOT NULL', [nm.chatId])).map((r) => r.user_id))
  const recipients = members.filter((m) => m !== nm.senderId && !quiet.has(m))
  if (recipients.length && !nm.silent) {
    const users = await getUsers(q, [nm.senderId])
    const [chat] = await q.query<{ kind: ChatKind; title: string | null }>('SELECT kind, title FROM chats WHERE id = $1', [nm.chatId])
    const sender = users.get(nm.senderId)
    const senderName = sender ? displayName(sender) : 'EcoCash Super App'
    const category = categoryOf(message, sender)
    out.notify({
      userIds: recipients,
      category,
      title: chat?.kind === 'group' && chat.title ? `${senderName} · ${chat.title}` : senderName,
      body: pushBody(message),
      data: { chatId: nm.chatId, messageId: id },
      // Money messages also come as money alerts by SMS/email (from the ledger); chat text goes by push only.
      channels: category === 'requests' || category === 'ecosure' ? ['push', 'sms', 'email'] : ['push'],
      pushOnlyOffline: true,
    })
  }
  return message
}

/** Reloads a message and queues message.updated for every member of its chat. */
export async function announceUpdate(q: Queryable, out: Outbox, messageId: string): Promise<Message> {
  const message = await loadMessage(q, messageId)
  out.to(await memberIds(q, message.chatId), { type: 'message.updated', message })
  return message
}
