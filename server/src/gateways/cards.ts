// Card gateway (card → wallet top-ups).
//
// MockCardGateway stands in for a real card acquirer/gateway until one is chosen. A real adapter implements the same
// `CardGateway` interface. Card data rules: the number and CVV pass through `tokenize` once and are never stored or
// logged; EcoCash Super App keeps only the token, brand, last 4 digits and expiry. (With a real gateway, card entry moves to the
// gateway's hosted page/fields so card data never touches EcoCash Super App's server at all.)

import type { CardBrand } from '../../../shared/api'
import { AppError, validation } from '../errors'
import { randomDigits } from '../lib/crypto'
import { randomUUID } from 'node:crypto'

export interface CardDetails {
  number: string
  expMonth: number
  expYear: number
  cvv: string
  holderName: string
}

export interface TokenizedCard {
  token: string
  brand: CardBrand
  last4: string
}

export type ChargeOutcome = { status: 'ok' } | { status: 'wrong_code' } | { status: 'declined'; reason: string }

export interface CardGateway {
  /** What the app shows above the one-time code field. */
  readonly otpHint: string
  /** Checks the card and returns a reusable token. Throws VALIDATION (bad details) or CARD_DECLINED. */
  tokenize(card: CardDetails): Promise<TokenizedCard>
  /** Starts a 3-D Secure charge of `amountCents` (amount + fee); the card holder gets a one-time code. */
  startCharge(token: string, amountCents: number): Promise<{ gatewayRef: string; otpHint: string }>
  /** Completes the charge with the holder's one-time code. */
  confirmCharge(gatewayRef: string, otp: string): Promise<ChargeOutcome>
}

// ---------- shared card checks (also what a real gateway's hosted fields would enforce) ----------

export function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export function cardBrand(digits: string): CardBrand | null {
  if (digits.startsWith('4')) return 'visa'
  const two = Number(digits.slice(0, 2))
  const four = Number(digits.slice(0, 4))
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'mastercard'
  return null
}

const MASERU_OFFSET_MS = 2 * 60 * 60 * 1000

/** Validates card details; returns the clean number. Throws VALIDATION with a message for the card holder. */
export function checkCard(card: CardDetails, now = Date.now()): { digits: string; brand: CardBrand; holderName: string } {
  const digits = String(card.number ?? '').replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits)) throw validation('Card number can only contain digits')
  if (digits.length < 13 || digits.length > 19) throw validation('Card number must be 13 to 19 digits')
  if (!luhnValid(digits)) throw validation('That card number is not valid. Check it and try again')
  const brand = cardBrand(digits)
  if (!brand) throw validation('Only Visa and Mastercard are supported')

  const local = new Date(now + MASERU_OFFSET_MS)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth() + 1
  if (!Number.isInteger(card.expMonth) || card.expMonth < 1 || card.expMonth > 12) throw validation('Expiry month must be 1 to 12')
  if (!Number.isInteger(card.expYear) || card.expYear < 2000) throw validation('Expiry year must have 4 digits')
  if (card.expYear < year || (card.expYear === year && card.expMonth < month)) throw validation('This card has expired')
  if (card.expYear > year + 20) throw validation('Expiry year is too far in the future')

  if (!/^\d{3}$/.test(String(card.cvv ?? ''))) throw validation('CVV must be 3 digits')
  const holderName = String(card.holderName ?? '').trim().replace(/\s+/g, ' ')
  if (holderName.length < 2 || holderName.length > 60) throw validation('Name on card must be 2 to 60 characters')
  return { digits, brand, holderName }
}

// ---------- mock ----------

/** Mock test cards (any other Luhn-valid Visa/Mastercard behaves normally). Only this module knows the numbers. */
const DECLINED_CARD = '4000000000000002'
const NO_FUNDS_CARD = '4000000000009995'
export const MOCK_OTP = '123456'
export const MOCK_OTP_HINT = `Enter the code sent by your bank. Test code: ${MOCK_OTP}`

/**
 * Stateless mock: the card's test behaviour is a flag inside the token (and the charge reference), so it survives
 * restarts without a table and without keeping the card number anywhere.
 */
export class MockCardGateway implements CardGateway {
  readonly otpHint = MOCK_OTP_HINT

  async tokenize(card: CardDetails): Promise<TokenizedCard> {
    const { digits, brand } = checkCard(card)
    if (digits === DECLINED_CARD) throw new AppError('CARD_DECLINED', 'Your bank declined this card')
    const behaviour = digits === NO_FUNDS_CARD ? 'nsf' : 'ok'
    return { token: `mocktok_${behaviour}_${randomUUID()}`, brand, last4: digits.slice(-4) }
  }

  async startCharge(token: string, amountCents: number): Promise<{ gatewayRef: string; otpHint: string }> {
    if (!token.startsWith('mocktok_')) throw new AppError('CARD_DECLINED', 'This card can no longer be used. Add it again')
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amountCents must be a positive integer')
    const behaviour = token.split('_')[1]
    return { gatewayRef: `mockch_${behaviour}_${randomDigits(12)}`, otpHint: MOCK_OTP_HINT }
  }

  async confirmCharge(gatewayRef: string, otp: string): Promise<ChargeOutcome> {
    if (otp.trim() !== MOCK_OTP) return { status: 'wrong_code' }
    if (gatewayRef.split('_')[1] === 'nsf') return { status: 'declined', reason: 'Insufficient funds on the card' }
    return { status: 'ok' }
  }
}
