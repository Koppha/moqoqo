// EcoSure mock back end: shared pieces (system account, official chat, dates).
import type { Message } from '../../../shared/api'
import type { Queryable } from '../db/index'
import type { Outbox } from '../realtime/outbox'
import { ensurePairChat, postMessage } from '../services/chats'
import type { UserRow } from '../services/users'

/** The EcoSure system wallet (users.kind 'system', official). Ensured by db/seed.ts ensureBillers. */
export const ECOSURE_ACCOUNT = { name: 'EcoSure', biller: 'ecosure' } as const

export async function ecosureAccount(q: Queryable): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [ECOSURE_ACCOUNT.biller])
  if (!u) throw new Error('EcoSure account missing (seed not run?)')
  return u
}

/** Posts a text from the EcoSure account into its official chat with `userId` (created if needed). */
export async function notify(q: Queryable, out: Outbox, userId: string, text: string): Promise<Message> {
  const es = await ecosureAccount(q)
  const { chatId } = await ensurePairChat(q, out, es.id, userId, { kind: 'official' })
  return postMessage(q, out, { chatId, senderId: es.id, kind: 'text', text })
}

// ---------- dates (YYYY-MM-DD, Africa/Maseru calendar) ----------

const MASERU_OFFSET_MS = 2 * 60 * 60 * 1000

/** Today's date in Maseru (UTC+2, no DST) as YYYY-MM-DD. */
export const todayMaseru = (now = Date.now()) => new Date(now + MASERU_OFFSET_MS).toISOString().slice(0, 10)

export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Calendar months on, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-11-16" → "16 Nov 2026" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full
