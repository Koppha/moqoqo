import { MAX_TRANSACTION } from '../../../shared/api'
import { AppError, validation } from '../errors'

export const MAX_TRANSACTION_CENTS = MAX_TRANSACTION * 100

/** Maloti number (max 2 decimals) → integer cents. Throws VALIDATION for anything else. */
export function toCents(amount: unknown, field = 'amount'): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw validation(`${field} must be a number`)
  const cents = Math.round(amount * 100)
  if (Math.abs(cents - amount * 100) > 1e-6) throw validation(`${field} can have at most 2 decimals`)
  return cents
}

export const fromCents = (cents: number | null | undefined): number => Math.round(Number(cents ?? 0)) / 100

/** A payment amount: > 0 and <= MAX_TRANSACTION. */
export function paymentCents(amount: unknown, field = 'amount'): number {
  const cents = toCents(amount, field)
  if (cents <= 0) throw validation(`${field} must be greater than 0`)
  if (cents > MAX_TRANSACTION_CENTS) throw new AppError('LIMIT_EXCEEDED', `The most you can move at once is M${MAX_TRANSACTION.toLocaleString('en')}`)
  return cents
}

/** "M1,240.50" */
export const formatM = (cents: number) => `M${(cents / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
