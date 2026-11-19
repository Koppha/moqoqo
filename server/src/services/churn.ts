// Retention: how likely each agent and merchant is to stop using EcoCash (AI governance model 'churn_risk').
// Once a Lesotho day every active agent and merchant gets a 0–100 points score from their own activity over the last
// 8 weeks, with the reasons. Staff work the list in the portal (Retention) and record what they did. Nothing here
// changes an account or a payment.
import type {
  AiModelMode, ChurnActivity, ChurnBand, ChurnDetail, ChurnFollowupBody, ChurnFollowupStatus, ChurnPage, ChurnReason, ChurnRow, ChurnSummary, Role,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { notFound } from '../errors'
import { facetCounts } from '../http'
import { fromCents } from '../lib/money'
import { iso } from '../lib/time'
import { getModel, type ModelConfig } from './ai'

const DAY_MS = 86_400_000
const MASERU_OFFSET_MS = 2 * 3_600_000
/** Recent window and the baseline before it. */
const RECENT_DAYS = 14
const BASELINE_DAYS = 42
/** Less history than this and the score can't tell a slowdown from a start. */
const MIN_TENURE_DAYS = 28

/** "2026-11-19": the Lesotho calendar day of `now`. */
export const maseruDay = (now = new Date()) => new Date(now.getTime() + MASERU_OFFSET_MS).toISOString().slice(0, 10)

export interface ChurnParams { highAt: number; mediumAt: number; quietDays: number; lowFloat: number }

const pct = (n: number) => `${Math.round(n * 100)}%`
const drop = (now: number, before: number) => (before > 0 ? Math.max(0, 1 - now / before) : 0)
const m = (n: number) => `M${Math.round(n).toLocaleString('en')}`

/** The score, band and reasons for one agent or merchant. Pure, so it can be checked on its own. */
export function scoreChurn(a: ChurnActivity, role: Role, p: ChurnParams): { score: number; band: ChurnBand; reasons: ChurnReason[] } {
  const quietFor = a.daysSinceLast ?? a.tenureDays
  if (a.tenureDays >= MIN_TENURE_DAYS && quietFor >= p.quietDays) {
    return { score: 100, band: 'quiet', reasons: [{ feature: 'inactive', points: 100, detail: a.daysSinceLast === null ? 'No transaction yet' : `No transaction for ${quietFor} days` }] }
  }
  if (a.tenureDays < MIN_TENURE_DAYS) {
    return { score: 0, band: 'low', reasons: [{ feature: 'new_account', points: 0, detail: `With EcoCash ${a.tenureDays} day${a.tenureDays === 1 ? '' : 's'}` }] }
  }
  const reasons: ChurnReason[] = []
  const add = (feature: ChurnReason['feature'], points: number, detail: string) => points > 0 && reasons.push({ feature, points, detail })

  add('inactive', quietFor >= 14 ? 40 : quietFor >= 7 ? 25 : quietFor >= 3 ? 10 : 0, `Last transaction ${quietFor} days ago`)
  // Drops only count against a real baseline, so a quiet business staying quiet isn't "dropping".
  if (a.txPerWeekBefore >= 3) {
    const d = drop(a.txPerWeekNow, a.txPerWeekBefore)
    add('activity_drop', d >= 0.7 ? 30 : d >= 0.4 ? 20 : d >= 0.2 ? 10 : 0, `${a.txPerWeekNow.toFixed(1)} transactions a week, down ${pct(d)} from ${a.txPerWeekBefore.toFixed(1)}`)
  }
  if (a.valuePerWeekBefore >= 100) {
    const d = drop(a.valuePerWeekNow, a.valuePerWeekBefore)
    add('value_drop', d >= 0.5 ? 10 : d >= 0.3 ? 5 : 0, `${m(a.valuePerWeekNow)} a week, down ${pct(d)} from ${m(a.valuePerWeekBefore)}`)
  }
  if (a.customersPerWeekBefore >= 2) {
    const d = drop(a.customersPerWeekNow, a.customersPerWeekBefore)
    add('customers_drop', d >= 0.5 ? 15 : d >= 0.3 ? 8 : 0, `${a.customersPerWeekNow.toFixed(1)} customers a week, down ${pct(d)} from ${a.customersPerWeekBefore.toFixed(1)}`)
  }
  add('few_active_days', a.activeDays28 <= 4 ? 10 : 0, `Active on ${a.activeDays28} of the last 28 days`)
  if (role === 'agent') add('low_float', a.balance < p.lowFloat ? 15 : 0, `Float ${m(a.balance)}, below ${m(p.lowFloat)}`)

  reasons.sort((x, y) => y.points - x.points)
  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0))
  const band: ChurnBand = score >= p.highAt ? 'high' : score >= p.mediumAt ? 'medium' : 'low'
  return { score, band, reasons }
}

