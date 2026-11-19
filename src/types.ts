// View models the screens render. Server data (shared/api.ts) is mapped into these by lib/mappers.ts,
// so bubbles and lists think in "me / them / who / time" rather than raw sender ids and timestamps.
import type { AssistantAction, BillKey, CauseCard, ChatKind, PublicUser, RequestKind, RequestStatus, SplitInfo } from '../shared/api'

export type { BillKey, RequestKind, RequestStatus }

/** A Kopa (money), Ntefelle (pay a bill for me), agent cash-out or merchant payment request in chat. */
export interface PaymentRequest {
  kind: RequestKind
  bill?: BillKey
  amount: number
  /** Already paid towards this request (partial payments in groups). */
  paid?: number
  /** Biller account (meter, account no.) the payer will pay into. */
  account?: string
  detail?: string
  note?: string
  status: RequestStatus
  paidBy?: string
  toUserId?: string
  /** Split bills: each participant's share. */
  split?: SplitInfo
}

interface MessageBase {
  id: string
  from: 'me' | 'them'
  /** Sender name in group chats. */
  who?: string
  time: string
  /** Optimistic copy waiting for the server. */
  pending?: boolean
  failed?: boolean
}

export type Message =
  | (MessageBase & { type: 'text'; text: string })
  | (MessageBase & { type: 'system'; text: string })
  | (MessageBase & { type: 'money'; amount: number; note?: string })
  | (MessageBase & { type: 'mpho'; amount: number; note?: string })
  | (MessageBase & { type: 'receipt'; amount: number; note: string })
  | (MessageBase & { type: 'request'; request: PaymentRequest })
  /** The EcoCash Assistant got something ready: tapping opens EcoCash Super App's own screen to confirm with the PIN. */
  | (MessageBase & { type: 'action'; text: string; action: AssistantAction })
  /** A Donate cause shared in the chat, with its live progress. */
  | (MessageBase & { type: 'cause'; cause: CauseCard })

export interface Chat {
  id: string
  name: string
  kind: ChatKind
  members: PublicUser[]
  /** The other person in a direct or official chat. */
  other?: PublicUser
  msisdn?: string
  official?: boolean
  /** The EcoCash Assistant's chat: official, but the user can write in it. */
  assistant?: boolean
  /** The EcoCash Support chat: official, the user can write in it; people from support answer. */
  support?: boolean
  group?: boolean
  /** A message request: someone who isn't a friend started it (the user takes messages from friends only). */
  request?: boolean
  /** Groups: who made it (they can delete it; everyone else can leave). */
  createdBy?: string
  /** Direct chats: I blocked this person (no messages, money or requests either way until I unblock). */
  blockedByMe?: boolean
  unread: number
  updatedAt: string
  lastMessage?: Message
  /** Messages loaded so far (oldest first). */
  messages: Message[]
}

export interface Transaction {
  id: string
  description: string
  amount: number
  time: string
}

