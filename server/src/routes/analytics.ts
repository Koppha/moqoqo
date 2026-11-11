import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Analytics, NotifyChannel, Role, RiskRule, Transaction } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, parse, zId, zPage } from '../http'
import { fromCents } from '../lib/money'
import { getRules, listAlerts, review, setRules } from '../services/risk'
import { audit } from './admin'

export async function analyticsRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/analytics', auth, async (req): Promise<Analytics> => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query)
    const since = new Date(Date.now() - days * 86_400_000)
    const q = ctx.db
    const roles = await q.query<{ role: Role; n: number }>(`SELECT role, count(*)::int AS n FROM users WHERE kind = 'person' GROUP BY role`)
    const [u] = await q.query<{ total: number; tier1: number; tier2: number; usernames: number; emails: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE kyc_tier = 1)::int AS tier1, count(*) FILTER (WHERE kyc_tier = 2)::int AS tier2,
              count(username)::int AS usernames, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS emails
       FROM users WHERE kind = 'person'`,
    )
    // Every day in the period, even quiet ones.
    const perDay = await q.query<{ day: string; active: number; new_users: number; transactions: number; volume: string }>(
      `WITH days AS (SELECT generate_series(($1::timestamptz + interval '2 hours')::date, (now() + interval '2 hours')::date, interval '1 day')::date AS day)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
         (SELECT count(DISTINCT user_id)::int FROM user_activity a WHERE a.day = d.day) AS active,
         (SELECT count(*)::int FROM users x WHERE x.kind = 'person' AND (x.created_at + interval '2 hours')::date = d.day) AS new_users,
         (SELECT count(*)::int FROM transactions t WHERE (t.created_at + interval '2 hours')::date = d.day AND t.kind NOT IN ('fee', 'register')) AS transactions,
         (SELECT COALESCE(sum(amount_cents), 0) FROM transactions t WHERE (t.created_at + interval '2 hours')::date = d.day AND t.kind NOT IN ('fee', 'register')) AS volume
       FROM days d ORDER BY d.day`,
      [since],
    )
    const byKind = await q.query<{ kind: Transaction['kind']; n: number; v: string }>(
      `SELECT kind, count(*)::int AS n, sum(amount_cents) AS v FROM transactions WHERE created_at >= $1 GROUP BY kind ORDER BY sum(amount_cents) DESC`,
      [since],
    )
    const services = await q.query<{ name: string; n: number; v: string | null }>(
      `SELECT COALESCE(s.name->>'en', ss.service_id) AS name, count(*)::int AS n, sum(ss.amount_cents) AS v
       FROM service_submissions ss LEFT JOIN services s ON s.id = ss.service_id WHERE ss.created_at >= $1 GROUP BY 1 ORDER BY 2 DESC`,
      [since],
    )
    const [signUps] = await q.query<{ started: number; completed: number; failed: number }>(
      `SELECT count(*)::int AS started, count(*) FILTER (WHERE step = 'done')::int AS completed, count(*) FILTER (WHERE step = 'failed')::int AS failed
       FROM onboarding WHERE created_at >= $1`,
      [since],
    )
    const [kyc] = await q.query<{ pending: number; approved: number; rejected: number }>(
      `SELECT count(*) FILTER (WHERE r.status = 'pending')::int AS pending, count(*) FILTER (WHERE r.status = 'approved')::int AS approved,
              count(*) FILTER (WHERE r.status = 'rejected')::int AS rejected
       FROM service_requests r JOIN services s ON s.id = r.service_id WHERE s.code = 'KYC' AND r.created_at >= $1`,
      [since],
    )
    const notes = await q.query<{ channel: NotifyChannel; status: string; n: number }>(
      'SELECT channel, status, count(*)::int AS n FROM notifications WHERE created_at >= $1 GROUP BY channel, status',
      [since],
    )
    const [atm] = await q.query<{ n: number; v: string | null }>(`SELECT count(*)::int AS n, sum(amount_cents) AS v FROM atm_withdrawals WHERE status = 'redeemed' AND created_at >= $1`, [since])
    const [risk] = await q.query<{ open: number; blocked: number; flagged: number }>(
      `SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE action = 'blocked' AND created_at >= $1)::int AS blocked,
              count(*) FILTER (WHERE action = 'flagged' AND created_at >= $1)::int AS flagged FROM risk_alerts`,
      [since],
    )
    return {
      days,
      users: {
        total: u.total, byRole: { customer: 0, agent: 0, merchant: 0, ...Object.fromEntries(roles.map((r) => [r.role, r.n])) },
        byTier: { tier1: u.tier1, tier2: u.tier2 }, usernames: u.usernames, emails: u.emails,
      },
      perDay: perDay.map((d) => ({ day: d.day, activeUsers: d.active, newUsers: d.new_users, transactions: d.transactions, volume: fromCents(Number(d.volume)) })),
      byKind: byKind.map((k) => ({ kind: k.kind, count: k.n, volume: fromCents(Number(k.v ?? 0)) })),
      services: services.map((s) => ({ name: s.name, count: s.n, volume: fromCents(Number(s.v ?? 0)) })),
      signUps,
      kyc,
      notifications: (['push', 'sms', 'email'] as NotifyChannel[]).map((channel) => ({
        channel,
        sent: notes.find((n) => n.channel === channel && n.status === 'sent')?.n ?? 0,
        mock: notes.find((n) => n.channel === channel && n.status === 'mock')?.n ?? 0,
        failed: notes.find((n) => n.channel === channel && n.status === 'failed')?.n ?? 0,
      })),
      atm: { count: atm.n, volume: fromCents(Number(atm.v ?? 0)) },
      risk,
    }
  })

  // ---------- risk ----------
  app.get('/admin/v1/risk/alerts', auth, async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['open', 'fraud', 'ok', '']).optional(),
        severity: z.enum(['high', 'medium', 'low', '']).optional(),
        action: z.enum(['blocked', 'flagged', '']).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    )
    return listAlerts(ctx.db, { status: q.status || null, severity: q.severity || null, action: q.action || null }, q.page, q.pageSize)
  })
  app.post('/admin/v1/risk/alerts/:id/review', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ status: z.enum(['fraud', 'ok']), suspend: z.boolean().optional() }), req.body)
    const a = await review(ctx, id, req.admin.email, body)
    await audit(ctx.db, req.admin, `risk.${body.status}`, `user:${a.user.id}`, `${a.rule}${body.suspend ? ' · suspended' : ''}`)
    return a
  })
  app.get('/admin/v1/risk/rules', auth, async () => getRules(ctx.db))
  app.put('/admin/v1/risk/rules', auth, async (req) => {
    const body = parse(
      z.array(z.object({
        key: z.enum(['velocity', 'new_device_cashout', 'many_senders', 'unusual_amount', 'night_cashout']),
        enabled: z.boolean(),
        action: z.enum(['flag', 'block']),
        params: z.record(z.string(), z.number().min(0).max(1_000_000)),
      })).max(10),
      req.body,
    ) as RiskRule[]
    const saved = await setRules(ctx.db, body)
    await audit(ctx.db, req.admin, 'risk.rules', 'risk', saved.map((r) => `${r.key}:${r.enabled ? r.action : 'off'}`).join(', '))
    return saved
  })
}
