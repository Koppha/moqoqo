// Remittance partner interface (wallet → another country).
//
// MockRemit stands in for the remittance partner (a money transfer operator or cross-border mobile money rails) until
// one is chosen and integrated. A real adapter implements the same `RemitGateway` interface.

import type { RemitPayout } from '../../../shared/api'
import { AppError } from '../errors'
import { randomDigits } from '../lib/crypto'

export interface RemitSend {
  reference: string // RM-000001
  country: string
  currency: string
  payout: RemitPayout
  recipientName: string
  recipientPhone: string | null
  bankName: string | null
  accountNumber: string | null
  amountCents: number // maloti
  receiveMinor: number // cents of `currency`
}

export interface RemitGateway {
  /** Hands the transfer to the partner. Cash pick-up returns the code the recipient shows at the partner agent. */
  send(transfer: RemitSend): Promise<{ status: 'completed' | 'submitted'; partnerRef: string; pickupCode: string | null }>
}

export class MockRemit implements RemitGateway {
  async send(t: RemitSend) {
    if (!Number.isInteger(t.amountCents) || t.amountCents <= 0) throw new AppError('VALIDATION', 'amount must be greater than 0')
    // Cash waits at the agent until collected; wallet and bank payouts complete at once in the mock.
    return {
      status: t.payout === 'cash' ? ('submitted' as const) : ('completed' as const),
      partnerRef: `RX${randomDigits(10)}`,
      pickupCode: t.payout === 'cash' ? randomDigits(8) : null,
    }
  }
}
