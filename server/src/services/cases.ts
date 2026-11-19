// Financial crime case management: alerts about one wallet are gathered in one case that staff investigate, freeze,
// close as fraud or fine, and report to the FIU (suspicious transaction report). Portal: Cases.
import { RISK_ALERT_TITLE, type CaseEvent, type CaseEventKind, type CasePriority, type CaseStats, type CaseStatus, type CaseTransaction, type FraudCase, type FraudCaseDetail, type Page, type RiskAlertRule } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, notFound } from '../errors'
import { facetCounts } from '../http'
import { newId } from '../lib/crypto'
import { formatM, fromCents } from '../lib/money'
import { iso, isoOrNull } from '../lib/time'
import { getModel, logDecision, reviewDecisions } from './ai'
import { toAlerts, type AlertRow } from './risk'
import { getUser, getUsers, toPublicUser } from './users'

const RANK: Record<CasePriority, number> = { high: 0, medium: 1, low: 2 }
const CLOSED: CaseStatus[] = ['closed_fraud', 'closed_ok']
/** Low and medium alerts open a case on their own once a wallet has this many open alerts in 7 days. */
const ALERTS_FOR_CASE = 3

interface CaseRow {
  id: string; ref: string; user_id: string; status: CaseStatus; priority: CasePriority; title: string; assigned_to: string | null; frozen: boolean
  str_ref: string | null; str_filed_at: Date | null; created_at: Date; updated_at: Date; closed_at: Date | null
  alert_count: number; open_alerts: number; amount_cents: string | null
}

const CASE_SELECT = `SELECT c.*,
  (SELECT count(*) FROM risk_alerts a WHERE a.case_id = c.id)::int AS alert_count,
  (SELECT count(*) FROM risk_alerts a WHERE a.case_id = c.id AND a.status = 'open')::int AS open_alerts,
  (SELECT sum(amount_cents) FROM risk_alerts a WHERE a.case_id = c.id) AS amount_cents
  FROM fraud_cases c`

export async function addEvent(q: Queryable, caseId: string, actor: string, kind: CaseEventKind, text: string) {
  await q.query('INSERT INTO fraud_case_events (id, case_id, actor, kind, text) VALUES ($1, $2, $3, $4, $5)', [newId(), caseId, actor, kind, text])
  await q.query('UPDATE fraud_cases SET updated_at = now() WHERE id = $1', [caseId])
}

async function createCase(q: Queryable, userId: string, priority: CasePriority, title: string, actor: string, note: string): Promise<string> {
  const id = newId()
  const [{ n }] = await q.query<{ n: string }>(`SELECT nextval('fraud_case_seq') AS n`)
  await q.query('INSERT INTO fraud_cases (id, ref, user_id, priority, title) VALUES ($1, $2, $3, $4, $5)', [id, `CASE-${String(n).padStart(6, '0')}`, userId, priority, title])
  await addEvent(q, id, actor, 'created', note)
  return id
}

/**
 * A new alert: it joins the wallet's active case, or opens one when it is serious (`openCase`, high severity or a
 * block), or when the wallet has several open alerts. Otherwise it waits on its own for review.
 */
