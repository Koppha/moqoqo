// Behavioural fraud score: every payment by a person is scored 0–100 against their own usual behaviour. Points-based
// and fully explainable: each point comes with a plain reason that staff see in the portal. Runs inside the payment's
// database transaction, so it is a handful of indexed queries.
import type { AiOutcome, ScoreFeature, ScoreReason } from '../../../shared/api'
import type { Queryable } from '../db/index'
import type { TransferInput } from '../ecocash/index'
import { formatM } from '../lib/money'
import { getModel, type ModelConfig } from './ai'

export interface Scored {
  model: ModelConfig
  score: number
  reasons: ScoreReason[]
  /** What the model decided; in shadow mode it is only logged. */
  outcome: AiOutcome
  shadow: boolean
}

/** Money leaving the wallet system or to an agent: what fraudsters cash out with. */
export const CASHOUT_KINDS = new Set<TransferInput['kind']>(['cashout', 'atm', 'withdraw', 'service'])
/** Not a person's own payments. */
export const NOT_PAYMENTS = ['fee', 'atm_refund', 'register', 'float', 'claim', 'topup']

const M = 100 // cents

/** Maseru hour (UTC+2, no daylight saving). */
const maseruHour = (d = new Date()) => new Date(d.getTime() + 2 * 3_600_000).getUTCHours()

export function outcomeFor(score: number, params: Record<string, number>): AiOutcome {
  if (params.blockAt > 0 && score >= params.blockAt) return 'block'
  if (score >= params.flagAt) return 'flag'
  return 'allow'
}

