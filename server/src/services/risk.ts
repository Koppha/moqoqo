// Fraud and anomaly rules, run on every payment in the ledger (see context.ts). "block" stops the payment and records
// an alert; "flag" lets it through and records an alert. Staff review alerts in the portal (Risk).
import type { Page, RiskAlert, RiskAlertRule, RiskAlertStatus, RiskRule, RiskRuleKey } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Db, Queryable } from '../db/index'
import type { TransferInput, TransactionRow } from '../ecocash/index'
import { latestSwap, type SimSwapSource } from '../gateways/simswap'
import { recentRisk } from './deviceContext'
import { AppError, notFound } from '../errors'
import { facetCounts } from '../http'
import { newId } from '../lib/crypto'
import { formatM, fromCents } from '../lib/money'
import { iso } from '../lib/time'
import { logDecision, reviewDecisions } from './ai'
import { addEvent, attachAlert } from './cases'
import { CASHOUT_KINDS, NOT_PAYMENTS, scorePayment, scoreSummary, type Scored } from './fraudScore'
import { setSetting } from './maintenance'
import { getUsers, toPublicUser } from './users'

export const DEFAULT_RULES: RiskRule[] = [
  { key: 'velocity', enabled: true, action: 'block', params: { count: 10, minutes: 10 } },
  { key: 'new_device_cashout', enabled: true, action: 'block', params: { amount: 1000, hours: 24 } },
  { key: 'many_senders', enabled: true, action: 'flag', params: { senders: 8, minutes: 60 } },
  { key: 'unusual_amount', enabled: true, action: 'flag', params: { amount: 2000, times: 5 } },
  { key: 'night_cashout', enabled: true, action: 'flag', params: { amount: 1000, from: 0, to: 4 } },
  // Placeholders until ETL decides: hold for 72 h after a SIM swap; payments over M500 (and all money leaving EcoCash).
  { key: 'sim_swap', enabled: true, action: 'block', params: { hours: 72, amount: 500, setupHours: 72 } },
]
const SEVERITY: Record<RiskRuleKey, RiskAlert['severity']> = {
  velocity: 'high', new_device_cashout: 'high', many_senders: 'medium', unusual_amount: 'medium', night_cashout: 'low', sim_swap: 'high',
}

export async function getRules(q: Queryable): Promise<RiskRule[]> {
  const [row] = await q.query<{ value: RiskRule[] | null }>(`SELECT value FROM app_settings WHERE key = 'riskRules'`)
  const saved = row?.value ?? []
  return DEFAULT_RULES.map((d) => {
    const s = saved.find((r) => r.key === d.key)
    return s ? { ...d, ...s, params: { ...d.params, ...s.params } } : d
  })
}

export async function setRules(q: Queryable, rules: RiskRule[]): Promise<RiskRule[]> {
  await setSetting(q, 'riskRules', rules)
  return getRules(q)
}

export interface Hit {
  rule: RiskAlertRule
  action: 'flag' | 'block'
  detail: string
  /** Default: the rule's severity. */
  severity?: RiskAlert['severity']
  /** Serious enough to open a case on its own. */
  openCase?: boolean
}

/** The rules' flags and the behavioural score of a payment about to be made. */
export interface RiskCheck { hits: Hit[]; scored: Scored | null }

