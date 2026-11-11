// Africa/Maseru is UTC+2 all year (no daylight saving). The API speaks UTC ISO strings;
// everything staff see or type is Maseru wall-clock time. These helpers do the conversion
// with fixed-offset arithmetic, so they behave the same whatever the browser's own zone is.

export const MASERU_TZ = 'Africa/Maseru'
export const MASERU_LABEL = 'Maseru time (UTC+2)'
const OFFSET_MS = 2 * 60 * 60 * 1000

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/** Maseru wall-clock parts as values for <input type="date"> ("YYYY-MM-DD") and <input type="time"> ("HH:mm"). */
export interface MaseruParts {
  date: string
  time: string
}

function shifted(iso: string | Date): Date | null {
  const ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime()
  if (Number.isNaN(ms)) return null
  return new Date(ms + OFFSET_MS) // read with getUTC* to get Maseru wall-clock
}

export function toMaseruParts(iso: string | Date): MaseruParts {
  const d = shifted(iso)
  if (!d) return { date: '', time: '' }
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  }
}

/** Maseru date + time inputs → UTC ISO string, or null if incomplete/invalid. */
export function maseruToIso(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dm || !tm) return null
  const [y, mo, da] = [Number(dm[1]), Number(dm[2]), Number(dm[3])]
  const [h, mi] = [Number(tm[1]), Number(tm[2])]
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null
  const ms = Date.UTC(y, mo - 1, da, h, mi) - OFFSET_MS
  // Reject dates that rolled over (e.g. 2026-02-31).
  const back = toMaseruParts(new Date(ms))
  if (back.date !== date) return null
  return new Date(ms).toISOString()
}

/** "14:30" */
export function formatMaseruTime(iso: string): string {
  return toMaseruParts(iso).time
}

/** "Mon 12 Oct 2026" */
export function formatMaseruDate(iso: string): string {
  const d = shifted(iso)
  if (!d) return '—'
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "Mon 12 Oct 2026, 14:30" */
export function formatMaseru(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = shifted(iso)
  if (!d) return '—'
  return `${formatMaseruDate(iso)}, ${formatMaseruTime(iso)}`
}

/** True when both instants fall on the same Maseru calendar day. */
export function sameMaseruDay(a: string, b: string): boolean {
  return toMaseruParts(a).date === toMaseruParts(b).date
}

/** "2 h 30 min", "45 min", "1 day 3 h" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min'
  const totalMin = Math.round(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours) parts.push(`${hours} h`)
  if (mins && !days) parts.push(`${mins} min`)
  return parts.join(' ') || '0 min'
}
