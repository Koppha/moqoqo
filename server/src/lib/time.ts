/** Lesotho is UTC+2 all year (no DST). */
const MASERU_OFFSET_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the current Africa/Maseru calendar day, as a UTC Date. */
export function startOfMaseruDay(now = new Date()): Date {
  const local = now.getTime() + MASERU_OFFSET_MS
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - MASERU_OFFSET_MS)
}

/** Start of the current Africa/Maseru calendar month, as a UTC Date. */
export function startOfMaseruMonth(now = new Date()): Date {
  const local = new Date(now.getTime() + MASERU_OFFSET_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - MASERU_OFFSET_MS)
}

export const iso = (d: Date | string | null | undefined): string => (d == null ? '' : new Date(d).toISOString())
export const isoOrNull = (d: Date | string | null | undefined): string | null => (d == null ? null : new Date(d).toISOString())