export async function attachAlert(q: Queryable, a: { id: string; userId: string; rule: RiskAlertRule; severity: CasePriority; openCase: boolean; detail: string }) {
  const [active] = await q.query<{ id: string; priority: CasePriority }>(
    `SELECT id, priority FROM fraud_cases WHERE user_id = $1 AND status <> ALL($2) ORDER BY created_at DESC LIMIT 1`,
    [a.userId, CLOSED],
  )
  let caseId = active?.id
  if (!caseId) {
    const [{ n }] = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_alerts WHERE user_id = $1 AND status = 'open' AND case_id IS NULL AND created_at > now() - interval '7 days'`,
      [a.userId],
    )
    if (!a.openCase && a.severity !== 'high' && n < ALERTS_FOR_CASE) return
    caseId = await createCase(q, a.userId, a.severity, RISK_ALERT_TITLE[a.rule], 'system', n > 1 ? `Opened automatically: ${n} open alerts on this wallet.` : 'Opened automatically by a serious alert.')
    // Earlier open alerts about the wallet join too.
    await q.query(`UPDATE risk_alerts SET case_id = $2 WHERE user_id = $1 AND status = 'open' AND case_id IS NULL`, [a.userId, caseId])
  } else {
    await q.query('UPDATE risk_alerts SET case_id = $2 WHERE id = $1', [a.id, caseId])
    if (RANK[a.severity] < RANK[active.priority]) await q.query('UPDATE fraud_cases SET priority = $2 WHERE id = $1', [caseId, a.severity])
  }
  await addEvent(q, caseId, 'system', 'alert', `${RISK_ALERT_TITLE[a.rule]}: ${a.detail}`)
}

async function toCases(q: Queryable, rows: CaseRow[]): Promise<FraudCase[]> {
  const users = await getUsers(q, rows.map((r) => r.user_id))
  return rows.map((r) => ({
    id: r.id, ref: r.ref, user: toPublicUser(users.get(r.user_id)!), status: r.status, priority: r.priority, title: r.title, assignedTo: r.assigned_to,
    alertCount: r.alert_count, openAlerts: r.open_alerts, amount: fromCents(Number(r.amount_cents ?? 0)), frozen: r.frozen, strRef: r.str_ref,
    strFiledAt: isoOrNull(r.str_filed_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), closedAt: isoOrNull(r.closed_at),
  }))
}

export interface CaseFilters { status: CaseStatus | 'active' | null; priority: CasePriority | null; assignedTo: string | null }

export async function listCases(q: Queryable, f: CaseFilters, page: number, pageSize: number): Promise<Page<FraudCase>> {
  const where = `($1::text IS NULL OR c.status = $1 OR ($1 = 'active' AND c.status <> ALL($4))) AND ($2::text IS NULL OR c.priority = $2) AND ($3::text IS NULL OR c.assigned_to = $3)`
  const params = [f.status, f.priority, f.assignedTo, CLOSED]
  const [{ total }] = await q.query<{ total: number }>(`SELECT count(*)::int AS total FROM fraud_cases c WHERE ${where}`, params)
  const rows = await q.query<CaseRow>(
    `${CASE_SELECT} WHERE ${where}
     ORDER BY (c.status = ANY($4)), CASE c.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, c.updated_at DESC LIMIT $5 OFFSET $6`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const groups = await q.query<{ status: string; priority: string; n: number }>(
    'SELECT status, priority, count(*)::int AS n FROM fraud_cases c WHERE ($1::text IS NULL OR c.assigned_to = $1) GROUP BY status, priority',
    [f.assignedTo],
  )
  // "active" is not a stored status: count it with the priority filter applied.
  const counts = facetCounts(groups, { status: f.status === 'active' ? null : f.status, priority: f.priority })
  counts['status:active'] = groups.filter((g) => !CLOSED.includes(g.status as CaseStatus) && (!f.priority || g.priority === f.priority)).reduce((s, g) => s + g.n, 0)
  return { items: await toCases(q, rows), total, page, pageSize, counts }
}

export async function caseStats(q: Queryable): Promise<CaseStats> {
  const [s] = await q.query<{ open: number; investigating: number; escalated: number; unassigned: number; closed: number; avg_days: string | null }>(
    `SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'investigating')::int AS investigating,
            count(*) FILTER (WHERE status = 'escalated')::int AS escalated,
            count(*) FILTER (WHERE assigned_to IS NULL AND status <> ALL($1))::int AS unassigned,
            count(*) FILTER (WHERE closed_at > now() - interval '30 days')::int AS closed,
            avg(extract(epoch FROM closed_at - created_at) / 86400) FILTER (WHERE closed_at > now() - interval '30 days') AS avg_days
     FROM fraud_cases`,
    [CLOSED],
  )
  return {
    open: s.open, investigating: s.investigating, escalated: s.escalated, unassigned: s.unassigned, closedLast30: s.closed,
    avgDaysToClose: s.avg_days == null ? null : Math.round(Number(s.avg_days) * 10) / 10,
  }
}

async function caseRow(q: Queryable, id: string): Promise<CaseRow> {
  const [r] = await q.query<CaseRow>(`${CASE_SELECT} WHERE c.id = $1`, [id])
  if (!r) throw notFound('Case not found')
  return r
}

export async function getCase(q: Queryable, id: string): Promise<FraudCaseDetail> {
  const r = await caseRow(q, id)
  const [base] = await toCases(q, [r])
  const alertRows = await q.query<AlertRow>(`SELECT * FROM risk_alerts WHERE case_id = $1 ORDER BY created_at DESC`, [id])
  const alerts = await toAlerts(q, alertRows)
  const flaggedTx = new Set(alertRows.map((a) => a.transaction_id).filter(Boolean))
  const events = await q.query<{ id: string; actor: string; kind: CaseEventKind; text: string; created_at: Date }>('SELECT * FROM fraud_case_events WHERE case_id = $1 ORDER BY seq', [id])
  const txs = await q.query<{ id: string; reference: string; kind: string; amount_cents: string; from_user_id: string | null; created_at: Date; other: string | null }>(
    `SELECT t.id, t.reference, t.kind, t.amount_cents, t.from_user_id, t.created_at, coalesce(o.business_name, o.name) AS other
     FROM transactions t LEFT JOIN users o ON o.id = CASE WHEN t.from_user_id = $1 THEN t.to_user_id ELSE t.from_user_id END
     WHERE (t.from_user_id = $1 OR t.to_user_id = $1) AND t.created_at > now() - interval '30 days' AND t.kind <> 'fee'
     ORDER BY t.created_at DESC LIMIT 200`,
    [r.user_id],
  )
  const u = (await getUser(q, r.user_id))!
  const [{ phones }] = await q.query<{ phones: number }>('SELECT count(*)::int AS phones FROM bound_devices WHERE user_id = $1', [r.user_id])
  const summary = [...events].reverse().find((e) => e.kind === 'summary')
  return {
    ...base,
    alerts,
    events: events.map((e): CaseEvent => ({ id: e.id, actor: e.actor, kind: e.kind, text: e.text, createdAt: iso(e.created_at) })),
    transactions: txs.map((t): CaseTransaction => ({
      reference: t.reference, kind: t.kind, direction: t.from_user_id === r.user_id ? 'out' : 'in', amount: fromCents(Number(t.amount_cents)),
      counterparty: t.other, createdAt: iso(t.created_at), flagged: flaggedTx.has(t.id),
    })),
    wallet: { status: u.status, balance: fromCents(u.balance_cents), kycTier: u.kyc_tier, createdAt: iso(u.created_at), phones },
    summary: summary ? { text: summary.text, createdAt: iso(summary.created_at), by: summary.actor } : null,
  }
}

export async function openCaseManually(q: Queryable, msisdn: string, title: string, note: string, by: string): Promise<string> {
  const [u] = await q.query<{ id: string }>(`SELECT id FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (!u) throw notFound('No wallet with that number')
  const [active] = await q.query<{ ref: string }>('SELECT ref FROM fraud_cases WHERE user_id = $1 AND status <> ALL($2)', [u.id, CLOSED])
  if (active) throw new AppError('CONFLICT', `This wallet already has an open case, ${active.ref}`)
  const id = await createCase(q, u.id, 'medium', title.trim(), by, note.trim() || 'Opened by staff.')
  await q.query(`UPDATE risk_alerts SET case_id = $2 WHERE user_id = $1 AND status = 'open' AND case_id IS NULL`, [u.id, id])
  return id
}

