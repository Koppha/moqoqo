// AI governance and model risk management: the model registry (versioned modes and thresholds), the decision log,
// and how well each model does against staff reviews. Portal: AI governance.
import { AI_MODEL_INFO, type AiDecision, type AiModel, type AiModelKey, type AiModelMode, type AiModelVersion, type AiOutcome, type Page, type ScoreReason } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError } from '../errors'
import { facetCounts } from '../http'
import { newId } from '../lib/crypto'
import { fromCents } from '../lib/money'
import { iso } from '../lib/time'
import { getUsers, toPublicUser } from './users'

export type ConfigurableModel = Exclude<AiModelKey, 'assistant'>

/** Version 0: what runs until staff change it. Thresholds are placeholders until ETL sets them. */
export const MODEL_DEFAULTS: Record<ConfigurableModel, { mode: AiModelMode; params: Record<string, number> }> = {
  fraud_score: { mode: 'active', params: { flagAt: 60, blockAt: 0, caseAt: 80 } },
  aml_surveillance: {
    mode: 'active',
    params: { structuringAmount: 5000, structuringCount: 3, passThroughMin: 2000, passThroughPercent: 80, dormantDays: 90, dormantAmount: 2000 },
  },
  case_summary: { mode: 'active', params: {} },
}

export interface ModelConfig { key: ConfigurableModel; version: number; mode: AiModelMode; params: Record<string, number> }

export async function getModel(q: Queryable, key: ConfigurableModel): Promise<ModelConfig> {
  const [row] = await q.query<{ version: number; mode: AiModelMode; params: Record<string, number> }>(
    'SELECT version, mode, params FROM ai_model_versions WHERE model = $1 ORDER BY version DESC LIMIT 1',
    [key],
  )
  const d = MODEL_DEFAULTS[key]
  return row ? { key, version: row.version, mode: row.mode, params: { ...d.params, ...row.params } } : { key, version: 0, ...d }
}

export async function setModel(q: Queryable, key: ConfigurableModel, body: { mode: AiModelMode; params: Record<string, number>; note: string }, by: string): Promise<void> {
  const info = AI_MODEL_INFO[key]
  if (!info.modes.includes(body.mode)) throw new AppError('VALIDATION', `${info.title} can't be set to ${body.mode}`)
  const params: Record<string, number> = {}
  for (const [k, p] of Object.entries(info.params)) {
    const v = body.params[k]
    if (v === undefined) continue
    if (!Number.isFinite(v) || v < p.min || v > p.max) throw new AppError('VALIDATION', `${p.label} must be between ${p.min} and ${p.max}`)
    params[k] = v
  }
  const current = await getModel(q, key)
  await q.query('INSERT INTO ai_model_versions (model, version, mode, params, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)', [
    key, current.version + 1, body.mode, JSON.stringify({ ...current.params, ...params }), by, body.note.trim() || null,
  ])
}

export async function modelVersions(q: Queryable, key: ConfigurableModel): Promise<AiModelVersion[]> {
  const rows = await q.query<{ version: number; mode: AiModelMode; params: Record<string, number>; changed_by: string | null; note: string | null; created_at: Date }>(
    'SELECT * FROM ai_model_versions WHERE model = $1 ORDER BY version DESC LIMIT 50',
    [key],
  )
  return rows.map((r) => ({ version: r.version, mode: r.mode, params: r.params, changedBy: r.changed_by, changedAt: iso(r.created_at), note: r.note }))
}

export interface DecisionInput {
  model: ConfigurableModel
  version: number
  shadow: boolean
  userId: string | null
  score: number | null
  outcome: AiOutcome
  reasons?: ScoreReason[]
  summary: string
  amountCents?: number | null
  kind?: string | null
  transactionId?: string | null
  caseId?: string | null
}

