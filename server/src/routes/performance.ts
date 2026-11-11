import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PerfFlowKey, PerfPair, Performance, Transaction } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, parse } from '../http'
import { fromCents } from '../lib/money'
import { LATENCY_BOUNDS_MS, percentile } from '../services/metrics'

const pair = (current: number, previous: number): PerfPair => ({ current, previous })
const money = (cents: string | number | null) => fromCents(Number(cents ?? 0))
/** Every Maseru day from `from` to `to`, quiet ones included, oldest first. */
const maseruDays = (from: Date, to: number) => {
  const out: string[] = []
  for (let t = from.getTime(); ; t += 86_400_000) {
    const day = new Date(Math.min(t, to) + 2 * 3_600_000).toISOString().slice(0, 10)
    if (out.at(-1) !== day) out.push(day)
    if (t >= to) return out
  }
}
const average = (volume: number, count: number) => (count ? Math.round((volume / count) * 100) / 100 : 0)

export async function performanceRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/performance', auth, async (req): Promise<Performance> => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query)
    const now = Date.now()
    const since = new Date(now - days * 86_400_000)
    const before = new Date(now - 2 * days * 86_400_000)
    const q = ctx.db

    // ---------- the matrix: this period ($2 onwards) against the one before ($1 to $2) ----------
    const kinds = await q.query<{ kind: Transaction['kind']; n: number; v: string; pn: number; pv: string; users: number }>(
      `SELECT kind,
         count(*) FILTER (WHERE created_at >= $2)::int AS n, COALESCE(sum(amount_cents) FILTER (WHERE created_at >= $2), 0) AS v,
         count(*) FILTER (WHERE created_at < $2)::int AS pn, COALESCE(sum(amount_cents) FILTER (WHERE created_at < $2), 0) AS pv,
         count(DISTINCT from_user_id) FILTER (WHERE created_at >= $2)::int AS users
       FROM transactions WHERE created_at >= $1 GROUP BY kind`,
      [before, since],
    )
    const payments = kinds.filter((k) => k.kind !== 'fee' && k.kind !== 'register')
    const total = payments.reduce((s, k) => s + Number(k.v), 0)
    const products = payments
      .map((k) => {
        const volume = money(k.v)
        return {
          kind: k.kind,
          count: pair(k.n, k.pn),
          volume: pair(volume, money(k.pv)),
          average: average(volume, k.n),
          users: k.users,
          share: total ? Number(k.v) / total : 0,
        }
      })
      .filter((p) => p.count.current || p.count.previous)
      .sort((a, b) => b.volume.current - a.volume.current || b.volume.previous - a.volume.previous)

    // ---------- headline numbers ----------
    const sum = (pick: (k: (typeof kinds)[number]) => number, rows = payments) => rows.reduce((s, k) => s + pick(k), 0)
    const fee = kinds.filter((k) => k.kind === 'fee')
    const [people] = await q.query<{ paying: number; ppaying: number; active: number; pactive: number; joined: number; pjoined: number }>(
      `SELECT
         (SELECT count(DISTINCT from_user_id)::int FROM transactions WHERE created_at >= $2 AND kind NOT IN ('fee', 'register')) AS paying,
         (SELECT count(DISTINCT from_user_id)::int FROM transactions WHERE created_at >= $1 AND created_at < $2 AND kind NOT IN ('fee', 'register')) AS ppaying,
         (SELECT count(DISTINCT user_id)::int FROM user_activity WHERE day >= ($2::timestamptz + interval '2 hours')::date) AS active,
         (SELECT count(DISTINCT user_id)::int FROM user_activity WHERE day >= ($1::timestamptz + interval '2 hours')::date
            AND day < ($2::timestamptz + interval '2 hours')::date) AS pactive,
         (SELECT count(*)::int FROM users WHERE kind = 'person' AND created_at >= $2) AS joined,
         (SELECT count(*)::int FROM users WHERE kind = 'person' AND created_at >= $1 AND created_at < $2) AS pjoined`,
      [before, since],
    )
    const count = pair(sum((k) => k.n), sum((k) => k.pn))
    const volume = pair(money(sum((k) => Number(k.v))), money(sum((k) => Number(k.pv))))

    // ---------- flows: how often each one ends well ----------
    const [f] = await q.query<Record<string, number>>(
      `SELECT
         (SELECT count(*) FILTER (WHERE step = 'done') FROM onboarding WHERE created_at >= $1)::int AS signup_done,
         (SELECT count(*) FROM onboarding WHERE created_at >= $1)::int AS signup_total,
         (SELECT count(*) FILTER (WHERE status = 'redeemed') FROM atm_withdrawals WHERE created_at >= $1 AND status <> 'active')::int AS atm_done,
         (SELECT count(*) FROM atm_withdrawals WHERE created_at >= $1 AND status <> 'active')::int AS atm_total,
         (SELECT count(*) FILTER (WHERE status = 'paid') FROM payment_intents WHERE created_at >= $1 AND status <> 'open')::int AS merchant_done,
         (SELECT count(*) FROM payment_intents WHERE created_at >= $1 AND status <> 'open')::int AS merchant_total,
         (SELECT count(*) FILTER (WHERE status = 'paid') FROM requests WHERE updated_at >= $1 AND status <> 'pending')::int AS requests_done,
         (SELECT count(*) FROM requests WHERE updated_at >= $1 AND status <> 'pending')::int AS requests_total,
         (SELECT count(*) FILTER (WHERE r.status = 'approved') FROM service_requests r JOIN services s ON s.id = r.service_id
            WHERE s.code = 'KYC' AND r.created_at >= $1 AND r.status <> 'pending')::int AS kyc_done,
         (SELECT count(*) FROM service_requests r JOIN services s ON s.id = r.service_id
            WHERE s.code = 'KYC' AND r.created_at >= $1 AND r.status <> 'pending')::int AS kyc_total,
         (SELECT count(*) FILTER (WHERE status = 'approved') FROM ecosure_claims WHERE created_at >= $1 AND status IN ('approved', 'rejected'))::int AS claims_done,
         (SELECT count(*) FROM ecosure_claims WHERE created_at >= $1 AND status IN ('approved', 'rejected'))::int AS claims_total,
         (SELECT count(*) FILTER (WHERE status <> 'failed') FROM notifications WHERE created_at >= $1)::int AS notifications_done,
         (SELECT count(*) FROM notifications WHERE created_at >= $1)::int AS notifications_total,
         (SELECT count(*) FROM risk_alerts WHERE action = 'blocked' AND created_at >= $1)::int AS blocked`,
      [since],
    )
    const flowKeys: PerfFlowKey[] = ['signup', 'atm', 'merchant', 'requests', 'kyc', 'claims', 'notifications']
    const flows = flowKeys.map((key) => ({ key, done: f[`${key}_done`], total: f[`${key}_total`] }))
    flows.push({ key: 'risk', done: count.current, total: count.current + f.blocked })

    // ---------- API speed and errors ----------
    const rows = await q.query<{ day: string; area: string; requests: number; client_errors: number; server_errors: number; total_ms: number; buckets: number[] }>(
      `SELECT to_char((hour + interval '2 hours')::date, 'YYYY-MM-DD') AS day, area, requests, client_errors, server_errors, total_ms, buckets
       FROM api_metrics WHERE hour >= $1 ORDER BY hour`,
      [new Date(Math.floor(since.getTime() / 3_600_000) * 3_600_000)],
    )
    const empty = () => new Array<number>(LATENCY_BOUNDS_MS.length + 1).fill(0)
    const areas = new Map<string, { requests: number; clientErrors: number; serverErrors: number; totalMs: number; buckets: number[] }>()
    const perDay = new Map<string, { requests: number; serverErrors: number }>()
    const all = empty()
    for (const r of rows) {
      const a = areas.get(r.area) ?? { requests: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, buckets: empty() }
      a.requests += r.requests
      a.clientErrors += r.client_errors
      a.serverErrors += r.server_errors
      a.totalMs += Number(r.total_ms)
      r.buckets.forEach((n, i) => {
        a.buckets[i] += n
        all[i] += n
      })
      areas.set(r.area, a)
      const d = perDay.get(r.day) ?? { requests: 0, serverErrors: 0 }
      d.requests += r.requests
      d.serverErrors += r.server_errors
      perDay.set(r.day, d)
    }
    const areaList = [...areas].map(([area, a]) => ({
      area,
      requests: a.requests,
      clientErrors: a.clientErrors,
      serverErrors: a.serverErrors,
      avgMs: a.requests ? Math.round(a.totalMs / a.requests) : 0,
      p95Ms: percentile(a.buckets, 0.95),
    }))

    return {
      days,
      kpis: {
        payments: count,
        volume,
        averagePayment: pair(average(volume.current, count.current), average(volume.previous, count.previous)),
        fees: pair(money(sum((k) => Number(k.v), fee)), money(sum((k) => Number(k.pv), fee))),
        payingUsers: pair(people.paying, people.ppaying),
        activeUsers: pair(people.active, people.pactive),
        newWallets: pair(people.joined, people.pjoined),
      },
      products,
      flows,
      api: {
        requests: areaList.reduce((s, a) => s + a.requests, 0),
        clientErrors: areaList.reduce((s, a) => s + a.clientErrors, 0),
        serverErrors: areaList.reduce((s, a) => s + a.serverErrors, 0),
        p50Ms: percentile(all, 0.5),
        p95Ms: percentile(all, 0.95),
        perDay: maseruDays(since, now).map((day) => ({ day, requests: 0, serverErrors: 0, ...perDay.get(day) })),
        areas: areaList.sort((a, b) => b.requests - a.requests),
      },
    }
  })
}
