// Bank interface (wallet → bank account transfers).
//
// MockBanks stands in for the real bank rails (EFT / switch) until they are integrated. A real adapter implements
// the same `BankGateway` interface: list the banks, look up an account holder's name, and send money.

import type { Bank } from '../../../shared/api'
import { AppError, notFound, validation } from '../errors'
import { randomDigits } from '../lib/crypto'

export interface BankSend {
  bankCode: string
  accountNumber: string
  accountName: string
  amountCents: number
  reference: string // BT-000001, shown on the bank statement
}

export interface BankGateway {
  banks(): Bank[]
  /** The bank's name for the account holder. Throws VALIDATION (unknown bank, wrong number format) or NOT_FOUND. */
  lookup(bankCode: string, accountNumber: string): Promise<{ bank: Bank; accountNumber: string; accountName: string }>
  /** Sends the money. The mock completes at once. */
  send(transfer: BankSend): Promise<{ status: 'completed' | 'submitted'; bankRef: string }>
}

const BANKS: Bank[] = [
  { code: 'SLB', name: 'Standard Lesotho Bank', accountLength: 11 },
  { code: 'FNB', name: 'FNB Lesotho', accountLength: 11 },
  { code: 'NED', name: 'Nedbank Lesotho', accountLength: 11 },
  { code: 'LPB', name: 'Lesotho PostBank', accountLength: 10 },
]

export function findBank(code: string): Bank {
  const bank = BANKS.find((b) => b.code === String(code ?? '').trim().toUpperCase())
  if (!bank) throw validation(`bank must be one of ${BANKS.map((b) => b.code).join(', ')}`)
  return bank
}

/** Digits only, exactly the bank's length (spaces and dashes are ignored). */
export function checkAccountNumber(bank: Bank, raw: string): string {
  const digits = String(raw ?? '').replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits)) throw validation('Account number can only contain digits')
  if (digits.length !== bank.accountLength) throw validation(`${bank.name} account numbers have ${bank.accountLength} digits`)
  return digits
}

const INITIALS = 'TLMPKNRSDH'
const SURNAMES = ['MOKHOTHU', 'LETSIE', 'MOKOENA', 'THABANE', 'MOSHOESHOE', 'RAMONE', 'NTHAKO', 'SEKHONYANA', 'MAJORO', 'MOLAPO']

/** A plausible, deterministic Basotho account name from the digits, upper-case like banks show it ("T MOKHOTHU"). */
export function mockAccountName(digits: string): string {
  const d = digits.split('').map(Number)
  const sum = d.reduce((a, b) => a + b, 0)
  const first = INITIALS[(d[d.length - 1] + d[0]) % INITIALS.length]
  const second = sum % 3 === 0 ? ` ${INITIALS[(d[d.length - 2] + 3) % INITIALS.length]}` : ''
  return `${first}${second} ${SURNAMES[(sum + d[d.length - 3]) % SURNAMES.length]}`
}

export class MockBanks implements BankGateway {
  banks(): Bank[] {
    return BANKS.map((b) => ({ ...b }))
  }

  async lookup(bankCode: string, accountNumber: string) {
    const bank = findBank(bankCode)
    const digits = checkAccountNumber(bank, accountNumber)
    if (digits.endsWith('0000')) throw notFound(`No account with that number at ${bank.name}`)
    return { bank, accountNumber: digits, accountName: mockAccountName(digits) }
  }

  async send(t: BankSend) {
    if (!Number.isInteger(t.amountCents) || t.amountCents <= 0) throw new AppError('VALIDATION', 'amount must be greater than 0')
    return { status: 'completed' as const, bankRef: `${t.bankCode}${randomDigits(10)}` }
  }
}