export async function logDecision(q: Queryable, d: DecisionInput): Promise<string> {
  const id = newId()
  await q.query(
    `INSERT INTO ai_decisions (id, model, version, shadow, user_id, score, outcome, reasons, summary, amount_cents, kind, transaction_id, case_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, d.model, d.version, d.shadow, d.userId, d.score, d.outcome, JSON.stringify(d.reasons ?? []), d.summary, d.amountCents ?? null, d.kind ?? null, d.transactionId ?? null, d.caseId ?? null],
  )
  return id
}

/** Staff reviewed the alert(s) behind these decisions: record what they found, to measure each model. */
export async function reviewDecisions(q: Queryable, decisionIds: (string | null)[], review: 'fraud' | 'ok') {
  const ids = decisionIds.filter((x): x is string => !!x)
  if (ids.length) await q.query('UPDATE ai_decisions SET review = $2 WHERE id = ANY($1)', [ids, review])
}

const EMPTY_OUTCOMES = (): Record<AiOutcome, number> => ({ allow: 0, flag: 0, block: 0, info: 0 })

export async function listModels(ctx: Ctx): Promise<AiModel[]> {
  const q = ctx.db
  const since = new Date(Date.now() - 30 * 86_400_000)
  const outcomes = await q.query<{ model: AiModelKey; outcome: AiOutcome; n: number }>(
    'SELECT model, outcome, count(*)::int AS n FROM ai_decisions WHERE created_at >= $1 AND NOT shadow GROUP BY model, outcome',
    [since],
  )
  const reviews = await q.query<{ model: AiModelKey; review: 'fraud' | 'ok'; n: number }>(
    'SELECT model, review, count(*)::int AS n FROM ai_decisions WHERE created_at >= $1 AND review IS NOT NULL GROUP BY model, review',
    [since],
  )
  const buckets = await q.query<{ model: AiModelKey; b: number; n: number }>(
    'SELECT model, least(score / 10, 9)::int AS b, count(*)::int AS n FROM ai_decisions WHERE created_at >= $1 AND score IS NOT NULL GROUP BY model, b',
    [since],
  )
  const avgs = await q.query<{ model: AiModelKey; last_week: string | null; before: string | null }>(
    `SELECT model, avg(score) FILTER (WHERE created_at >= now() - interval '7 days') AS last_week,
            avg(score) FILTER (WHERE created_at < now() - interval '7 days') AS before
     FROM ai_decisions WHERE created_at >= now() - interval '28 days' AND score IS NOT NULL GROUP BY model`,
  )
  // The EcoCash Assistant's activity is in its own log (support).
  const [assistant] = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM assistant_events WHERE created_at >= $1 AND kind = 'answer'`, [since])
  const llm = `Anthropic ${ctx.config.assistantModel}`
  const keys = Object.keys(AI_MODEL_INFO) as AiModelKey[]
  const out: AiModel[] = []
  for (const key of keys) {
    const byOutcome = EMPTY_OUTCOMES()
    for (const r of outcomes) if (r.model === key) byOutcome[r.outcome] = r.n
    const confirmedFraud = reviews.find((r) => r.model === key && r.review === 'fraud')?.n ?? 0
    const falsePositives = reviews.find((r) => r.model === key && r.review === 'ok')?.n ?? 0
    const scoreBuckets = AI_MODEL_INFO[key].kind === 'scoring' ? Array.from({ length: 10 }, (_, i) => buckets.find((b) => b.model === key && b.b === i)?.n ?? 0) : []
    const avg = avgs.find((a) => a.model === key)
    const round = (v: string | null | undefined) => (v == null ? null : Math.round(Number(v) * 10) / 10)
    const stats = {
      decisions: key === 'assistant' ? assistant.n : Object.values(byOutcome).reduce((a, b) => a + b, 0),
      byOutcome: key === 'assistant' ? { ...byOutcome, info: assistant.n } : byOutcome,
      confirmedFraud,
      falsePositives,
      precision: confirmedFraud + falsePositives ? confirmedFraud / (confirmedFraud + falsePositives) : null,
      scoreBuckets,
      avgScore: { lastWeek: round(avg?.last_week), before: round(avg?.before) },
    }
    if (key === 'assistant') {
      const on = ctx.assistant?.enabled ?? false
      out.push({ key, version: 1, mode: on ? 'active' : 'off', params: {}, changedBy: null, changedAt: null, note: null, provider: llm, available: on, stats })
      continue
    }
    const m = await getModel(q, key)
    const [v] = m.version
      ? await q.query<{ changed_by: string | null; note: string | null; created_at: Date }>('SELECT changed_by, note, created_at FROM ai_model_versions WHERE model = $1 AND version = $2', [key, m.version])
      : []
    out.push({
      key,
      version: m.version,
      mode: m.mode,
      params: m.params,
      changedBy: v?.changed_by ?? null,
      changedAt: v ? iso(v.created_at) : null,
      note: v?.note ?? null,
      provider: AI_MODEL_INFO[key].kind === 'llm' ? llm : 'In-house, explainable',
      available: AI_MODEL_INFO[key].kind !== 'llm' || !!ctx.llm,
      stats,
    })
  }
  return out
}

interface DecisionRow {
  id: string; model: AiModelKey; version: number; shadow: boolean; user_id: string | null; score: number | null; outcome: AiOutcome
  reasons: ScoreReason[]; summary: string; amount_cents: string | null; kind: string | null; reference: string | null; review: 'fraud' | 'ok' | null; created_at: Date
}

export async function listDecisions(q: Queryable, filters: { model: AiModelKey | null; outcome: AiOutcome | null }, page: number, pageSize: number): Promise<Page<AiDecision>> {
  const where = '($1::text IS NULL OR d.model = $1) AND ($2::text IS NULL OR d.outcome = $2)'
  const params = [filters.model, filters.outcome]
  const [{ total }] = await q.query<{ total: number }>(`SELECT count(*)::int AS total FROM ai_decisions d WHERE ${where}`, params)
  const rows = await q.query<DecisionRow>(
    `SELECT d.*, t.reference FROM ai_decisions d LEFT JOIN transactions t ON t.id = d.transaction_id WHERE ${where}
     ORDER BY d.created_at DESC LIMIT $3 OFFSET $4`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const groups = await q.query<{ model: string; outcome: string; n: number }>('SELECT model, outcome, count(*)::int AS n FROM ai_decisions GROUP BY model, outcome')
  const users = await getUsers(q, rows.flatMap((r) => (r.user_id ? [r.user_id] : [])))
  return {
    items: rows.map((r) => {
      const u = r.user_id ? users.get(r.user_id) : undefined
      return {
        id: r.id, model: r.model, version: r.version, shadow: r.shadow, user: u ? toPublicUser(u) : null, score: r.score, outcome: r.outcome,
        reasons: r.reasons, summary: r.summary, amount: r.amount_cents == null ? null : fromCents(Number(r.amount_cents)), kind: r.kind,
        transactionRef: r.reference, review: r.review, createdAt: iso(r.created_at),
      }
    }),
    total, page, pageSize, counts: facetCounts(groups, filters),
  }
}
