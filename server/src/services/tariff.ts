// Fees and limits for money in and out (card top-ups, bank transfers). Stored in app_settings under 'tariff'.
import { cardTopupFee, type Tariff } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { notFound } from '../errors'
import type { UserRow } from './users'

/** PLACEHOLDER values until the real tariff is known (also seeded by migration 007). */
export const DEFAULT_TARIFF: Tariff = {
  cardTopupFeePercent: 2,
  cardTopupFeeMin: 1,
  cardTopupMax: 5000,
  bankTransferFee: 10,
  bankTransferMax: 10000,
  dailyMax: 20000,
  atmFee: 5,
  atmMax: 3000,
}

/** The EcoCash Super App fees system wallet (users.kind 'system', official). Ensured by db/seed.ts ensureBillers. */
export const FEES_ACCOUNT = { name: 'EcoCash Super App', biller: 'fees' } as const

export async function feesAccount(q: Queryable): Promise<UserRow> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE biller = $1', [FEES_ACCOUNT.biller])
  if (!u) throw notFound('Fees account missing (seed not run?)')
  return u
}

export async function getTariff(q: Queryable): Promise<Tariff> {
  const [row] = await q.query<{ value: Partial<Tariff> | null }>(`SELECT value FROM app_settings WHERE key = 'tariff'`)
  const t = { ...DEFAULT_TARIFF }
  for (const k of Object.keys(DEFAULT_TARIFF) as (keyof Tariff)[]) {
    const v = row?.value?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) t[k] = v
  }
  return t
}

/** Card top-up fee in cents (the shared formula, so the app shows the same sum). */
export const cardTopupFeeCents = (t: Tariff, amountCents: number) => Math.round(cardTopupFee(t, amountCents / 100) * 100)
