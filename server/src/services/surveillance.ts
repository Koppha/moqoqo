// Transaction surveillance (anti-money-laundering): every 15 minutes, looks across the last day of payments for
// patterns no single payment shows. Alerts open a case for staff; nothing is ever stopped from here. Scenarios and
// thresholds are set in AI governance (placeholders until ETL compliance confirms them).
import type { SurveillanceKey } from '../../../shared/api'
import type { Ctx } from '../context'
import { formatM } from '../lib/money'
import { getModel, logDecision } from './ai'
import { NOT_PAYMENTS } from './fraudScore'
import { analyseAuth } from './authAnalysis'
import { raiseAlert, type Hit } from './risk'

/** Incoming money that isn't really someone paying this wallet. */
const NOT_INCOMING = ['fee', 'register', 'float', 'atm_refund']

interface Finding { userId: string; rule: SurveillanceKey; severity: 'high' | 'medium'; detail: string; amountCents: number }

export async function runSurveillance(ctx: Ctx): Promise<number> {
  const model = await getModel(ctx.db, 'aml_surveillance')
  // Payments let through without a flag are only kept 90 days (governance retention).
  await ctx.db.query(`DELETE FROM ai_decisions WHERE outcome = 'allow' AND review IS NULL AND created_at < now() - interval '90 days'`)
  if (model.mode === 'off') return 0
  const p = model.params
  const q = ctx.db
  const findings: Finding[] = []

  // Several payments just under a reporting amount within a day.
  const threshold = p.structuringAmount * 100
  for (const r of await q.query<{ user_id: string; n: number; total: string }>(
    `SELECT t.from_user_id AS user_id, count(*)::int AS n, sum(t.amount_cents) AS total
     FROM transactions t JOIN users u ON u.id = t.from_user_id AND u.kind = 'person'
     WHERE t.created_at > now() - interval '24 hours' AND NOT (t.kind = ANY($1)) AND t.amount_cents >= $2 AND t.amount_cents < $3
     GROUP BY 1 HAVING count(*) >= $4`,
    [NOT_PAYMENTS, Math.round(threshold * 0.8), threshold, p.structuringCount],
  )) {
    findings.push({
      userId: r.user_id, rule: 'structuring', severity: 'medium', amountCents: Number(r.total),
      detail: `${r.n} payments between ${formatM(Math.round(threshold * 0.8))} and ${formatM(threshold)} within 24 h, ${formatM(Number(r.total))} in all`,
    })
  }

  // Money received and sent straight on (a mule wallet).
  for (const r of await q.query<{ user_id: string; in_v: string; out_v: string; senders: number }>(
    `WITH i AS (SELECT to_user_id AS user_id, sum(amount_cents) AS v, count(DISTINCT from_user_id)::int AS senders FROM transactions
                WHERE created_at > now() - interval '24 hours' AND to_user_id IS NOT NULL AND NOT (kind = ANY($1)) GROUP BY 1),
          o AS (SELECT from_user_id AS user_id, sum(amount_cents) AS v FROM transactions
                WHERE created_at > now() - interval '24 hours' AND from_user_id IS NOT NULL AND NOT (kind = ANY($2)) GROUP BY 1)
     SELECT i.user_id, i.v AS in_v, o.v AS out_v, i.senders FROM i JOIN o ON o.user_id = i.user_id
       JOIN users u ON u.id = i.user_id AND u.kind = 'person' AND u.role = 'customer'
     WHERE i.v >= $3 AND o.v * 100 >= i.v * $4`,
    [NOT_INCOMING, NOT_PAYMENTS, p.passThroughMin * 100, p.passThroughPercent],
  )) {
    const inV = Number(r.in_v)
    const outV = Number(r.out_v)
    findings.push({
      userId: r.user_id, rule: 'pass_through', severity: 'high', amountCents: outV,
      detail: `Received ${formatM(inV)} from ${r.senders} sender${r.senders === 1 ? '' : 's'} and sent on ${formatM(outV)} (${Math.round((outV / inV) * 100)}%) within 24 h`,
    })
  }

  // A wallet with no payments for a long time suddenly paying out a lot.
  for (const r of await q.query<{ user_id: string; v: string; last: Date }>(
    `SELECT t.from_user_id AS user_id, sum(t.amount_cents) AS v,
            (SELECT max(p.created_at) FROM transactions p WHERE p.from_user_id = t.from_user_id AND p.created_at <= now() - interval '24 hours') AS last
     FROM transactions t JOIN users u ON u.id = t.from_user_id AND u.kind = 'person' AND u.role = 'customer'
     WHERE t.created_at > now() - interval '24 hours' AND NOT (t.kind = ANY($1))
     GROUP BY t.from_user_id HAVING sum(t.amount_cents) >= $2`,
    [NOT_PAYMENTS, p.dormantAmount * 100],
  )) {
    if (!r.last) continue // a new wallet, not a dormant one
    const days = Math.floor((Date.now() - new Date(r.last).getTime()) / 86_400_000)
    if (days < p.dormantDays) continue
    findings.push({ userId: r.user_id, rule: 'dormant_reactivation', severity: 'medium', amountCents: Number(r.v), detail: `${formatM(Number(r.v))} paid out today after ${days} days with no payments` })
  }

  let raised = 0
  for (const f of findings) {
    await ctx.db.tx(async (tx) => {
      // One alert per wallet and scenario a day.
      const [seen] = await tx.query(
        `SELECT 1 FROM ai_decisions WHERE model = 'aml_surveillance' AND user_id = $1 AND reasons @> $2 AND created_at > now() - interval '24 hours'`,
        [f.userId, JSON.stringify([{ feature: f.rule }])],
      )
      if (seen) return
      const shadow = model.mode === 'shadow'
      const decisionId = await logDecision(tx, {
        model: 'aml_surveillance', version: model.version, shadow, userId: f.userId, score: null, outcome: 'flag',
        reasons: [{ feature: f.rule, points: 0, detail: f.detail }], summary: f.detail, amountCents: f.amountCents,
      })
      if (shadow) return
      const hit: Hit = { rule: f.rule, action: 'flag', detail: f.detail, severity: f.severity, openCase: true }
      await raiseAlert(tx, f.userId, hit, f.amountCents, decisionId)
      raised++
    })
  }
  return raised
}

export function createSurveillanceSweeper(ctx: Ctx, everyMs = 15 * 60_000) {
  let timer: NodeJS.Timeout | null = null
  let busy = false
  const sweep = async () => {
    if (busy) return 0
    busy = true
    try {
      const auth = await analyseAuth(ctx).catch((err) => { ctx.log.error({ err }, 'sign-in analysis failed'); return 0 })
      return (await runSurveillance(ctx)) + auth
    } catch (err) {
      ctx.log.error({ err }, 'transaction surveillance failed')
      return 0
    } finally {
      busy = false
    }
  }
  return {
    sweep,
    start() {
      timer = setInterval(() => void sweep(), everyMs)
      timer.unref()
      void sweep()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
