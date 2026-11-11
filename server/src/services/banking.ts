// Wallet → bank account transfers and saved bank accounts. Contract: shared/api.ts "money in and out".
import type { BankAccount, BankAccountName, BankTransfer, BankTransferBody, BankTransferResult, BankTransferStatus } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { TransactionRow, TransferResult } from '../ecocash/index'
import { AppError, notFound } from '../errors'
import { findBank } from '../gateways/banks'
import { newId } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso, startOfMaseruDay } from '../lib/time'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { feesAccount, getTariff } from './tariff'
import { getUser, type UserRow } from './users'

/** "To Standard Lesotho Bank ••1234" */
export const withdrawLabel = (bankName: string, accountNumber: string) => `To ${bankName} ••${accountNumber.slice(-4)}`
export const BANK_FEE_LABEL = 'Bank transfer fee'

const bankName = (code: string) => {
  try {
    return findBank(code).name
  } catch {
    return code
  }
}

interface AccountRow {
  id: string
  user_id: string
  bank_code: string
  account_number: string
  account_name: string
  created_at: Date
  removed_at: Date | null
}

const toAccount = (a: AccountRow): BankAccount => ({
  id: a.id,
  bankCode: a.bank_code,
  bankName: bankName(a.bank_code),
  accountNumber: a.account_number,
  accountName: a.account_name,
  createdAt: iso(a.created_at),
})

interface TransferRow {
  id: string
  reference: string
  user_id: string
  bank_code: string
  account_number: string
  account_name: string
  amount_cents: number
  fee_cents: number
  status: BankTransferStatus
  bank_ref: string | null
  client_id: string
  transaction_id: string | null
  fee_transaction_id: string | null
  created_at: Date
}

const toTransfer = (t: TransferRow): BankTransfer => ({
  id: t.id,
  reference: t.reference,
  bankCode: t.bank_code,
  bankName: bankName(t.bank_code),
  accountNumber: t.account_number,
  accountName: t.account_name,
  amount: fromCents(t.amount_cents),
  fee: fromCents(t.fee_cents),
  total: fromCents(t.amount_cents + t.fee_cents),
  status: t.status,
  createdAt: iso(t.created_at),
})

export async function lookupAccount(ctx: Ctx, bankCode: string, accountNumber: string): Promise<BankAccountName> {
  const r = await ctx.banks.lookup(bankCode, accountNumber)
  return { bankCode: r.bank.code, accountNumber: r.accountNumber, accountName: r.accountName }
}

export async function listAccounts(q: Queryable, me: UserRow): Promise<BankAccount[]> {
  const rows = await q.query<AccountRow>(
    'SELECT * FROM bank_accounts WHERE user_id = $1 AND removed_at IS NULL ORDER BY created_at DESC, id DESC',
    [me.id],
  )
  return rows.map(toAccount)
}

export async function removeAccount(q: Queryable, me: UserRow, id: string): Promise<void> {
  const rows = await q.query('UPDATE bank_accounts SET removed_at = now() WHERE id = $1 AND user_id = $2 AND removed_at IS NULL RETURNING id', [id, me.id])
  if (!rows.length) throw notFound('Bank account not found')
}

async function saveAccount(q: Queryable, me: UserRow, bankCode: string, accountNumber: string, accountName: string): Promise<BankAccount> {
  const [row] = await q.query<AccountRow>(
    `INSERT INTO bank_accounts (id, user_id, bank_code, account_number, account_name) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, bank_code, account_number) WHERE removed_at IS NULL DO UPDATE SET account_name = EXCLUDED.account_name
     RETURNING *`,
    [newId(), me.id, bankCode, accountNumber, accountName],
  )
  return toAccount(row)
}

async function activeAccount(q: Queryable, me: UserRow, bankCode: string, accountNumber: string): Promise<BankAccount | undefined> {
  const [row] = await q.query<AccountRow>(
    'SELECT * FROM bank_accounts WHERE user_id = $1 AND bank_code = $2 AND account_number = $3 AND removed_at IS NULL',
    [me.id, bankCode, accountNumber],
  )
  return row ? toAccount(row) : undefined
}

