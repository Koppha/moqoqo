import type { Strings } from '../i18n'
import type { Message } from '../types'
import { fmt } from './format'

/** One-line summary for the chat list. */
export function preview(m: Message | undefined, t: Strings): string {
  if (!m) return ''
  switch (m.type) {
    case 'text': return (m.who ? m.who + ': ' : '') + m.text.split('\n')[0]
    case 'system': return m.text.split('\n')[0]
    case 'action': return '✨ ' + m.text
    case 'cause': return '💛 ' + m.cause.title
    case 'money': return m.from === 'me' ? t.preview.youSent(fmt(m.amount)) : t.preview.theySent(m.who ?? '', fmt(m.amount))
    case 'mpho': return '🧧 Mpho ' + fmt(m.amount)
    case 'receipt': return t.preview.receipt(fmt(m.amount))
    case 'request': {
      const r = m.request
      if (r.split) return t.split.preview + (r.note ?? '') + (r.status === 'paid' ? ' ✓' : '')
      const head = r.bill ? t.preview.payForMe(t.bills[r.bill].name)
        : r.kind === 'cashout' ? '💵 ' + t.biz.cashOut + ' '
          : r.kind === 'merchant' ? '🧾 ' + t.biz.charge + ' '
            : t.preview.request
      return head + fmt(r.amount) + (r.status === 'paid' ? ' ✓' : r.status === 'declined' || r.status === 'cancelled' ? t.preview.declined : '')
    }
  }
}
