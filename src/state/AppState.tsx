import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react'
import type { AppConfig, ChatSummary, Maintenance, Me, Message as ApiMessage, PaymentIntent, Transaction as ApiTransaction } from '../../shared/api'
import { useT } from '../i18n'
import { toChat, toTransaction } from '../lib/mappers'
import type { Chat, Transaction } from '../types'

// Server data lives here as the server sent it; screens read mapped views (useChats / useChat / useTransactions).

export interface State {
  me: Me | null
  balance: number
  chats: Record<string, ChatSummary>
  /** Loaded messages per chat, oldest first. Optimistic sends carry a clientId and an `id` of `local:<clientId>`. */
  messages: Record<string, ApiMessage[]>
  failed: Record<string, true>
  transactions: ApiTransaction[]
  /** Payment requests at the till (merchants) or just paid (customers), kept current by intent.updated. */
  intents: Record<string, PaymentIntent>
  /** The chat on screen, so incoming messages there don't count as unread. */
  openChatId: string | null
  /** Chats where the EcoCash Assistant is writing a reply. */
  typing: Record<string, true>
  config: AppConfig | null
  /** Set when any call is refused with 503 MAINTENANCE, before the next config poll confirms it. */
  maintenanceHit: Maintenance | null
  online: boolean
  /** When the connection last went down (ms); null while online. The app starts offline until it connects. */
  offlineSince: number | null
  // Local-only features, not on the server yet.
  taxi: { fare: number; taps: number; total: number; recent: number[] }
  toast: string | null
}

export type Action =
  | { type: 'reset' }
  | { type: 'me'; me: Me }
  | { type: 'balance'; balance: number }
  | { type: 'chats'; chats: ChatSummary[] }
  | { type: 'chat'; chat: ChatSummary }
  | { type: 'chatRemoved'; chatId: string }
  | { type: 'messages'; chatId: string; messages: ApiMessage[] }
  | { type: 'message'; message: ApiMessage }
  | { type: 'sendFailed'; chatId: string; clientId: string }
  | { type: 'transactions'; transactions: ApiTransaction[] }
  | { type: 'transaction'; transaction: ApiTransaction }
  | { type: 'intent'; intent: PaymentIntent }
  | { type: 'openChat'; chatId: string | null }
  | { type: 'typing'; chatId: string; typing: boolean }
  | { type: 'config'; config: AppConfig }
  | { type: 'maintenanceHit'; maintenance: Maintenance | null }
  | { type: 'online'; online: boolean }
  | { type: 'taxiTap' }
  | { type: 'taxiFare'; fare: number }
  | { type: 'toast'; text: string | null }

const initial: State = {
  me: null,
  balance: 0,
  chats: {},
  messages: {},
  failed: {},
  transactions: [],
  intents: {},
  openChatId: null,
  typing: {},
  config: null,
  maintenanceHit: null,
  online: false,
  offlineSince: Date.now(),
  taxi: { fare: 18, taps: 47, total: 846, recent: [18, 18, 18, 18] },
  toast: null,
}

const later = (a: string, b: string) => (a > b ? a : b)

