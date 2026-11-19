// Server hardening (CBL/LCA DFS guidelines 3.2.2d, 3.2.4): security headers on every response, and a per-connection
// limit on sign-in, PIN, sign-up and webhook attempts. One process keeps the counts in memory; behind several servers
// or a proxy, move this to the gateway (and set Fastify's trustProxy so req.ip is the phone's address).
import type { FastifyInstance } from 'fastify'
import { NETWORK_NEW_HEADER } from '../../../shared/api'
import { AppError } from '../errors'

const SENSITIVE = [
  /^\/v1\/auth\/(login|verify-pin|unlock|report-lost|change-pin|change-app-pin)$/,
  /^\/v1\/onboarding\//,
  /^\/v1\/ecosure\/profile/,
  /^\/v1\/me\/pay-biometric$/,
  /^\/admin\/v1\/login$/,
  /^\/v1\/hooks\//,
]
const WINDOW_MS = 60_000

export function protect(app: FastifyInstance, opts: { rateLimit: boolean; requireTls?: boolean; perMinute?: number; onLimited?: (ip: string, url: string) => void }) {
  const limit = opts.perMinute ?? 20
  const hits = new Map<string, number[]>()

  // Only https in production (REQUIRE_TLS=true): direct TLS, or the proxy's X-Forwarded-Proto (trustProxy).
  app.addHook('onRequest', async (req) => {
    if (opts.requireTls && req.protocol !== 'https') throw new AppError('FORBIDDEN', 'Use a secure (https) connection')
  })

  app.addHook('onRequest', async (req) => {
    if (!opts.rateLimit || req.method !== 'POST') return
    const url = req.url.split('?')[0]
    if (!SENSITIVE.some((r) => r.test(url))) return
    // One bucket per address and kind of request (all sign-up steps share one).
    const key = `${req.ip}|${url.split('/').slice(0, 4).join('/')}`
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
    if (recent.length >= limit) {
      hits.set(key, recent)
      opts.onLimited?.(req.ip, url)
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a minute and try again')
    }
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 50_000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k)
  })

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if ((req as { networkNew?: boolean }).networkNew) reply.header(NETWORK_NEW_HEADER, '1')
    const rotated = (req as { rotatedToken?: string }).rotatedToken
    if (rotated && reply.statusCode < 400) reply.header('x-session-token', rotated)
    if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    const type = String(reply.getHeader('content-type') ?? '')
    if (type.startsWith('application/json')) {
      // API answers hold personal and money data: never cached, never framed or run as a page.
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      if (!reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store')
    }
    return payload
  })
}
