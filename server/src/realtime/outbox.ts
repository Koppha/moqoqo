import type { NotifyCategory, NotifyChannel, ServerEvent } from '../../../shared/api'
import type { TransactionRow } from '../ecocash/index'

/** A notification for some users; each user's own choices decide which channels it goes out on. */
export interface Notice {
  userIds: string[]
  category: NotifyCategory
  title: string
  body: string
  /** Opens the right screen when a push is tapped (e.g. chatId). */
  data?: Record<string, string>
  /** Channels this notice may use (default: all three). */
  channels?: NotifyChannel[]
  /** Push only to users with no open socket (chat messages: the app already shows them live). */
  pushOnlyOffline?: boolean
}

/**
 * Collects realtime events while a DB transaction runs. They are delivered only after COMMIT,
 * so clients never see a message or balance that was rolled back.
 */
export class Outbox {
  readonly events: { userId: string; event: ServerEvent }[] = []
  readonly notices: Notice[] = []
  /** Ledger movements in this transaction, for "money in & out" alerts after COMMIT. */
  readonly transfers: { tx: TransactionRow; balances: Map<string, number> }[] = []

  to(userIds: Iterable<string>, event: ServerEvent) {
    for (const userId of new Set(userIds)) this.events.push({ userId, event })
  }

  balance(userId: string, balanceCents: number) {
    // Later balance events for the same user supersede earlier ones.
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]
      if (e.userId === userId && e.event.type === 'balance') this.events.splice(i, 1)
    }
    this.events.push({ userId, event: { type: 'balance', balance: balanceCents / 100 } })
  }

  notify(notice: Notice) {
    if (notice.userIds.length) this.notices.push(notice)
  }
}