const params = (model: ModelConfig): ChurnParams => model.params as unknown as ChurnParams

interface ActivityRow {
  id: string
  role: Role
  balance_cents: string | number
  created_at: Date
  last_at: Date | null
  n_now: number
  n_before: number
  v_now: string | number
  v_before: string | number
  c_now: number
  c_before: number
  days28: number
}

/** Activity of every active agent and merchant, as of `now`. */
async function activities(q: Queryable, now: Date): Promise<{ id: string; role: Role; activity: ChurnActivity }[]> {
  const recent = new Date(now.getTime() - RECENT_DAYS * DAY_MS)
  const from = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * DAY_MS)
  const d28 = new Date(now.getTime() - 28 * DAY_MS)
  const rows = await q.query<ActivityRow>(
    `SELECT e.id, e.role, e.balance_cents, e.created_at,
            (SELECT max(t.created_at) FROM transactions t
              WHERE (t.from_user_id = e.id OR t.to_user_id = e.id) AND t.created_at < $1 AND t.kind NOT IN ('fee', 'register')) AS last_at,
            a.*
       FROM users e
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE t.created_at >= $2)::int AS n_now,
                count(*) FILTER (WHERE t.created_at < $2)::int AS n_before,
                COALESCE(sum(t.amount_cents) FILTER (WHERE t.created_at >= $2), 0) AS v_now,
                COALESCE(sum(t.amount_cents) FILTER (WHERE t.created_at < $2), 0) AS v_before,
                count(DISTINCT CASE WHEN t.from_user_id = e.id THEN t.to_user_id ELSE t.from_user_id END) FILTER (WHERE t.created_at >= $2)::int AS c_now,
                count(DISTINCT CASE WHEN t.from_user_id = e.id THEN t.to_user_id ELSE t.from_user_id END) FILTER (WHERE t.created_at < $2)::int AS c_before,
                count(DISTINCT (t.created_at + interval '2 hours')::date) FILTER (WHERE t.created_at >= $4)::int AS days28
           FROM transactions t
          WHERE (t.from_user_id = e.id OR t.to_user_id = e.id) AND t.created_at >= $3 AND t.created_at < $1 AND t.kind NOT IN ('fee', 'register')
       ) a ON true
      WHERE e.kind = 'person' AND e.status = 'active' AND e.role IN ('agent', 'merchant')`,
    [now, recent, from, d28],
  )
  const weeksNow = RECENT_DAYS / 7
  const weeksBefore = BASELINE_DAYS / 7
  const r1 = (n: number) => Math.round(n * 10) / 10
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    activity: {
      daysSinceLast: r.last_at ? Math.floor((now.getTime() - new Date(r.last_at).getTime()) / DAY_MS) : null,
      txPerWeekNow: r1((r.n_now ?? 0) / weeksNow),
      txPerWeekBefore: r1((r.n_before ?? 0) / weeksBefore),
      valuePerWeekNow: Math.round(fromCents(Number(r.v_now ?? 0)) / weeksNow),
      valuePerWeekBefore: Math.round(fromCents(Number(r.v_before ?? 0)) / weeksBefore),
      customersPerWeekNow: r1((r.c_now ?? 0) / weeksNow),
      customersPerWeekBefore: r1((r.c_before ?? 0) / weeksBefore),
      activeDays28: r.days28 ?? 0,
      balance: fromCents(Number(r.balance_cents)),
      tenureDays: Math.floor((now.getTime() - new Date(r.created_at).getTime()) / DAY_MS),
    },
  }))
}

/** Scores every active agent and merchant for today (replacing an earlier run today). 0 when the model is off. */
export async function runChurnScoring(ctx: Ctx, now = new Date()): Promise<number> {
  const model = await getModel(ctx.db, 'churn_risk')
  if (model.mode === 'off') return 0
  const p = params(model)
  const day = maseruDay(now)
  const list = await activities(ctx.db, now)
  await ctx.tx(async (q) => {
    for (const e of list) {
      const s = scoreChurn(e.activity, e.role, p)
      await q.query(
        `INSERT INTO churn_scores (user_id, day, score, band, reasons, activity, model_version) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, day) DO UPDATE SET score = $3, band = $4, reasons = $5, activity = $6, model_version = $7, created_at = now()`,
        [e.id, day, s.score, s.band, JSON.stringify(s.reasons), JSON.stringify(e.activity), model.version],
      )
    }
  })
  return list.length
}

