// The "EcoCash Super App" official chat: messages from EcoCash staff to customers (KYC results, announcements, news & offers).
import type { Queryable } from '../db/index'
import { notFound } from '../errors'
import type { Outbox } from '../realtime/outbox'
import { ensurePairChat, postMessage } from './chats'
import type { UserRow } from './users'

/** The inbox system account (users.kind 'system', official). Ensured by db/seed.ts ensureBillers. */
export const INBOX_ACCOUNT = { name: 'EcoCash Super App', biller: 'inbox' } as const

export async function inboxAccount(q: Queryable): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [INBOX_ACCOUNT.biller])
  if (!u) throw notFound('Inbox account missing (seed not run?)')
  return u
}

/** Posts a message into the person's EcoCash Super App chat (created the first time). Pushes like any chat message. */
export async function postToInbox(q: Queryable, out: Outbox, userId: string, text: string) {
  const inbox = await inboxAccount(q)
  const { chatId } = await ensurePairChat(q, out, inbox.id, userId, { kind: 'official' })
  return postMessage(q, out, { chatId, senderId: inbox.id, kind: 'text', text })
}
