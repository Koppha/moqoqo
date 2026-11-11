import type { Queryable } from '../db/index'
import { notFound } from '../errors'
import type { Outbox } from '../realtime/outbox'
import { ensurePairChat, postMessage } from '../services/chats'
import type { UserRow } from '../services/users'

/** The EcoCash Assistant's system account (users.kind 'system', official). Ensured by db/seed.ts ensureBillers. */
export const ASSISTANT_ACCOUNT = { name: 'EcoCash Assistant', biller: 'assistant' } as const

export const WELCOME =
  "Hi, I'm the EcoCash Assistant 👋 Ask me how anything in EcoCash Super App works, about your balance, payments, requests or " +
  'EcoSure cover, or ask me to get a payment ready for you. I never move money myself: you check the details and ' +
  'confirm with your PIN. Lumela! You can write to me in Sesotho too.'

export async function assistantAccount(q: Queryable): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [ASSISTANT_ACCOUNT.biller])
  if (!u) throw notFound('Assistant account missing (seed not run?)')
  return u
}

/** The person's chat with the assistant, created (with a welcome message) the first time. People only. */
export async function ensureAssistantChat(q: Queryable, out: Outbox, user: UserRow): Promise<string | null> {
  if (user.kind !== 'person') return null
  const assistant = await assistantAccount(q)
  const [existing] = await q.query<{ id: string }>('SELECT id FROM chats WHERE pair_key = $1', [`official:${[assistant.id, user.id].sort().join(':')}`])
  if (existing) return existing.id
  const { chatId, created } = await ensurePairChat(q, out, assistant.id, user.id, { kind: 'official', creatorId: user.id })
  if (created) await postMessage(q, out, { chatId, senderId: assistant.id, kind: 'text', text: WELCOME, silent: true })
  return chatId
}
