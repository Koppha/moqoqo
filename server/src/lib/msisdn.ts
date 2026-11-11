import { toMsisdn } from '../../../shared/api'
import { validation } from '../errors'

/**
 * Normalises a Lesotho wallet number to E.164 (+266 and 8 digits). Same rule as the apps and the portal:
 * "62000021", "6200 0021", "+266 6200 0021", "26662000021" and "00266 62000021" are all the same number.
 */
export function normalizeMsisdn(input: unknown, field = 'msisdn'): string {
  if (typeof input !== 'string') throw validation(`${field} must be a phone number`)
  const msisdn = toMsisdn(input)
  if (!msisdn) throw validation(`${field} must be a Lesotho number like +26662000021`)
  return msisdn
}
