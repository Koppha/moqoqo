import { toMsisdn, type Role } from '../../shared/api'

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = new Intl.NumberFormat('en-US')

/** "M1,234.50" (maloti), same as the apps. */
export function formatMoney(n: number): string {
  return `M${money.format(n)}`
}

export function formatCount(n: number): string {
  return count.format(n)
}

/** +26662000021 → "+266 6200 0021" */
export function formatMsisdn(msisdn: string): string {
  const m = /^\+266(\d{4})(\d{4})$/.exec(msisdn)
  return m ? `+266 ${m[1]} ${m[2]}` : msisdn
}

/**
 * Accepts "+266 6200 0021", "26662000021", "00266 62000021", "62000021" and returns E.164 (+266XXXXXXXX),
 * or null when it isn't a valid Lesotho mobile number (8 digits starting with 5 or 6). Same rule as the apps.
 */
export function normalizeMsisdn(input: string): string | null {
  return toMsisdn(input)
}

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  agent: 'Agent',
  merchant: 'Merchant',
}

/** Parses a positive maloti amount with at most 2 decimals. */
export function parseAmount(input: string): number | null {
  const s = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}
