import type { FastifyBaseLogger } from 'fastify'
import type { Db } from '../db/index'

/** Upper bounds of the latency buckets, in ms. One more bucket counts anything slower. */
export const LATENCY_BOUNDS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

/** "/v1/ecosure/policies/:id" → "ecosure", "/admin/v1/users" → "portal". Null for routes not worth measuring. */
export function areaOf(route: string): string | null {
  if (route.startsWith('/admin/v1/')) return 'portal'
  const m = /^\/v1\/([^/]+)/.exec(route)
  if (!m || m[1] === 'ws') return null
  return m[1]
}

/** The ms below which `pct` of the requests in the buckets finished, interpolated within the bucket. */
export function percentile(buckets: number[], pct: number): number | null {
  const total = buckets.reduce((s, n) => s + n, 0)
  if (!total) return null
  const target = total * pct
  let seen = 0
  for (let i = 0; i < buckets.length; i++) {
    if (!buckets[i]) continue
    if (seen + buckets[i] >= target) {
      const lo = i === 0 ? 0 : LATENCY_BOUNDS_MS[i - 1]
      const hi = LATENCY_BOUNDS_MS[i] ?? lo * 2
      return Math.round(lo + ((target - seen) / buckets[i]) * (hi - lo))
    }
    seen += buckets[i]
  }
  return null
}

interface Tally {
  hour: Date
  area: string
  requests: number
  clientErrors: number
  serverErrors: number
  totalMs: number
  buckets: number[]
}

/** Counts every API response in memory and adds the counts to api_metrics about once a minute (and on close). */
export function createApiMetrics(db: Db, log: FastifyBaseLogger, everyMs = 60_000) {
  let pending = new Map<string, Tally>()
  let timer: NodeJS.Timeout | null = null

  async function flush() {
    if (!pending.size) return
    const batch = [...pending.values()]
    pending = new Map()
    for (const t of batch) {
      try {
        await db.query(
          `INSERT INTO api_metrics (hour, area, requests, client_errors, server_errors, total_ms, buckets) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (hour, area) DO UPDATE SET
             requests = api_metrics.requests + EXCLUDED.requests,
             client_errors = api_metrics.client_errors + EXCLUDED.client_errors,
             server_errors = api_metrics.server_errors + EXCLUDED.server_errors,
             total_ms = api_metrics.total_ms + EXCLUDED.total_ms,
             buckets = ARRAY(SELECT a + b FROM unnest(api_metrics.buckets, EXCLUDED.buckets) WITH ORDINALITY AS x(a, b, i) ORDER BY i)`,
          [t.hour, t.area, t.requests, t.clientErrors, t.serverErrors, t.totalMs, t.buckets],
        )
      } catch (err) {
        log.error({ err, area: t.area }, 'could not save API metrics')
      }
    }
  }

  return {
    record(route: string, status: number, ms: number) {
      const area = areaOf(route)
      if (!area) return
      const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
      const key = `${hour.getTime()}|${area}`
      let t = pending.get(key)
      if (!t) {
        t = { hour, area, requests: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, buckets: new Array(LATENCY_BOUNDS_MS.length + 1).fill(0) }
        pending.set(key, t)
      }
      t.requests++
      if (status >= 500) t.serverErrors++
      else if (status >= 400) t.clientErrors++
      t.totalMs += ms
      const i = LATENCY_BOUNDS_MS.findIndex((b) => ms <= b)
      t.buckets[i === -1 ? LATENCY_BOUNDS_MS.length : i]++
    },
    flush,
    start() {
      timer = setInterval(() => void flush(), everyMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