/** A retry with the same clientId: the original transfer, its ledger row and the current balance. */
async function existingResult(q: Queryable, me: UserRow, t: TransferRow, save?: boolean): Promise<BankTransferResult> {
  const [tx] = await q.query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [t.transaction_id])
  const fresh = (await getUser(q, me.id)) ?? me
  const res: BankTransferResult = { transfer: toTransfer(t), money: await moneyResult(q, fresh, { tx, balances: new Map() }) }
  if (save) {
    const account = await activeAccount(q, me, t.bank_code, t.account_number)
    if (account) res.account = account
  }
  return res
}

export async function sendToBank(ctx: Ctx, me: UserRow, body: BankTransferBody): Promise<BankTransferResult> {
  const amountCents = paymentCents(body.amount)
  // The name comes from the bank, never from the app.
  const { bank, accountNumber, accountName } = await ctx.banks.lookup(body.bankCode, body.accountNumber)
  await checkPin(ctx.db, me, body.pin)

  const [dup] = await ctx.db.query<TransferRow>('SELECT * FROM bank_transfers WHERE user_id = $1 AND client_id = $2', [me.id, body.clientId])
  if (dup) return existingResult(ctx.db, me, dup, body.save)

  const tariff = await getTariff(ctx.db)
  const maxCents = Math.round(tariff.bankTransferMax * 100)
  if (amountCents > maxCents) throw new AppError('LIMIT_EXCEEDED', `The most you can send to a bank at once is ${formatM(maxCents)}`)
  const feeCents = Math.round(tariff.bankTransferFee * 100)

  return ctx.tx(async (q, out) => {
    const [wallet] = await q.query<{ balance_cents: number }>('SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE', [me.id])
    const [again] = await q.query<TransferRow>('SELECT * FROM bank_transfers WHERE user_id = $1 AND client_id = $2', [me.id, body.clientId])
    if (again) return existingResult(q, me, again, body.save)

    const [{ used }] = await q.query<{ used: number }>(
      `SELECT COALESCE(sum(amount_cents), 0) AS used FROM bank_transfers WHERE user_id = $1 AND created_at >= $2 AND status <> 'failed'`,
      [me.id, startOfMaseruDay()],
    )
    const dailyCents = Math.round(tariff.dailyMax * 100)
    if (used + amountCents > dailyCents) {
      const left = Math.max(0, dailyCents - used)
      throw new AppError('LIMIT_EXCEEDED', `Bank transfers are limited to ${formatM(dailyCents)} a day. You can still send ${formatM(left)} today`)
    }
    if (wallet.balance_cents < amountCents + feeCents) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        `Not enough money. You need ${formatM(amountCents + feeCents)} including the ${formatM(feeCents)} fee. Your balance is ${formatM(wallet.balance_cents)}`,
      )
    }

    // Both ledger rows in this one DB transaction: either the amount and the fee both leave the wallet, or neither does.
    const withdraw = await ctx.ledger.transfer(q, {
      kind: 'withdraw',
      fromUserId: me.id,
      toUserId: null,
      amountCents,
      label: withdrawLabel(bank.name, accountNumber),
    })
    let fee: TransferResult | null = null
    if (feeCents > 0) {
      const fees = await feesAccount(q)
      fee = await ctx.ledger.transfer(q, { kind: 'fee', fromUserId: me.id, toUserId: fees.id, amountCents: feeCents, label: BANK_FEE_LABEL })
    }
    const id = newId()
    await q.query(
      `INSERT INTO bank_transfers (id, user_id, bank_code, account_number, account_name, amount_cents, fee_cents, client_id, transaction_id, fee_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, me.id, bank.code, accountNumber, accountName, amountCents, feeCents, body.clientId, withdraw.tx.id, fee?.tx.id ?? null],
    )
    const [{ reference }] = await q.query<{ reference: string }>('SELECT reference FROM bank_transfers WHERE id = $1', [id])
    // Mock bank: completes at once. If a real bank call fails here, the whole DB transaction rolls back.
    const sent = await ctx.banks.send({ bankCode: bank.code, accountNumber, accountName, amountCents, reference })
    const [row] = await q.query<TransferRow>('UPDATE bank_transfers SET status = $2, bank_ref = $3 WHERE id = $1 RETURNING *', [id, sent.status, sent.bankRef])

    const balances = new Map([...withdraw.balances, ...(fee?.balances ?? [])])
    for (const [userId, cents] of balances) out.balance(userId, cents)
    const res: BankTransferResult = { transfer: toTransfer(row), money: await moneyResult(q, me, { tx: withdraw.tx, balances }) }
    if (body.save) res.account = await saveAccount(q, me, bank.code, accountNumber, accountName)
    return res
  })
}
