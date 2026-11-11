// KYC tiers: tier 1 wallets can't cash out or use ATMs, and their other payments are capped by limits set in the
// portal. Checked in one place, the ledger (see context.ts), so every way of paying is covered.
import { LIMIT_GROUP_KINDS, LIMIT_GROUPS, type KycLimits, type LimitGroup } from '../../../shared/api'
import type { Queryable } from '../db/index'
import type { TransferInput } from '../ecocash/index'
import { AppError } from '../errors'
import { formatM } from '../lib/money'
import { startOfMaseruDay } from '../lib/time'
import { setSetting } from './maintenance'

const NO_LIMITS: KycLimits = {
  perTransaction: Object.fromEntries(LIMIT_GROUPS.map((g) => [g, null])) as KycLimits['perTransaction'],
  daily: Object.fromEntries(LIMIT_GROUPS.map((g) => [g, null])) as KycLimits['daily'],
  dailyTotal: null,
}

export async function getKycLimits(q: Queryable): Promise<KycLimits> {
  const [row] = await q.query<{ value: Partial<KycLimits> | null }>(`SELECT value FROM app_settings WHERE key = 'kycLimits'`)
  const v = row?.value ?? {}
  return {
    perTransaction: { ...NO_LIMITS.perTransaction, ...(v.perTransaction ?? {}) },
    daily: { ...NO_LIMITS.daily, ...(v.daily ?? {}) },
    dailyTotal: v.dailyTotal ?? null,
  }
}

export async function setKycLimits(q: Queryable, limits: KycLimits): Promise<KycLimits> {
  await setSetting(q, 'kycLimits', limits)
  return getKycLimits(q)
}

/** Kinds that need tier 2: taking cash out at an agent or an ATM. */
const TIER2_ONLY = new Set<TransferInput['kind']>(['cashout', 'atm'])
const groupOf = (kind: TransferInput['kind']): LimitGroup | null => LIMIT_GROUPS.find((g) => LIMIT_GROUP_KINDS[g].includes(kind)) ?? null
const ALL_LIMITED = LIMIT_GROUPS.flatMap((g) => LIMIT_GROUP_KINDS[g])

/** Throws KYC_REQUIRED when a tier-1 person's payment isn't allowed. Called inside the payment's transaction. */
export async function checkKyc(q: Queryable, input: TransferInput): Promise<void> {
  if (!input.fromUserId || input.amountCents <= 0) return
  const [u] = await q.query<{ kind: string; kyc_tier: number }>('SELECT kind, kyc_tier FROM users WHERE id = $1', [input.fromUserId])
  if (!u || u.kind !== 'person' || u.kyc_tier >= 2) return
  if (TIER2_ONLY.has(input.kind)) {
    throw new AppError('KYC_REQUIRED', 'Update your KYC (ID and selfie) to take cash out. Go to Me › Update KYC')
  }
  const group = groupOf(input.kind)
  if (!group) return
  const limits = await getKycLimits(q)
  const per = limits.perTransaction[group]
  if (per !== null && input.amountCents > per * 100) {
    throw new AppError('KYC_REQUIRED', per === 0 ? 'Update your KYC to use this. Go to Me › Update KYC' : `Until your KYC is updated, the most you can pay at once here is ${formatM(per * 100)}`)
  }
  const day = limits.daily[group]
  const total = limits.dailyTotal
  if (day === null && total === null) return
  const since = startOfMaseruDay()
  const [sums] = await q.query<{ group_sum: string | null; all_sum: string | null }>(
    `SELECT sum(amount_cents) FILTER (WHERE kind = ANY($3)) AS group_sum, sum(amount_cents) AS all_sum
     FROM transactions WHERE from_user_id = $1 AND created_at >= $2 AND kind = ANY($4)`,
    [input.fromUserId, since, LIMIT_GROUP_KINDS[group], ALL_LIMITED],
  )
  const groupSum = Number(sums?.group_sum ?? 0) + input.amountCents
  const allSum = Number(sums?.all_sum ?? 0) + input.amountCents
  if (day !== null && groupSum > day * 100) throw new AppError('KYC_REQUIRED', `Until your KYC is updated, the daily limit here is ${formatM(day * 100)}`)
  if (total !== null && allSum > total * 100) throw new AppError('KYC_REQUIRED', `Until your KYC is updated, you can pay out at most ${formatM(total * 100)} a day`)
}