/** null: not scored (model off, not a person, or not a payment). */
/** `simSwapHoursAgo`: the payer's number moved to a new SIM that long ago (within the sim_swap rule's hours, not cleared). */
export async function scorePayment(
  q: Queryable, input: TransferInput, extra: { simSwapHoursAgo?: number; context?: { points: number; reasons: string[] } | null } = {},
): Promise<Scored | null> {
  if (!input.fromUserId || input.amountCents <= 0 || NOT_PAYMENTS.includes(input.kind)) return null
  const model = await getModel(q, 'fraud_score')
  if (model.mode === 'off') return null
  const [payer] = await q.query<{ kind: string; balance_cents: string; age_hours: number }>(
    `SELECT kind, balance_cents, extract(epoch FROM now() - created_at) / 3600 AS age_hours FROM users WHERE id = $1`,
    [input.fromUserId],
  )
  if (payer?.kind !== 'person') return null

  const amount = input.amountCents
  const hour = maseruHour()
  const nearHours = [(hour + 23) % 24, hour, (hour + 1) % 24]
  const [h] = await q.query<{ n: number; avg: string | null; last_hour: number; same_hours: number; paid_before: boolean | null }>(
    `SELECT count(*)::int AS n, avg(amount_cents) AS avg,
            count(DISTINCT coalesce(batch_id, id)) FILTER (WHERE created_at > now() - interval '1 hour' AND ($5::text IS NULL OR batch_id IS DISTINCT FROM $5))::int AS last_hour,
            count(*) FILTER (WHERE extract(hour FROM created_at + interval '2 hours')::int = ANY($4))::int AS same_hours,
            bool_or(to_user_id = $2) AS paid_before
     FROM transactions WHERE from_user_id = $1 AND created_at > now() - interval '90 days' AND NOT (kind = ANY($3))`,
    [input.fromUserId, input.toUserId, NOT_PAYMENTS, nearHours, input.batchId ?? null],
  )
  const reasons: ScoreReason[] = []
  const add = (feature: ScoreFeature, points: number, detail: string) => points > 0 && reasons.push({ feature, points, detail })
  const cashOut = CASHOUT_KINDS.has(input.kind)

  // How the amount compares with what they usually pay.
  const avg = Number(h.avg ?? 0)
  if (h.n >= 3 && avg > 0 && amount >= 200 * M) {
    const ratio = amount / avg
    add('amount_vs_usual', ratio >= 10 ? 30 : ratio >= 5 ? 20 : ratio >= 3 ? 10 : 0, `${formatM(amount)} is ${Math.round(ratio)}× their usual ${formatM(Math.round(avg))}`)
  } else if (h.n < 3 && amount >= 1000 * M) {
    add('thin_history', 10, `${formatM(amount)} with only ${h.n} payment${h.n === 1 ? '' : 's'} in 90 days`)
  }

  const ageHours = Number(payer.age_hours)
  add('new_account', ageHours < 24 ? 15 : ageHours < 24 * 7 ? 10 : 0, `Wallet opened ${ageHours < 24 ? `${Math.round(ageHours)} h` : `${Math.round(ageHours / 24)} days`} ago`)

  const [device] = await q.query<{ model: string; hours: number }>(
    `SELECT d.model, extract(epoch FROM now() - d.bound_at) / 3600 AS hours FROM bound_devices d
     WHERE d.user_id = $1 AND d.unbound_at IS NULL AND d.bound_at > now() - interval '48 hours'
       AND EXISTS (SELECT 1 FROM bound_devices p WHERE p.user_id = d.user_id AND p.id <> d.id)
     ORDER BY d.bound_at DESC LIMIT 1`,
    [input.fromUserId],
  )
  if (device) add('new_device', cashOut ? 35 : 25, `${device.model} set up ${Math.round(Number(device.hours))} h ago, replacing another phone`)
  if (extra.simSwapHoursAgo !== undefined) add('sim_swap', 40, `Number moved to a new SIM ${Math.round(extra.simSwapHoursAgo)} h ago`)
  if (extra.context?.points) add('unusual_context', Math.min(40, extra.context.points), `Bound phone unlike its usual: ${extra.context.reasons.join('; ')}`)

  if (cashOut) add('cash_out', 10, `${input.kind} of ${formatM(amount)}`)

  if (h.n >= 10 && h.same_hours === 0) add('unusual_hour', 10, `At ${hour}:00; none of their ${h.n} payments in 90 days were near this hour`)
  else if (hour < 5 && amount >= 500 * M) add('unusual_hour', 5, `${formatM(amount)} at ${hour}:00`)

  add('velocity', h.last_hour >= 10 ? 25 : h.last_hour >= 5 ? 15 : 0, `${h.last_hour + 1} payments in the last hour`)

  const balance = Number(payer.balance_cents)
  if (amount >= 500 * M && amount >= balance * 0.9) add('drains_balance', 15, `${formatM(amount)} of a ${formatM(balance)} balance`)

  if (input.toUserId) {
    const [r] = await q.query<{ kind: string; role: string; age_hours: number; fraud: number; open: number }>(
      `SELECT u.kind, u.role, extract(epoch FROM now() - u.created_at) / 3600 AS age_hours,
              (SELECT count(*) FROM risk_alerts a WHERE a.user_id = u.id AND a.status = 'fraud' AND a.created_at > now() - interval '180 days')::int AS fraud,
              (SELECT count(*) FROM risk_alerts a WHERE a.user_id = u.id AND a.status = 'open')::int AS open
       FROM users u WHERE u.id = $1`,
      [input.toUserId],
    )
    if (r?.kind === 'person') {
      if (r.fraud > 0) add('risky_recipient', 30, `Receiver had ${r.fraud} alert${r.fraud === 1 ? '' : 's'} confirmed as fraud`)
      else if (r.open > 0) add('risky_recipient', 15, `Receiver has ${r.open} open fraud alert${r.open === 1 ? '' : 's'}`)
      else if (Number(r.age_hours) < 72 && amount >= 500 * M) add('risky_recipient', 5, 'Receiver\'s wallet is less than 3 days old')
      if (r.role === 'customer' && !h.paid_before && amount >= 500 * M) add('new_recipient', 10, `First payment to this person, ${formatM(amount)}`)
    }
  }

  reasons.sort((a, b) => b.points - a.points)
  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0))
  return { model, score, reasons, outcome: outcomeFor(score, model.params), shadow: model.mode === 'shadow' }
}

/** One line for alerts and the decision log: "Score 72: new phone, cash-out, empties the wallet". */
export function scoreSummary(s: Pick<Scored, 'score' | 'reasons'>): string {
  const top = s.reasons.slice(0, 3).map((r) => r.detail)
  return `Score ${s.score}${top.length ? `: ${top.join('; ')}` : ''}`
}
