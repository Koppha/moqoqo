import type { AdminTransaction, Transaction } from '../../../shared/api'
import type { Queryable } from '../db/index'
import type { TransactionRow } from '../ecocash/index'
import { fromCents } from '../lib/money'
import { iso } from '../lib/time'
import { displayName, getUsers, toPublicUser, type UserRow } from './users'

type Side = 'out' | 'in'

/** Viewer-side wording for each ledger kind. */
function describe(row: TransactionRow, side: Side, other: string): string {
  const base = (() => {
    switch (row.kind) {
      case 'send': return side === 'out' ? `Sent to ${other}` : `From ${other}`
      case 'mpho': return side === 'out' ? `Mpho to ${other}` : `Mpho from ${other}`
      case 'request': return side === 'out' ? `Paid ${other}'s request` : `Request paid by ${other}`
      case 'bill': return side === 'out' ? row.label ?? `Bill · ${other}` : `Bill payment from ${other}`
      case 'merchant': return side === 'out' ? `Paid ${other}` : `Sale · ${other}`
      case 'tap': return side === 'out' ? `Tap to pay · ${other}` : `Tap sale · ${other}`
      case 'qr': return side === 'out' ? `QR payment · ${other}` : `QR sale · ${other}`
      case 'cashin': return side === 'out' ? `Cash-in for ${other}` : `Cash-in at ${other}`
      case 'cashout': return side === 'out' ? `Cash-out at ${other}` : `Cash-out for ${other}`
      case 'float': return row.label ?? 'Float top-up'
      case 'register': return side === 'out' ? `Registered ${other}` : `Registered by ${other}`
      // label: "EcoSure premium · ES-000101" / "EcoSure claim payout · CLM-2026-00001"
      case 'ecosure': return side === 'out' ? row.label ?? 'EcoSure premium' : `${row.label ?? 'EcoSure premium'} · from ${other}`
      case 'claim': return row.label ?? 'EcoSure claim payout'
      // label: "Card top-up · Visa •• 4242" / "To Standard Lesotho Bank ••1234" / "Bank transfer fee"
      case 'topup': return row.label ?? 'Card top-up'
      case 'withdraw': return row.label ?? 'Bank transfer'
      case 'fee': return side === 'out' ? row.label ?? 'Fee' : `${row.label ?? 'Fee'} · from ${other}`
      // label: "M-Pesa · 58123456" / "Bundles · Weekly 1 GB"
      case 'service': return row.label ?? 'Service'
      // label: "ATM withdrawal ATM-000001 (incl. fee M5.00)" / "… expired: money back" / "ATM cash ATM-000001 · Kingsway ATM"
      case 'atm': return row.label ?? 'ATM withdrawal'
      case 'atm_refund': return row.label ?? 'ATM withdrawal: money back'
    }
  })()
  return row.note && !LABELLED.has(row.kind) ? `${base} · ${row.note}` : base
}

/** Kinds whose label is the whole description (no note appended). */
const LABELLED = new Set<TransactionRow['kind']>(['bill', 'ecosure', 'claim', 'topup', 'withdraw', 'fee', 'service', 'atm', 'atm_refund'])

const SYSTEM_NAME = 'EcoCash'
/**
 * The other side when money enters or leaves the wallet system: claim payouts come from the (mock) underwriter
 * (EcoSure), card top-ups from the card ("Visa •• 4242"), bank transfers go to the bank ("Standard Lesotho Bank").
 */
function systemName(row: TransactionRow): string {
  if (row.kind === 'claim') return 'EcoSure'
  if (row.kind === 'topup') return row.label?.match(/^Card top-up · (.+)$/)?.[1] ?? 'Card'
  if (row.kind === 'withdraw') return row.label?.match(/^To (.+?)(?: ••\d+)?$/)?.[1] ?? 'Bank'
  return SYSTEM_NAME
}

export function toTransaction(row: TransactionRow, viewerId: string, users: Map<string, UserRow>): Transaction {
  const side: Side = row.from_user_id === viewerId ? 'out' : 'in'
  const otherId = side === 'out' ? row.to_user_id : row.from_user_id
  const other = otherId ? users.get(otherId) : undefined
  const counterpartyName = other ? displayName(other) : systemName(row)
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    amount: fromCents(side === 'out' ? -row.amount_cents : row.amount_cents),
    counterpartyName,
    description: describe(row, side, counterpartyName),
    createdAt: iso(row.created_at),
  }
}

export async function toTransactions(q: Queryable, rows: TransactionRow[], viewerId: string): Promise<Transaction[]> {
  const users = await getUsers(q, rows.flatMap((r) => [r.from_user_id, r.to_user_id]).filter((x): x is string => !!x))
  return rows.map((r) => toTransaction(r, viewerId, users))
}

export async function listTransactions(q: Queryable, userId: string, limit: number, kinds?: string[]): Promise<Transaction[]> {
  const rows = await q.query<TransactionRow>(
    `SELECT * FROM transactions
     WHERE (from_user_id = $1 OR to_user_id = $1) AND ($3::text[] IS NULL OR kind = ANY($3))
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit, kinds ?? null],
  )
  return toTransactions(q, rows, userId)
}

export async function toAdminTransactions(q: Queryable, rows: TransactionRow[]): Promise<AdminTransaction[]> {
  const users = await getUsers(q, rows.flatMap((r) => [r.from_user_id, r.to_user_id]).filter((x): x is string => !!x))
  return rows.map((r) => {
    const from = r.from_user_id ? users.get(r.from_user_id) : undefined
    const to = r.to_user_id ? users.get(r.to_user_id) : undefined
    const viewer = r.from_user_id ?? r.to_user_id ?? ''
    return {
      id: r.id,
      reference: r.reference,
      kind: r.kind,
      amount: fromCents(r.amount_cents),
      description: describe(r, r.from_user_id ? 'out' : 'in', toTransaction(r, viewer, users).counterpartyName),
      createdAt: iso(r.created_at),
      from: from ? toPublicUser(from) : null,
      to: to ? toPublicUser(to) : null,
    }
  })
}
