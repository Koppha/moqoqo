import type { CardBrand } from '../../shared/api'

// Card checks done in the app before anything is sent, so mistakes show at once. The server and the gateway
// check again; the app never stores card details.

export const cardDigits = (v: string) => v.replace(/\D/g, '').slice(0, 19)

/** "4242424242424242" → "4242 4242 4242 4242" */
export const formatCardNumber = (v: string) => cardDigits(v).replace(/(\d{4})(?=\d)/g, '$1 ')

export function cardBrand(digits: string): CardBrand | null {
  if (/^4/.test(digits)) return 'visa'
  const two = Number(digits.slice(0, 2))
  const four = Number(digits.slice(0, 4))
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'mastercard'
  return null
}

/** Luhn checksum, as every card number carries. */
export function luhn(digits: string): boolean {
  if (digits.length < 13) return false
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

/** "1228" → "12/28" while typing. */
export const maskExpiry = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

/** "12/28" → { month: 12, year: 2028 } if not in the past; null otherwise. */
export function parseExpiry(v: string, now = new Date()): { month: number; year: number } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(v)
  if (!m) return null
  const month = Number(m[1])
  const year = 2000 + Number(m[2])
  if (month < 1 || month > 12) return null
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return null
  return { month, year }
}

export const brandName = (b: CardBrand) => (b === 'visa' ? 'Visa' : 'Mastercard')
export const cardLabel = (c: { brand: CardBrand; last4: string }) => `${brandName(c.brand)} •• ${c.last4}`
