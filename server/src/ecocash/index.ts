// EcoCash money movement.
//
// MockLedger moves balances inside EcoCash Super App's own database. When Econet Telecom Lesotho provides the
// real EcoCash API, an EcoCashLedger adapter implementing the same `Ledger` interface replaces it:
// it would call EcoCash first (or reserve funds) and then record the result here. Either way the
// server keeps balances and the ledger authoritative; clients never compute balances.

import type { Transaction } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { AppError, conflict } from '../errors'
import { newId, newReference } from '../lib/crypto'
import { formatM } from '../lib/money'

export type TxKind = Transaction['kind']

export interface TransferInput {
  kind: TxKind
  /** null = money entering the wallet system from outside (bank deposit for agent float). */
  fromUserId: string | null
  /** null = money leaving the wallet system. */
  toUserId: string | null
  amountCents: number
  label?: string | null
  note?: string | null
  messageId?: string | null
  /** Payments made together (send to many): the velocity rule counts them as one. */
  batchId?: string | null
}

export interface TransactionRow {
  id: string
  reference: string
  kind: TxKind
  amount_cents: number
  from_user_id: string | null
  to_user_id: string | null
  label: string | null
  note: string | null
  message_id: string | null
  batch_id?: string | null
  created_at: Date
}

export interface TransferResult {
  tx: TransactionRow
  /** New balances (cents) of every wallet that changed. */
  balances: Map<string, number>
}

export interface Ledger {
  /** Must be called inside a DB transaction (q from Db.tx). Locks the affected wallets. */
  transfer(q: Queryable, input: TransferInput): Promise<TransferResult>
}

/** In-database ledger standing in for EcoCash until the real API adapter exists. */
export class MockLedger implements Ledger {
  async transfer(q: Queryable, input: TransferInput): Promise<TransferResult> {
    const { fromUserId, toUserId, amountCents } = input
    if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('amountCents must be a non-negative integer')
    if (fromUserId && fromUserId === toUserId) throw new AppError('VALIDATION', 'You cannot pay yourself')

    // Lock both wallets in a stable order (by id) so concurrent transfers cannot deadlock.
    const ids = [fromUserId, toUserId].filter((x): x is string => !!x).sort()
    const rows = await q.query<{ id: string; balance_cents: number; status: string; name: string }>(
      'SELECT id, balance_cents, status, name FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [ids],
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const id of ids) if (!byId.has(id)) throw new AppError('NOT_REGISTERED', 'Wallet not found')

    if (fromUserId) {
      const from = byId.get(fromUserId)!
      if (from.status !== 'active') throw new AppError('SUSPENDED', 'This wallet is suspended')
      if (from.balance_cents < amountCents) {
        throw new AppError('INSUFFICIENT_FUNDS', `Not enough money. Your balance is ${formatM(from.balance_cents)}`)
      }
    }
    if (toUserId && byId.get(toUserId)!.status !== 'active') throw conflict(`${byId.get(toUserId)!.name}'s wallet is suspended`)

    const balances = new Map<string, number>()
    if (amountCents > 0) {
      if (fromUserId) {
        const [r] = await q.query<{ balance_cents: number }>(
          'UPDATE users SET balance_cents = balance_cents - $2 WHERE id = $1 RETURNING balance_cents',
          [fromUserId, amountCents],
        )
        balances.set(fromUserId, r.balance_cents)
      }
      if (toUserId) {
        const [r] = await q.query<{ balance_cents: number }>(
          'UPDATE users SET balance_cents = balance_cents + $2 WHERE id = $1 RETURNING balance_cents',
          [toUserId, amountCents],
        )
        balances.set(toUserId, r.balance_cents)
      }
    }

    const [tx] = await q.query<TransactionRow>(
      `INSERT INTO transactions (id, reference, kind, amount_cents, from_user_id, to_user_id, label, note, message_id, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [newId(), newReference(), input.kind, amountCents, fromUserId, toUserId, input.label ?? null, input.note ?? null, input.messageId ?? null, input.batchId ?? null],
    )
    return { tx, balances }
  }
}