const scoreSeverity = (score: number): RiskAlert['severity'] => (score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low')

/** A payment stopped by a rule or by its score. The alert is written after the payment's transaction has rolled back (app.ts). */
export class RiskBlocked extends AppError {
  constructor(readonly alert: { userId: string; hit: Hit; amountCents: number; kind: string; scored: Scored | null }) {
    super('RISK_BLOCKED', 'For your safety this payment was stopped. Call EcoCash customer care if it was you')
  }
}

async function insertAlert(
  q: Queryable, userId: string, hit: Hit, amountCents: number | null, kind: string | null, txId: string | null,
  scored?: { score: number | null; decisionId: string } | null,
) {
  const id = newId()
  const severity = hit.severity ?? SEVERITY[hit.rule as RiskRuleKey] ?? 'medium'
  await q.query(
    `INSERT INTO risk_alerts (id, user_id, rule, action, severity, detail, amount_cents, kind, transaction_id, score, decision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, userId, hit.rule, hit.action === 'block' ? 'blocked' : 'flagged', severity, hit.detail, amountCents, kind, txId, scored?.score ?? null, scored?.decisionId ?? null],
  )
  await attachAlert(q, { id, userId, rule: hit.rule, severity, openCase: !!hit.openCase || hit.action === 'block', detail: hit.detail })
  return id
}

/** Writes an alert that isn't about one payment (transaction surveillance), with its decision, and its case. */
export async function raiseAlert(q: Queryable, userId: string, hit: Hit, amountCents: number | null, decisionId: string | null) {
  return insertAlert(q, userId, hit, amountCents, null, null, decisionId ? { score: null, decisionId } : null)
}

function logScore(q: Queryable, userId: string, s: Scored, outcome: Scored['outcome'], amountCents: number, kind: string, txId: string | null) {
  return logDecision(q, {
    model: 'fraud_score', version: s.model.version, shadow: s.shadow, userId, score: s.score, outcome, reasons: s.reasons, summary: scoreSummary(s),
    amountCents, kind, transactionId: txId,
  })
}

export async function recordBlocked(db: Db, err: RiskBlocked) {
  const a = err.alert
  await db
    .tx(async (q) => {
      const decisionId = a.scored ? await logScore(q, a.userId, a.scored, 'block', a.amountCents, a.kind, null) : null
      await insertAlert(q, a.userId, a.hit, a.amountCents, a.kind, null, a.scored && decisionId ? { score: a.scored.score, decisionId } : null)
    })
    .catch(() => {})
}

/**
 * The payer's number moved to a new SIM within `hours`, and staff haven't cleared it since: when, and how long ago.
 * A source that can't answer (Econet down) counts as no swap, so payments don't all stop; the alert from the swap
 * itself (webhook) still reaches staff.
 */
export async function activeSwap(q: Queryable, source: SimSwapSource, userId: string, hours: number): Promise<{ at: Date; hoursAgo: number } | null> {
  const [u] = await q.query<{ msisdn: string | null; cleared: Date | null }>('SELECT msisdn, sim_swap_cleared_at AS cleared FROM users WHERE id = $1', [userId])
  if (!u?.msisdn) return null
  let at: Date | null
  try {
    at = await latestSwap(q, source, u.msisdn)
  } catch {
    // The network didn't answer: a swap the bound phone reported still counts.
    const [d] = await q.query<{ at: Date | null }>(`SELECT max(swapped_at) AS at FROM sim_swaps WHERE source = 'device' AND cleared_at IS NULL AND msisdn = $1`, [u.msisdn])
    at = d?.at ? new Date(d.at) : null
  }
  if (!at) return null
  const hoursAgo = (Date.now() - at.getTime()) / 3_600_000
  if (hoursAgo > hours) return null
  if (u.cleared && new Date(u.cleared).getTime() >= at.getTime()) return null
  return { at, hoursAgo: Math.max(0, hoursAgo) }
}

/** Before a payment: rules and the behavioural score of the payer. Blocks throw RiskBlocked; flags are returned to record after the payment. */
export async function checkRisk(q: Queryable, input: TransferInput, simSwap?: SimSwapSource): Promise<RiskCheck> {
  const none: RiskCheck = { hits: [], scored: null }
  if (!input.fromUserId || input.amountCents <= 0 || NOT_PAYMENTS.includes(input.kind)) return none
  const [u] = await q.query<{ kind: string }>('SELECT kind FROM users WHERE id = $1', [input.fromUserId])
  if (u?.kind !== 'person') return none
  const rules = await getRules(q)
  const on = (k: RiskRuleKey) => rules.find((r) => r.key === k && r.enabled)
  const hits: Hit[] = []

  const velocity = on('velocity')
  if (velocity) {
    const [{ n }] = await q.query<{ n: number }>(
      // A batch (send to many) counts as one payment, and the batch being made is not counted twice.
      `SELECT count(DISTINCT coalesce(batch_id, id))::int AS n FROM transactions
       WHERE from_user_id = $1 AND created_at > now() - make_interval(mins => $2) AND NOT (kind = ANY($3)) AND ($4::text IS NULL OR batch_id IS DISTINCT FROM $4)`,
      [input.fromUserId, velocity.params.minutes, NOT_PAYMENTS, input.batchId ?? null],
    )
    if (n >= velocity.params.count) hits.push({ rule: 'velocity', action: velocity.action, detail: `${n + 1} payments out within ${velocity.params.minutes} minutes` })
  }

  const cashout = CASHOUT_KINDS.has(input.kind)
  const newDevice = on('new_device_cashout')
  if (newDevice && cashout && input.amountCents > newDevice.params.amount * 100) {
    const [d] = await q.query<{ model: string; hours: number }>(
      `SELECT d.model, extract(epoch FROM now() - d.bound_at) / 3600 AS hours FROM bound_devices d
       WHERE d.user_id = $1 AND d.unbound_at IS NULL AND d.bound_at > now() - make_interval(hours => $2)
         AND EXISTS (SELECT 1 FROM bound_devices p WHERE p.user_id = d.user_id AND p.id <> d.id)
       ORDER BY d.bound_at DESC LIMIT 1`,
      [input.fromUserId, newDevice.params.hours],
    )
    if (d) hits.push({ rule: 'new_device_cashout', action: newDevice.action, detail: `${formatM(input.amountCents)} ${input.kind} ${Math.round(Number(d.hours))} h after setting up ${d.model} (replacing another phone)` })
  }

  const unusual = on('unusual_amount')
  if (unusual && input.amountCents > unusual.params.amount * 100) {
    const [{ avg }] = await q.query<{ avg: string | null }>(
      `SELECT avg(amount_cents) AS avg FROM transactions WHERE from_user_id = $1 AND created_at > now() - interval '30 days' AND NOT (kind = ANY($2))`,
      [input.fromUserId, NOT_PAYMENTS],
    )
    const average = Number(avg ?? 0)
    if (average > 0 && input.amountCents > average * unusual.params.times) {
      hits.push({ rule: 'unusual_amount', action: unusual.action, detail: `${formatM(input.amountCents)} ${input.kind}; usual payment ${formatM(Math.round(average))}` })
    }
  }

  const night = on('night_cashout')
  if (night && cashout && input.amountCents > night.params.amount * 100) {
    const hour = new Date(Date.now() + 2 * 3_600_000).getUTCHours()
    if (hour >= night.params.from && hour < night.params.to) hits.push({ rule: 'night_cashout', action: night.action, detail: `${formatM(input.amountCents)} ${input.kind} at ${hour}:00` })
  }

  // After a SIM swap, a fraudster may hold the number: money leaving EcoCash, and large payments, wait.
  const swapRule = on('sim_swap')
  const swap = swapRule && simSwap ? await activeSwap(q, simSwap, input.fromUserId, swapRule.params.hours) : null
  if (swapRule && swap && (cashout || input.amountCents > swapRule.params.amount * 100)) {
    hits.push({
      rule: 'sim_swap', action: swapRule.action, severity: 'high', openCase: swapRule.action === 'block',
      detail: `${formatM(input.amountCents)} ${input.kind} ${Math.round(swap.hoursAgo)} h after this number moved to a new SIM`,
    })
  }

  const scored = await scorePayment(q, input, { simSwapHoursAgo: swap?.hoursAgo, context: recentRisk(input.fromUserId) })
  const block = hits.find((h) => h.action === 'block')
  const base = { userId: input.fromUserId, amountCents: input.amountCents, kind: input.kind, scored }
  if (block) throw new RiskBlocked({ ...base, hit: block })
  if (scored && !scored.shadow && scored.outcome === 'block') {
    throw new RiskBlocked({ ...base, hit: { rule: 'behaviour_score', action: 'block', detail: scoreSummary(scored), severity: 'high', openCase: true } })
  }
  if (scored && !scored.shadow && scored.outcome === 'flag') {
    hits.push({ rule: 'behaviour_score', action: 'flag', detail: scoreSummary(scored), severity: scoreSeverity(scored.score), openCase: scored.score >= scored.model.params.caseAt })
  }
  return { hits, scored }
}

/** After a payment: its score and flags (inside its transaction), and flags about the receiver. */
export async function afterTransfer(q: Queryable, tx: TransactionRow, check: RiskCheck) {
  const { hits, scored } = check
  const decisionId = scored ? await logScore(q, tx.from_user_id!, scored, scored.outcome, Number(tx.amount_cents), tx.kind, tx.id) : null
  const link = scored && decisionId ? { score: scored.score, decisionId } : null
  for (const h of hits) await insertAlert(q, tx.from_user_id!, h, Number(tx.amount_cents), tx.kind, tx.id, link)
  if (!tx.to_user_id || !tx.from_user_id) return
  const rules = await getRules(q)
  const many = rules.find((r) => r.key === 'many_senders' && r.enabled)
  if (!many) return
  const [{ n }] = await q.query<{ n: number }>(
    `SELECT count(DISTINCT from_user_id)::int AS n FROM transactions t JOIN users u ON u.id = t.to_user_id
     WHERE t.to_user_id = $1 AND u.kind = 'person' AND u.role = 'customer' AND t.created_at > now() - make_interval(mins => $2) AND NOT (t.kind = ANY($3))`,
    [tx.to_user_id, many.params.minutes, NOT_PAYMENTS],
  )
  if (n < many.params.senders) return
  // One open alert per receiver at a time.
  const [open] = await q.query(`SELECT 1 FROM risk_alerts WHERE user_id = $1 AND rule = 'many_senders' AND status = 'open'`, [tx.to_user_id])
  if (!open) await insertAlert(q, tx.to_user_id, { rule: 'many_senders', action: 'flag', detail: `${n} different people paid this wallet within ${many.params.minutes} minutes` }, Number(tx.amount_cents), tx.kind, tx.id)
}

// ---------- portal ----------

export interface AlertRow {
  id: string; user_id: string; rule: RiskAlertRule; action: RiskAlert['action']; severity: RiskAlert['severity']; detail: string
  amount_cents: number | null; kind: string | null; status: RiskAlertStatus; reviewed_by: string | null; created_at: Date
  transaction_id: string | null; score: number | null; decision_id: string | null; case_id: string | null
}

export async function toAlerts(q: Queryable, rows: AlertRow[]): Promise<RiskAlert[]> {
  const users = await getUsers(q, rows.map((r) => r.user_id))
  const caseIds = [...new Set(rows.flatMap((r) => (r.case_id ? [r.case_id] : [])))]
  const cases = caseIds.length ? await q.query<{ id: string; ref: string }>('SELECT id, ref FROM fraud_cases WHERE id = ANY($1)', [caseIds]) : []
  const refs = new Map(cases.map((c) => [c.id, c.ref]))
  return rows.map((r) => ({
    id: r.id, user: toPublicUser(users.get(r.user_id)!), rule: r.rule, action: r.action, severity: r.severity, detail: r.detail,
    amount: r.amount_cents == null ? null : fromCents(r.amount_cents), kind: r.kind, status: r.status, reviewedBy: r.reviewed_by, createdAt: iso(r.created_at),
    score: r.score, decisionId: r.decision_id, caseId: r.case_id, caseRef: r.case_id ? (refs.get(r.case_id) ?? null) : null,
  }))
}

export interface AlertFilters { status: RiskAlertStatus | null; severity: RiskAlert['severity'] | null; action: RiskAlert['action'] | null }

export async function listAlerts(q: Queryable, filters: AlertFilters, page: number, pageSize: number): Promise<Page<RiskAlert>> {
  const where = '($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR severity = $2) AND ($3::text IS NULL OR action = $3)'
  const params = [filters.status, filters.severity, filters.action]
  const [{ total }] = await q.query<{ total: number }>(`SELECT count(*)::int AS total FROM risk_alerts WHERE ${where}`, params)
  const rows = await q.query<AlertRow>(
    `SELECT * FROM risk_alerts WHERE ${where}
     ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC LIMIT $4 OFFSET $5`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const groups = await q.query<{ status: string; severity: string; action: string; n: number }>(
    'SELECT status, severity, action, count(*)::int AS n FROM risk_alerts GROUP BY status, severity, action',
  )
  return { items: await toAlerts(q, rows), total, page, pageSize, counts: facetCounts(groups, filters) }
}

export async function review(ctx: Ctx, id: string, adminEmail: string, body: { status: 'fraud' | 'ok'; suspend?: boolean }): Promise<RiskAlert> {
  const [r] = await ctx.db.query<AlertRow>(
    `UPDATE risk_alerts SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [id, body.status, adminEmail],
  )
  if (!r) throw notFound('Alert not found')
  await reviewDecisions(ctx.db, [r.decision_id], body.status)
  if (r.case_id) await addEvent(ctx.db, r.case_id, adminEmail, 'note', `Alert reviewed as ${body.status === 'fraud' ? 'fraud' : 'fine'}: ${r.detail}${body.suspend ? ' (wallet suspended)' : ''}`)
  if (body.status === 'fraud' && body.suspend) {
    await ctx.db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [r.user_id])
    await ctx.db.query('DELETE FROM sessions WHERE user_id = $1', [r.user_id])
    ctx.hub.disconnectUser(r.user_id, 4403, 'SUSPENDED')
  }
  return (await toAlerts(ctx.db, [r]))[0]
}
