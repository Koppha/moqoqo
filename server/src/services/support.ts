// Help & support: tickets, the "EcoCash Support" chat where people from support answer, and assistant analytics.
import type { SupportStats, SupportTicket, SupportTicketDetail, SupportTopic, TicketStatus } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { iso, isoOrNull } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { ensurePairChat, listMessages, postMessage } from './chats'
import { getUsers, toPublicUser, type UserRow } from './users'

/** The support system account (users.kind 'system', official). Ensured by db/seed.ts ensureBillers. */
export const SUPPORT_ACCOUNT = { name: 'EcoCash Support', biller: 'support' } as const

export async function supportAccount(q: Queryable): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [SUPPORT_ACCOUNT.biller])
  if (!u) throw notFound('Support account missing (seed not run?)')
  return u
}

/** Records what the assistant did (for the portal's support analytics). Never fails the caller. */
export async function logAssistant(q: Queryable, userId: string, kind: string, detail?: string) {
  await q.query('INSERT INTO assistant_events (user_id, kind, detail) VALUES ($1, $2, $3)', [userId, kind, detail ?? null]).catch(() => {})
}

interface TicketRow {
  id: string; reference: string; user_id: string; topic: SupportTopic; summary: string; status: TicketStatus
  assigned_to: string | null; first_response_at: Date | null; created_at: Date; updated_at: Date
}

async function toTickets(q: Queryable, rows: TicketRow[]): Promise<SupportTicket[]> {
  const users = await getUsers(q, rows.map((r) => r.user_id))
  return rows.map((r) => ({
    id: r.id, reference: r.reference, user: toPublicUser(users.get(r.user_id)!), topic: r.topic, summary: r.summary, status: r.status,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), firstResponseAt: isoOrNull(r.first_response_at), assignedTo: r.assigned_to,
  }))
}

async function supportChat(q: Queryable, out: Outbox, userId: string): Promise<{ chatId: string; supportId: string }> {
  const support = await supportAccount(q)
  const { chatId } = await ensurePairChat(q, out, support.id, userId, { kind: 'official' })
  return { chatId, supportId: support.id }
}

/** The assistant hands over to a person: a ticket, and a first message in the EcoCash Support chat. */
export async function openTicket(q: Queryable, out: Outbox, userId: string, topic: SupportTopic, summary: string): Promise<SupportTicket> {
  const [row] = await q.query<TicketRow>('INSERT INTO support_tickets (id, user_id, topic, summary) VALUES ($1, $2, $3, $4) RETURNING *', [newId(), userId, topic, summary])
  const { chatId, supportId } = await supportChat(q, out, userId)
  await postMessage(q, out, {
    chatId, senderId: supportId, kind: 'text',
    text: `Hi, this is EcoCash Support. We have your request ${row.reference}: "${summary}". A person from our team will answer you here. You can add anything else below.`,
  })
  await logAssistant(q, userId, 'handover', topic)
  return (await toTickets(q, [row]))[0]
}

/** A person wrote in the EcoCash Support chat: it belongs to their latest open ticket (or starts a new one). */
export async function customerWrote(q: Queryable, out: Outbox, user: UserRow, text: string) {
  const [open] = await q.query<{ id: string }>(`SELECT id FROM support_tickets WHERE user_id = $1 AND status <> 'closed' ORDER BY created_at DESC LIMIT 1`, [user.id])
  if (open) await q.query(`UPDATE support_tickets SET status = 'open', updated_at = now() WHERE id = $1`, [open.id])
  else await q.query('INSERT INTO support_tickets (id, user_id, topic, summary) VALUES ($1, $2, $3, $4)', [newId(), user.id, 'other', text.slice(0, 200)])
  void out
}

export async function listTickets(q: Queryable, status: TicketStatus | null, page: number, pageSize: number) {
  const [{ total }] = await q.query<{ total: number }>('SELECT count(*)::int AS total FROM support_tickets WHERE ($1::text IS NULL OR status = $1)', [status])
  const rows = await q.query<TicketRow>(
    `SELECT * FROM support_tickets WHERE ($1::text IS NULL OR status = $1) ORDER BY (status = 'open') DESC, updated_at DESC LIMIT $2 OFFSET $3`,
    [status, pageSize, (page - 1) * pageSize],
  )
  return { items: await toTickets(q, rows), total, page, pageSize }
}

