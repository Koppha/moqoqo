// EcoCash services API: money out to other networks and wallets (C-Pay, Khetsi, M-Pesa, …), Econet airtime and
// bundles. All go through EcoCash, identified by the service's product code.
//
// MockEcoCashServices stands in until ETL gives access to the real API. A real adapter implements the same interface.

import type { ServiceExecutor, ServiceValues } from '../../../shared/api'
import { AppError } from '../errors'
import { randomDigits } from '../lib/crypto'

export interface ServiceCall {
  code: string
  executor: Exclude<ServiceExecutor, 'request'>
  amountCents: number
  /** The customer's form values (field key → value), passed through as the partner's parameters. */
  values: ServiceValues
  reference: string
}

export interface EcoCashServices {
  /** The other network's name for the account holder, or null when it can't say. Throws when the account is unknown. */
  lookupName(code: string, values: ServiceValues): Promise<string | null>
  /** Does it. Throws AppError (e.g. CARD_DECLINED-style VALIDATION) when the partner refuses. */
  execute(call: ServiceCall): Promise<{ partnerRef: string }>
}

const NAMES = ['Nthabiseng Mokoena', 'Tumelo Lebona', "Mpho Ramakatane", 'Lineo Sekhonyana', 'Teboho Mofolo', "'Maseeiso Phiri"]

/** Mock: names from the digits; any account or number ending in 0000 is refused, so failures can be tried. */
export class MockEcoCashServices implements EcoCashServices {
  readonly calls: ServiceCall[] = []

  async lookupName(_code: string, values: ServiceValues): Promise<string | null> {
    const account = accountOf(values)
    if (!account) return null
    if (account.endsWith('0000')) throw new AppError('NOT_FOUND', 'The other network does not know this account')
    const digits = account.replace(/\D/g, '')
    return NAMES[Number(digits.slice(-2) || '0') % NAMES.length]
  }

  async execute(call: ServiceCall): Promise<{ partnerRef: string }> {
    const account = accountOf(call.values)
    if (account?.endsWith('0000')) throw new AppError('VALIDATION', 'The other network refused this payment. No money was taken')
    this.calls.push(call)
    return { partnerRef: `EC${randomDigits(10)}` }
  }
}

/** The first value that looks like an account or phone number. */
function accountOf(values: ServiceValues): string | null {
  for (const [k, v] of Object.entries(values)) if (k !== 'amount' && /^\+?\d[\d\s-]{4,}$/.test(v)) return v.trim()
  return null
}