/** Scores once a Lesotho day: checks hourly whether today's run is still to do. */
export function createChurnSweeper(ctx: Ctx, everyMs = 60 * 60_000) {
  let timer: NodeJS.Timeout | null = null
  let busy = false
  const sweep = async () => {
    if (busy) return
    busy = true
    try {
      const [done] = await ctx.db.query('SELECT 1 FROM churn_scores WHERE day = $1 LIMIT 1', [maseruDay()])
      if (!done) await runChurnScoring(ctx)
    } catch (err) {
      ctx.log.error({ err }, 'churn scoring failed')
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

// ---------- portal ----------

interface ScoreRow {
  user_id: string
  name: string
  business_name: string | null
  msisdn: string | null
  role: Role
  code: string | null
  score: number
  band: ChurnBand
  reasons: ChurnReason[]
  activity: ChurnActivity
  created_at: Date
  week_ago: number | null
  f_status: ChurnFollowupStatus | null
  f_note: string | null
  f_by: string | null
  f_at: Date | null
}

const toRow = (r: ScoreRow): ChurnRow => ({
  user: { id: r.user_id, msisdn: r.msisdn ?? '', name: r.name, role: r.role, code: r.code, ...(r.business_name ? { businessName: r.business_name } : {}) },
  score: r.score,
  band: r.band,
  scoreWeekAgo: r.week_ago,
  reasons: r.reasons,
  activity: r.activity,
  scoredAt: iso(r.created_at),
  followup: { status: r.f_status ?? 'new', note: r.f_note, by: r.f_by, at: r.f_at ? iso(r.f_at) : null },
})

const SELECT = `SELECT s.user_id, u.name, u.business_name, u.msisdn, u.role, u.code, s.score, s.band, s.reasons, s.activity, s.created_at,
       w.score AS week_ago, f.status AS f_status, f.note AS f_note, f.updated_by AS f_by, f.updated_at AS f_at
  FROM churn_scores s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN churn_scores w ON w.user_id = s.user_id AND w.day = s.day - 7
  LEFT JOIN churn_followups f ON f.user_id = s.user_id`

async function latestDay(q: Queryable): Promise<string | null> {
  const [r] = await q.query<{ day: string | null }>(`SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM churn_scores`)
  return r?.day ?? null
}

export interface ChurnFilters { role: 'agent' | 'merchant' | null; band: ChurnBand | null; followup: ChurnFollowupStatus | null; query: string | null }

export async function listChurn(q: Queryable, f: ChurnFilters, page: number, pageSize: number): Promise<ChurnPage> {
  const day = await latestDay(q)
  const summary = await churnSummary(q, day)
  if (!day) return { items: [], total: 0, page, pageSize, counts: {}, summary }
  const search = f.query?.trim() ? `%${f.query.trim().replace(/[%_\\]/g, '\\$&')}%` : null
  const where = `s.day = $1::date AND ($2::text IS NULL OR u.role = $2) AND ($3::text IS NULL OR s.band = $3)
    AND ($4::text IS NULL OR COALESCE(f.status, 'new') = $4)
    AND ($5::text IS NULL OR u.name ILIKE $5 OR u.business_name ILIKE $5 OR u.msisdn ILIKE $5 OR u.code ILIKE $5)`
  const args = [day, f.role, f.band, f.followup, search]
  const [{ n }] = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${SELECT} WHERE ${where}) x`, args)
  const rows = await q.query<ScoreRow>(
    `${SELECT} WHERE ${where}
     ORDER BY CASE s.band WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'quiet' THEN 2 ELSE 3 END, s.score DESC, u.name
     LIMIT $6 OFFSET $7`,
    [...args, pageSize, (page - 1) * pageSize],
  )
  // Filter chip counts: search applied, each filter left out of its own count.
  const facets = await q.query<{ role: string; band: string; followup: string; n: number }>(
    `SELECT u.role, s.band, COALESCE(f.status, 'new') AS followup, count(*)::int AS n
       FROM churn_scores s JOIN users u ON u.id = s.user_id LEFT JOIN churn_followups f ON f.user_id = s.user_id
      WHERE s.day = $1::date AND ($2::text IS NULL OR u.name ILIKE $2 OR u.business_name ILIKE $2 OR u.msisdn ILIKE $2 OR u.code ILIKE $2)
      GROUP BY 1, 2, 3`,
    [day, search],
  )
  const counts = facetCounts(facets, { role: f.role, band: f.band, followup: f.followup })
  return { items: rows.map(toRow), total: n, page, pageSize, counts, summary }
}

async function churnSummary(q: Queryable, day: string | null): Promise<ChurnSummary> {
  const model = await getModel(q, 'churn_risk')
  const empty = () => ({ high: 0, medium: 0, low: 0, quiet: 0 })
  const byBand = { agent: empty(), merchant: empty() }
  let weeklyValueAtRisk = 0
  let lastRun: string | null = null
  if (day) {
    const bands = await q.query<{ role: 'agent' | 'merchant'; band: ChurnBand; n: number; v: string | null; at: Date }>(
      `SELECT u.role, s.band, count(*)::int AS n, sum((s.activity->>'valuePerWeekBefore')::numeric) AS v, max(s.created_at) AS at
         FROM churn_scores s JOIN users u ON u.id = s.user_id WHERE s.day = $1::date GROUP BY 1, 2`,
      [day],
    )
    for (const b of bands) {
      if (b.role in byBand) byBand[b.role][b.band] = b.n
      if (b.band === 'high' || b.band === 'medium') weeklyValueAtRisk += Number(b.v ?? 0)
      if (!lastRun || new Date(b.at) > new Date(lastRun)) lastRun = iso(b.at)
    }
  }
  return { byBand, weeklyValueAtRisk: Math.round(weeklyValueAtRisk), backtest: await backtest(q, day), modelMode: model.mode as AiModelMode, modelVersion: model.version, lastRun }
}

/**
 * The model's track record: take the most recent scoring day 30–37 days before the latest one, and see how many of
 * those not yet quiet then are quiet now, by the band they were given.
 */
async function backtest(q: Queryable, latest: string | null): Promise<ChurnSummary['backtest']> {
  const zero = { scored: 0, wentQuiet: 0 }
  const none = { scoredOn: null, high: { ...zero }, medium: { ...zero }, low: { ...zero } }
  if (!latest) return none
  const [then] = await q.query<{ day: string | null }>(
    `SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM churn_scores WHERE day <= $1::date - 30 AND day >= $1::date - 37`,
    [latest],
  )
  if (!then?.day) return none
  const rows = await q.query<{ band: 'high' | 'medium' | 'low'; scored: number; quiet: number }>(
    `SELECT a.band, count(*)::int AS scored, count(*) FILTER (WHERE b.band = 'quiet')::int AS quiet
       FROM churn_scores a JOIN churn_scores b ON b.user_id = a.user_id AND b.day = $2::date
      WHERE a.day = $1::date AND a.band <> 'quiet' GROUP BY a.band`,
    [then.day, latest],
  )
  const out = { scoredOn: then.day, high: { ...zero }, medium: { ...zero }, low: { ...zero } }
  for (const r of rows) out[r.band] = { scored: r.scored, wentQuiet: r.quiet }
  return out
}

export async function churnDetail(q: Queryable, userId: string): Promise<ChurnDetail> {
  const [r] = await q.query<ScoreRow>(`${SELECT} WHERE s.user_id = $1 ORDER BY s.day DESC LIMIT 1`, [userId])
  if (!r) throw notFound('No churn score for this agent or merchant yet')
  const history = await q.query<{ day: string; score: number; band: ChurnBand }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, score, band FROM churn_scores WHERE user_id = $1 AND day >= CURRENT_DATE - 90 ORDER BY day`,
    [userId],
  )
  return { ...toRow(r), history }
}

export async function setFollowup(q: Queryable, userId: string, body: ChurnFollowupBody, by: string): Promise<ChurnRow> {
  const [scored] = await q.query('SELECT 1 FROM churn_scores WHERE user_id = $1 LIMIT 1', [userId])
  if (!scored) throw notFound('No churn score for this agent or merchant yet')
  await q.query(
    `INSERT INTO churn_followups (user_id, status, note, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET status = $2, note = $3, updated_by = $4, updated_at = now()`,
    [userId, body.status, body.note.trim() || null, by],
  )
  const { history, ...row } = await churnDetail(q, userId)
  void history
  return row
}
