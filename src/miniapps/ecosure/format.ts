import { toMsisdn } from '../../../shared/api'
import type { EsClaimStatus, EsCover, EsPolicyStatus, EsRelationship } from '../../../shared/api'
import type { EsStrings } from './strings'

/** 84 → "M84.00" */
export const maloti = (n: number) => `M${n.toFixed(2)}`

/** Econet / Vodacom Lesotho numbers: 266 + 8 digits starting 5 or 6. Accepts spaces, +266 or nothing. → "+266…" or null. */
export function normaliseMsisdn(input: string): string | null {
  return toMsisdn(input)
}

/** "16/10/1990" → "1990-10-16" (checks it's a real past date); null when invalid. */
export function parseDate(input: string): string | null {
  const m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(input.trim())
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  if (date.getTime() > Date.now() || y < 1900) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Typing helper for DD/MM/YYYY fields: digits only, slashes added. */
export const maskDate = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

/** "2026-11-16" or an ISO time → "16 Nov 2026" */
export const showDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

export const coverName = (c: EsCover, t: EsStrings) => (c === 'family' ? t.cover.family : t.cover.single)
export const relationName = (r: EsRelationship, t: EsStrings) => t.relationship[r]
export const statusName = (s: EsPolicyStatus, t: EsStrings) => t.policyStatus[s]
export const claimStatusName = (s: EsClaimStatus, t: EsStrings) => t.claimStatus[s]

/** Badge colours per policy status. */
export const statusTone = (s: EsPolicyStatus): 'success' | 'warning' | 'danger' =>
  s === 'active' ? 'success' : s === 'grace' ? 'warning' : 'danger'
