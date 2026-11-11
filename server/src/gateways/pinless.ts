// EcoCash pinless payment payloads (split bill).
//
// Per the EcoCash API as described by ETL: creating a split sends each person a pinless payment payload for their
// share. It persists until the amount is paid, and money is only taken from people who approved it. The payee is a
// merchant or another subscriber. MockPinless stands in until the API documentation arrives; a real adapter
// implements the same `PinlessGateway` interface. The ledger (ctx.ledger) still records every movement.

import { newId } from '../lib/crypto'

export interface PinlessPayload {
  /** The split (its chat message id). */
  splitId: string
  payerMsisdn: string
  /** A subscriber's wallet number, or a merchant code. */
  payee: { msisdn: string } | { merchantCode: string }
  /** null: the payer types the amount when approving (split method "enter"). */
  amountCents: number | null
  /** Approve before this. */
  expiresAt: Date
  note: string | null
}

export interface PinlessGateway {
  /** Sends the payload to the payer's wallet. */
  create(p: PinlessPayload): Promise<{ payloadId: string }>
  /** The payer approved (with their PIN in EcoCash Super App). */
  approve(payloadId: string, amountCents: number): Promise<void>
  /** Takes part or all of what is owed, without a PIN. */
  collect(payloadId: string, amountCents: number): Promise<{ reference: string }>
  /** Declined, expired, paid in full elsewhere, moved, or the split was cancelled. */
  close(payloadId: string, reason: 'paid' | 'declined' | 'expired' | 'lapsed' | 'reassigned' | 'covered' | 'cancelled'): Promise<void>
}

export class MockPinless implements PinlessGateway {
  async create() {
    return { payloadId: `PL-${newId()}` }
  }
  async approve() {}
  async collect() {
    return { reference: `PLC-${newId()}` }
  }
  async close() {}
}
