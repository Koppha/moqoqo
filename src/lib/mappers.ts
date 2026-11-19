import type { ChatSummary, Message as ApiMessage, PublicUser, Transaction as ApiTransaction } from '../../shared/api'
import type { Chat, Message, Transaction } from '../types'

const pad = (n: number) => n.toString().padStart(2, '0')

/** 24-hour clock in the device's time zone. */
export const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "08:52" today, a weekday within the last week, else "12/10". Weekday names come from the current language. */
export function dayLabel(iso: string, weekdays: string[]) {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (days <= 0) return hhmm(iso)
  if (days < 7) return weekdays.at(d.getDay()) ?? ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

export function toMessage(m: ApiMessage, meId: string, members: PublicUser[], group: boolean): Message {
  const mine = m.senderId === meId
  const base = {
    id: m.id,
    from: mine ? ('me' as const) : ('them' as const),
    who: group && !mine ? members.find((u) => u.id === m.senderId)?.name.split(' ')[0] : undefined,
    time: hhmm(m.createdAt),
  }
  switch (m.kind) {
    case 'text': return { ...base, type: 'text', text: m.text ?? '' }
    case 'system': return { ...base, type: 'system', text: m.text ?? '' }
    case 'money': return { ...base, type: 'money', amount: m.amount ?? 0, note: m.note }
    case 'mpho': return { ...base, type: 'mpho', amount: m.amount ?? 0, note: m.note }
    case 'receipt': return { ...base, type: 'receipt', amount: m.amount ?? 0, note: m.note ?? '' }
    case 'cause': return m.cause ? { ...base, type: 'cause', cause: m.cause } : { ...base, type: 'text', text: m.text ?? '' }
    case 'action': return m.action ? { ...base, type: 'action', text: m.text ?? '', action: m.action } : { ...base, type: 'text', text: m.text ?? '' }
    case 'request': {
      const r = m.request!
      return { ...base, type: 'request', request: { ...r, paidBy: r.paidByName } }
    }
  }
}

export function toChat(c: ChatSummary, meId: string, messages: ApiMessage[] | undefined): Chat {
  const others = c.members.filter((u) => u.id !== meId)
  const group = c.kind === 'group'
  const other = group ? undefined : others[0]
  return {
    id: c.id,
    name: c.title,
    kind: c.kind,
    members: c.members,
    other,
    msisdn: other && !other.official ? other.msisdn : undefined,
    official: c.kind === 'official' || !!other?.official,
    assistant: !!c.assistant,
    support: !!c.support,
    group,
    request: !!c.request,
    createdBy: c.createdBy,
    blockedByMe: !!c.blockedByMe,
    unread: c.unread,
    updatedAt: c.updatedAt,
    lastMessage: c.lastMessage ? toMessage(c.lastMessage, meId, c.members, group) : undefined,
    messages: (messages ?? []).map((m) => toMessage(m, meId, c.members, group)),
  }
}

export const toTransaction = (x: ApiTransaction, weekdays: string[]): Transaction => ({
  id: x.id,
  description: x.description,
  amount: x.amount,
  time: dayLabel(x.createdAt, weekdays),
})