/** Insert or replace by id; a server copy replaces the optimistic one with the same clientId. */
function upsert(list: ApiMessage[], m: ApiMessage): ApiMessage[] {
  const i = list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId))
  if (i === -1) return [...list, m].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const next = list.slice()
  next[i] = m
  return next
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'reset':
      // The connection status is the phone's, not the account's: it carries over (no USSD card flashing on a switch).
      return { ...initial, config: s.config, online: s.online, offlineSince: s.offlineSince }
    case 'me':
      return { ...s, me: a.me, balance: a.me.balance }
    case 'balance':
      return { ...s, balance: a.balance, me: s.me && { ...s.me, balance: a.balance } }
    case 'chats':
      return { ...s, chats: Object.fromEntries(a.chats.map((c) => [c.id, c])) }
    case 'chat':
      return { ...s, chats: { ...s.chats, [a.chat.id]: { ...s.chats[a.chat.id], ...a.chat } } }
    case 'chatRemoved': {
      // A group deleted, or left: gone from the list along with its messages.
      const { [a.chatId]: _chat, ...chats } = s.chats
      const { [a.chatId]: _msgs, ...messages } = s.messages
      return { ...s, chats, messages }
    }
    case 'messages': {
      let list = s.messages[a.chatId] ?? []
      for (const m of a.messages) list = upsert(list, m)
      return { ...s, messages: { ...s.messages, [a.chatId]: list } }
    }
    case 'message': {
      const m = a.message
      const chat = s.chats[m.chatId]
      const list = upsert(s.messages[m.chatId] ?? [], m)
      const isNew = !(s.messages[m.chatId] ?? []).some((x) => x.id === m.id)
      const counts = isNew && m.senderId !== s.me?.id && s.openChatId !== m.chatId
      const failed = m.clientId && s.failed[m.clientId] ? (({ [m.clientId]: _, ...rest }) => rest)(s.failed) : s.failed
      return {
        ...s,
        failed,
        messages: { ...s.messages, [m.chatId]: list },
        chats: chat
          ? { ...s.chats, [m.chatId]: { ...chat, lastMessage: list.at(-1), updatedAt: later(chat.updatedAt, m.createdAt), unread: chat.unread + (counts ? 1 : 0) } }
          : s.chats,
      }
    }
    case 'sendFailed':
      return { ...s, failed: { ...s.failed, [a.clientId]: true } }
    case 'transactions':
      return { ...s, transactions: a.transactions }
    case 'transaction':
      return s.transactions.some((x) => x.id === a.transaction.id) ? s : { ...s, transactions: [a.transaction, ...s.transactions] }
    case 'intent':
      return { ...s, intents: { ...s.intents, [a.intent.id]: a.intent } }
    case 'openChat': {
      const chat = a.chatId ? s.chats[a.chatId] : undefined
      return { ...s, openChatId: a.chatId, chats: chat ? { ...s.chats, [chat.id]: { ...chat, unread: 0 } } : s.chats }
    }
    case 'typing': {
      const { [a.chatId]: _, ...rest } = s.typing
      return { ...s, typing: a.typing ? { ...rest, [a.chatId]: true } : rest }
    }
    case 'config':
      // A config without an active window clears a 503 we saw earlier.
      return { ...s, config: a.config, maintenanceHit: a.config.maintenance?.active ? s.maintenanceHit : null }
    case 'maintenanceHit':
      return { ...s, maintenanceHit: a.maintenance }
    case 'online':
      return { ...s, online: a.online, offlineSince: a.online ? null : s.offlineSince ?? Date.now() }
    case 'taxiTap': {
      const t = s.taxi
      return { ...s, taxi: { ...t, taps: t.taps + 1, total: t.total + t.fare, recent: [...t.recent, t.fare].slice(-8) } }
    }
    case 'taxiFare':
      return { ...s, taxi: { ...s.taxi, fare: a.fare } }
    case 'toast':
      return { ...s, toast: a.text }
  }
}

const Ctx = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  return <Ctx value={{ state, dispatch }}>{children}</Ctx>
}

export function useAppState() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider')
  return ctx
}

/** All chats, most recent first, as view models. */
export function useChats(): Chat[] {
  const { state } = useAppState()
  const meId = state.me?.id ?? ''
  return useMemo(
    () => Object.values(state.chats)
      // The EcoCash Assistant stays at the top; the rest newest first.
      .sort((a, b) => (a.assistant !== b.assistant ? (a.assistant ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1))
      .map((c) => withFailed(toChat(c, meId, state.messages[c.id]), state.messages[c.id], state.failed)),
    [state.chats, state.messages, state.failed, meId],
  )
}

export function useChat(id: string | undefined): Chat | undefined {
  const { state } = useAppState()
  const meId = state.me?.id ?? ''
  const c = id ? state.chats[id] : undefined
  const msgs = id ? state.messages[id] : undefined
  return useMemo(() => (c ? withFailed(toChat(c, meId, msgs), msgs, state.failed) : undefined), [c, msgs, meId, state.failed])
}

export function useTransactions(): Transaction[] {
  const { state } = useAppState()
  const t = useT()
  return useMemo(() => state.transactions.map((x) => toTransaction(x, t.common.weekdays)), [state.transactions, t])
}

/** Marks optimistic messages as pending, or failed when their send was refused. */
function withFailed(chat: Chat, raw: ApiMessage[] | undefined, failed: Record<string, true>): Chat {
  if (!raw?.some((m) => m.id.startsWith('local:'))) return chat
  return {
    ...chat,
    messages: chat.messages.map((m, i) => {
      const r = raw[i]
      if (!r?.id.startsWith('local:')) return m
      return { ...m, pending: !failed[r.clientId ?? ''], failed: !!failed[r.clientId ?? ''] }
    }),
  }
}