export async function ticketDetail(q: Queryable, id: string): Promise<SupportTicketDetail> {
  const [row] = await q.query<TicketRow>('SELECT * FROM support_tickets WHERE id = $1', [id])
  if (!row) throw notFound('Ticket not found')
  const [ticket] = await toTickets(q, [row])
  const chats = await q.query<{ id: string; biller: string }>(
    `SELECT c.id, u.biller FROM chats c JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
       JOIN chat_members o ON o.chat_id = c.id AND o.user_id <> $1 JOIN users u ON u.id = o.user_id
     WHERE c.kind = 'official' AND u.biller IN ('support', 'assistant')`,
    [row.user_id],
  )
  const supportChatId = chats.find((c) => c.biller === 'support')?.id
  const assistantChatId = chats.find((c) => c.biller === 'assistant')?.id
  return {
    ...ticket,
    thread: supportChatId ? await listMessages(q, supportChatId, undefined, 100) : [],
    aiConversation: assistantChatId ? await listMessages(q, assistantChatId, undefined, 40) : [],
  }
}

export async function reply(ctx: Ctx, id: string, staff: { email: string; name: string }, text: string): Promise<SupportTicketDetail> {
  if (!text.trim()) throw validation('Write a reply')
  await ctx.tx(async (q, out) => {
    const [row] = await q.query<TicketRow>('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [id])
    if (!row) throw notFound('Ticket not found')
    const { chatId, supportId } = await supportChat(q, out, row.user_id)
    await postMessage(q, out, { chatId, senderId: supportId, kind: 'text', text: `${text.trim()}\n\n— ${staff.name.split(' ')[0]}, EcoCash Support` })
    await q.query(
      `UPDATE support_tickets SET status = 'waiting', updated_at = now(), first_response_at = COALESCE(first_response_at, now()),
         assigned_to = COALESCE(assigned_to, $2) WHERE id = $1`,
      [id, staff.email],
    )
  })
  return ticketDetail(ctx.db, id)
}

export async function close(ctx: Ctx, id: string): Promise<SupportTicketDetail> {
  await ctx.tx(async (q, out) => {
    const [row] = await q.query<TicketRow>(`UPDATE support_tickets SET status = 'closed', updated_at = now() WHERE id = $1 RETURNING *`, [id])
    if (!row) throw notFound('Ticket not found')
    const { chatId, supportId } = await supportChat(q, out, row.user_id)
    await postMessage(q, out, { chatId, senderId: supportId, kind: 'system', text: `Request ${row.reference} is closed. Write here or ask the EcoCash Assistant if you need anything else.` })
  })
  return ticketDetail(ctx.db, id)
}

export async function stats(q: Queryable, days: number): Promise<SupportStats> {
  const since = new Date(Date.now() - days * 86_400_000)
  const ev = await q.query<{ kind: string; detail: string | null; n: number }>(
    'SELECT kind, detail, count(*)::int AS n FROM assistant_events WHERE created_at >= $1 GROUP BY kind, detail',
    [since],
  )
  const count = (kind: string) => ev.filter((e) => e.kind === kind).reduce((s, e) => s + e.n, 0)
  const [{ people }] = await q.query<{ people: number }>(`SELECT count(DISTINCT user_id)::int AS people FROM assistant_events WHERE kind = 'question' AND created_at >= $1`, [since])
  const handedOver = await q.query<{ people: number }>(`SELECT count(DISTINCT user_id)::int AS people FROM assistant_events WHERE kind = 'handover' AND created_at >= $1`, [since])
  const tickets = await q.query<{ status: TicketStatus; n: number }>('SELECT status, count(*)::int AS n FROM support_tickets GROUP BY status')
  const topics = await q.query<{ topic: SupportTopic; n: number }>('SELECT topic, count(*)::int AS n FROM support_tickets WHERE created_at >= $1 GROUP BY topic ORDER BY n DESC', [since])
  const [median] = await q.query<{ m: number | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - created_at) / 60) AS m
     FROM support_tickets WHERE first_response_at IS NOT NULL AND created_at >= $1`,
    [since],
  )
  const perDay = await q.query<{ day: string; questions: number; handovers: number }>(
    `SELECT to_char(created_at + interval '2 hours', 'YYYY-MM-DD') AS day,
            count(*) FILTER (WHERE kind = 'question')::int AS questions, count(*) FILTER (WHERE kind = 'handover')::int AS handovers
     FROM assistant_events WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
    [since],
  )
  return {
    days,
    people,
    questions: count('question'),
    answers: count('answer'),
    handovers: count('handover'),
    refusals: count('refusal'),
    errors: count('error'),
    selfServiceRate: people ? Math.max(0, 1 - (handedOver[0]?.people ?? 0) / people) : 1,
    tools: ev.filter((e) => e.kind === 'tool').map((e) => ({ name: e.detail ?? '', count: e.n })).sort((a, b) => b.count - a.count),
    topics: topics.map((t) => ({ topic: t.topic, count: t.n })),
    tickets: { open: tickets.find((t) => t.status === 'open')?.n ?? 0, waiting: tickets.find((t) => t.status === 'waiting')?.n ?? 0, closed: tickets.find((t) => t.status === 'closed')?.n ?? 0 },
    medianFirstResponseMinutes: median?.m == null ? null : Math.round(Number(median.m)),
    perDay,
  }
}