async function activeCase(q: Queryable, id: string): Promise<CaseRow> {
  const r = await caseRow(q, id)
  if (CLOSED.includes(r.status)) throw new AppError('CONFLICT', 'This case is closed')
  return r
}

export async function updateCase(q: Queryable, id: string, body: { status?: 'open' | 'investigating' | 'escalated'; assignedTo?: string | null; note?: string }, by: string) {
  const r = await activeCase(q, id)
  if (body.assignedTo !== undefined && body.assignedTo !== r.assigned_to) {
    if (body.assignedTo) {
      const [a] = await q.query('SELECT 1 FROM admins WHERE email = $1', [body.assignedTo])
      if (!a) throw new AppError('VALIDATION', 'No portal user with that email')
    }
    await q.query('UPDATE fraud_cases SET assigned_to = $2 WHERE id = $1', [id, body.assignedTo])
    await addEvent(q, id, by, 'assign', body.assignedTo ? `Assigned to ${body.assignedTo}` : 'Unassigned')
  }
  if (body.status && body.status !== r.status) {
    await q.query('UPDATE fraud_cases SET status = $2 WHERE id = $1', [id, body.status])
    await addEvent(q, id, by, 'status', `Status: ${body.status}`)
  }
  if (body.note?.trim()) await addEvent(q, id, by, 'note', body.note.trim())
}

export async function closeCase(q: Queryable, id: string, outcome: 'fraud' | 'ok', note: string, by: string) {
  await activeCase(q, id)
  await q.query(`UPDATE fraud_cases SET status = $2, closed_at = now(), closed_by = $3 WHERE id = $1`, [id, outcome === 'fraud' ? 'closed_fraud' : 'closed_ok', by])
  const reviewed = await q.query<{ decision_id: string | null }>(
    `UPDATE risk_alerts SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE case_id = $1 AND status = 'open' RETURNING decision_id`,
    [id, outcome, by],
  )
  await reviewDecisions(q, reviewed.map((r) => r.decision_id), outcome)
  await addEvent(q, id, by, 'closed', `Closed as ${outcome === 'fraud' ? 'fraud' : 'fine'}. ${note.trim()}`.trim())
}

