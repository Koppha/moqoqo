import type { BillKey } from '../types'
/** Biller codes on the EcoCash side. */
export type BillerCode = 'LEC' | 'WASCO' | 'SCHOOL' | 'ECONET_AIRTIME' | 'BURIAL'

export interface BillInfo {
  icon: string
  name: string
  /** Who receives the money, shown as "Paid directly to …". */
  payee: string
  biller: BillerCode
  /** Default account for the signed-in user. */
  account: string
  detail: string
}

export const BILLS: Record<BillKey, BillInfo> = {
  lec: { icon: '⚡', name: 'LEC', payee: 'LEC', biller: 'LEC', account: '04128890113', detail: 'Meter 0412 8890 113 · Ha Abia' },
  wasco: { icon: '💧', name: 'WASCO water', payee: 'WASCO', biller: 'WASCO', account: '201184471', detail: 'Account 20-118-4471' },
  school: { icon: '🎓', name: 'School fees', payee: 'the school', biller: 'SCHOOL', account: 'LHS-T3-0931', detail: 'Lesotho High School · Term 3' },
  airtime: { icon: '📱', name: 'Airtime / bundles', payee: 'Econet', biller: 'ECONET_AIRTIME', account: '+26662000021', detail: '+266 62•• ••21' },
  burial: { icon: '⚱️', name: 'Burial society', payee: 'the society', biller: 'BURIAL', account: 'MOKHOTHU-FS', detail: 'Mokhothu family society · October' },
}

export const BILL_KEYS = Object.keys(BILLS) as BillKey[]
