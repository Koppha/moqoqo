import type { BillKey } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { validation } from '../errors'
import { randomDigits } from '../lib/crypto'
import type { UserRow } from './users'

/**
 * Billers, mirroring src/data/bills.ts in the app. Each biller is a system wallet (users.kind = 'system')
 * that receives bill payments; billers cannot log in. `code` is the EcoCash biller code.
 */
export const BILLERS: Record<BillKey, { name: string; code: string; label: string }> = {
  lec: { name: 'LEC', code: 'LEC', label: 'LEC' },
  wasco: { name: 'WASCO Water', code: 'WASCO', label: 'WASCO water' },
  school: { name: 'School fees', code: 'SCHOOL', label: 'School fees' },
  airtime: { name: 'Econet Airtime', code: 'ECONET_AIRTIME', label: 'Airtime' },
  burial: { name: 'Burial society', code: 'BURIAL', label: 'Burial society' },
}

export const BILL_KEYS = Object.keys(BILLERS) as BillKey[]

export function parseBill(bill: unknown): BillKey {
  if (typeof bill !== 'string' || !(bill in BILLERS)) throw validation(`bill must be one of ${BILL_KEYS.join(', ')}`)
  return bill as BillKey
}

export async function billerAccount(q: Queryable, bill: BillKey): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [bill])
  if (!u) throw new Error(`biller account for ${bill} missing (seed not run?)`)
  return u
}

/** "04127731905" → "0412 7731 905" */
export const formatMeter = (account: string) => account.replace(/\s+/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')

/**
 * Mock LEC prepaid token: 5 groups of 4 digits and units at M1 = 0.684 kWh.
 * The real EcoCash/LEC vending API returns these once integrated.
 */
export function vendLecToken(amountCents: number): { token: string; units: string; kwh: string } {
  const token = Array.from({ length: 5 }, () => randomDigits(4)).join('-')
  const kwh = ((amountCents / 100) * 0.684).toFixed(1)
  return { token, units: `${kwh} kWh`, kwh }
}

export function lecTokenText(account: string, amountCents: number, token: string, kwh: string): string {
  const amount = (amountCents / 100).toFixed(2)
  return `Token for meter ${formatMeter(account)}:\n${token}\nM${amount} · ${kwh} kWh`
}