/** Freezing suspends the wallet (signed out at once); unfreezing lets them back in. */
export async function freezeCase(ctx: Ctx, id: string, frozen: boolean, note: string, by: string) {
  const r = await caseRow(ctx.db, id)
  if (frozen && CLOSED.includes(r.status)) throw new AppError('CONFLICT', 'This case is closed')
  await ctx.db.tx(async (q) => {
    await q.query('UPDATE fraud_cases SET frozen = $2 WHERE id = $1', [id, frozen])
    await q.query('UPDATE users SET status = $2 WHERE id = $1', [r.user_id, frozen ? 'suspended' : 'active'])
    if (frozen) await q.query('DELETE FROM sessions WHERE user_id = $1', [r.user_id])
    await addEvent(q, id, by, frozen ? 'freeze' : 'unfreeze', `${frozen ? 'Wallet frozen' : 'Wallet unfrozen'}. ${note.trim()}`.trim())
  })
  if (frozen) ctx.hub.disconnectUser(r.user_id, 4403, 'SUSPENDED')
}

export async function fileStr(q: Queryable, id: string, reference: string, by: string) {
  await caseRow(q, id)
  await q.query('UPDATE fraud_cases SET str_ref = $2, str_filed_at = now() WHERE id = $1', [id, reference.trim()])
  await addEvent(q, id, by, 'str', `Suspicious transaction report filed with the FIU, reference ${reference.trim()}`)
}

const SUMMARY_PROMPT = `You help an investigator at EcoCash Lesotho (a mobile money service; currency maloti, written M50.00) with a financial crime case about one wallet. You get the case's alerts and the wallet's payments as JSON. People are pseudonymised: "the customer" and counterparties C1, C2, …

Write a short, neutral first summary for the investigator, in plain text with these three parts:
What happened: two to four sentences on the pattern of activity.
Red flags: up to five short lines starting with "- ", each pointing at specific payments or alerts.
Check next: up to four short lines starting with "- ", concrete things the investigator can verify.

Rules: describe, don't decide. Never say the customer is guilty, a fraudster or a money launderer, and never recommend an outcome; staff decide. If the activity looks ordinary, say so. Don't invent facts beyond the data. No markdown headings or tables.`

/** Asks Claude for a neutral first summary. Names, numbers and IDs never leave the server: counterparties become C1, C2, … */
export async function summariseCase(ctx: Ctx, id: string, by: string) {
  const model = await getModel(ctx.db, 'case_summary')
  if (model.mode === 'off') throw new AppError('FORBIDDEN', 'AI case summaries are switched off in AI governance')
  if (!ctx.llm) throw new AppError('FORBIDDEN', 'AI case summaries need the server\'s Claude key (ANTHROPIC_API_KEY)')
  const c = await getCase(ctx.db, id)
  const alias = new Map<string, string>()
  const who = (name: string | null) => {
    if (!name) return 'outside EcoCash'
    if (!alias.has(name)) alias.set(name, `C${alias.size + 1}`)
    return alias.get(name)!
  }
  const facts = {
    wallet: { ageDays: Math.round((Date.now() - Date.parse(c.wallet.createdAt)) / 86_400_000), kycTier: c.wallet.kycTier, balance: formatM(Math.round(c.wallet.balance * 100)), phonesEverUsed: c.wallet.phones },
    alerts: c.alerts.map((a) => ({ when: a.createdAt, what: RISK_ALERT_TITLE[a.rule], severity: a.severity, action: a.action, score: a.score, detail: a.detail })),
    payments: c.transactions.map((t) => ({ when: t.createdAt, kind: t.kind, direction: t.direction, amount: formatM(Math.round(t.amount * 100)), counterparty: who(t.counterparty), alerted: t.flagged })),
  }
  const res = await ctx.llm.create({
    model: ctx.config.assistantModel,
    max_tokens: 4000,
    system: [{ type: 'text', text: SUMMARY_PROMPT }],
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(facts) }] }],
    output_config: { effort: 'low' },
  })
  if (res.stop_reason === 'refusal') throw new AppError('CONFLICT', 'The AI declined to summarise this case')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text.trim()] : [])).filter(Boolean).join('\n\n')
  if (!text) throw new AppError('UNKNOWN', 'The AI returned no summary; try again')
  await ctx.db.tx(async (q) => {
    await addEvent(q, id, `AI summary for ${by}`, 'summary', text)
    await logDecision(q, { model: 'case_summary', version: model.version, shadow: false, userId: c.user.id, score: null, outcome: 'info', summary: text.slice(0, 280), caseId: id })
  })
}
