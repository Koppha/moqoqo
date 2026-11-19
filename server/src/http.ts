import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppKind, AdminRole } from '../../shared/api'
import type { Ctx } from './context'
import { AppError, forbidden } from './errors'
import { hashToken, newToken } from './lib/crypto'
import { logAuthEvent } from './services/authLog'
import { assessAndLearn, contextFromHeaders, rememberRisk, type ContextRisk } from './services/deviceContext'
import { deviceSecurity } from './services/maintenance'
import type { UserRow } from './services/users'

export interface AdminRow {
  id: string
  email: string
  name: string
  role: AdminRole
  password_hash: string
  password_salt: string
  created_at: Date
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow
    admin: AdminRow
    tokenHash: string
    /** The bound phone this session belongs to (null for sessions from before device binding). */
    boundDeviceId: string | null
    /** Which app the session is for: unlocking the EcoSure app checks the EcoSure PIN, the others the EcoCash PIN. */
    sessionApp: AppKind
  }
}

/** Validates input with zod; failures become 400 VALIDATION with a readable message. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {})
  if (r.success) return r.data
  const msg = r.error.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
  throw new AppError('VALIDATION', msg)
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

/** Resolves a wallet session token to its user. Throws UNAUTHORIZED / SUSPENDED. */
export async function userForToken(ctx: Ctx, token: string | null, from?: { headers: Record<string, unknown>; ip: string }): Promise<{ user: UserRow; tokenHash: string; boundDeviceId: string | null; app: AppKind; networkNew?: boolean; rotatedToken?: string }> {
  if (!token) throw new AppError('UNAUTHORIZED', 'Sign in required')
  const tokenHash = hashToken(token)
  const [row] = await ctx.db.query<UserRow & { session_device: string | null; session_app: AppKind; idle_min: number; age_days: number; rotated_hours: number; retiring: boolean; retired: boolean }>(
    `SELECT u.*, s.bound_device_id AS session_device, s.app AS session_app,
       extract(epoch FROM now() - s.last_used_at) / 60 AS idle_min, extract(epoch FROM now() - s.created_at) / 86400 AS age_days,
       extract(epoch FROM now() - s.rotated_at) / 3600 AS rotated_hours, (s.retire_at IS NOT NULL) AS retiring, (s.retire_at < now()) AS retired
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [tokenHash],
  )
  const user = row
  if (!user) throw new AppError('UNAUTHORIZED', 'Your session has ended. Please sign in again')
  // Sign out after the portal's minutes without use, and after its days in any case (DFS guidelines 3.2.8a).
  const policy = await deviceSecurity(ctx.db)
  const idle = Number(row.idle_min) > policy.idleMinutes
  if (row.retired || idle || Number(row.age_days) > policy.sessionDays) {
    await ctx.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
    await logAuthEvent(ctx.db, { userId: user.id, kind: idle ? 'idle_signout' : 'expired_signout', app: row.session_app })
    throw new AppError('UNAUTHORIZED', idle ? `You were signed out after ${policy.idleMinutes} minutes without use. Please sign in again` : 'Your session has ended. Please sign in again')
  }
  await ctx.db.query(`UPDATE sessions SET last_used_at = now() WHERE token_hash = $1 AND last_used_at < now() - interval '15 seconds'`, [tokenHash])
  // The bound phone's context against what it usually looks like (DFS guidelines 3.2.3a/b): scored, learned, flagged.
  const context = from && row.session_device ? contextFromHeaders(from.headers) : null
  let networkNew = false
  if (context && row.session_device) {
    const risk = await assessAndLearn(ctx.db, row.session_device, context, from!.ip)
    networkNew = !!risk.newNetwork
    rememberRisk(user.id, risk)
    if (risk.points >= UNUSUAL_CONTEXT_POINTS) await flagUnusualContext(ctx, user.id, risk, row.session_app, from!.ip)
  }
  if (user.status === 'suspended') throw new AppError('SUSPENDED', 'This account is suspended. Please contact EcoCash')
  // Daily active users (analytics): one row per person, app and Maseru day.
  await ctx.db.query(
    `INSERT INTO user_activity (day, user_id, app) SELECT (now() + interval '2 hours')::date, $1, s.app FROM sessions s WHERE s.token_hash = $2 ON CONFLICT DO NOTHING`,
    [user.id, tokenHash],
  )
  // Cheap activity tracking, at most once a minute per user.
  await ctx.db.query(
    `UPDATE users SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
    [user.id],
  )
  if (row.session_device) {
    await ctx.db.query(
      `UPDATE bound_devices SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
      [row.session_device],
    )
  }
  // Rotate the session token every day of use (DFS guidelines 3.2.6h): the response carries the new one; the old one
  // works 5 more minutes so requests already in flight don't fail. Only for app requests (not the live socket).
  let rotatedToken: string | undefined
  if (from && !row.retiring && Number(row.rotated_hours) >= SESSION_ROTATE_HOURS) {
    rotatedToken = newToken()
    await ctx.db.query(
      `INSERT INTO sessions (token_hash, user_id, app, created_at, last_used_at, bound_device_id, opened_by, rotated_at)
       SELECT $2, user_id, app, created_at, now(), bound_device_id, opened_by, now() FROM sessions WHERE token_hash = $1`,
      [tokenHash, hashToken(rotatedToken)],
    )
    await ctx.db.query(`UPDATE sessions SET retire_at = now() + interval '5 minutes' WHERE token_hash = $1`, [tokenHash])
  }
  return { user, tokenHash, boundDeviceId: row.session_device, app: row.session_app, networkNew, rotatedToken }
}

export const authUser = (ctx: Ctx) => async (req: FastifyRequest) => {
  const { user, tokenHash, boundDeviceId, app, networkNew, rotatedToken } = await userForToken(ctx, bearer(req), { headers: req.headers, ip: req.ip })
  if (rotatedToken) (req as FastifyRequest & { rotatedToken?: string }).rotatedToken = rotatedToken
  // The app asks the person before continuing on a network this phone hasn't used (DFS guidelines 3.2.4i).
  if (networkNew) (req as FastifyRequest & { networkNew?: boolean }).networkNew = true
  req.user = user
  req.tokenHash = tokenHash
  req.boundDeviceId = boundDeviceId
  req.sessionApp = app
}

export const requireRole = (...roles: UserRow['role'][]) => async (req: FastifyRequest) => {
  if (!roles.includes(req.user.role)) throw forbidden(`Only ${roles.join(' and ')}s can do this`)
}

/** Session tokens are replaced after this many hours of use. */
export const SESSION_ROTATE_HOURS = 24

/** A request scoring this much against the bound phone's usual context is logged and the owner is alerted. */
export const UNUSUAL_CONTEXT_POINTS = 25

/** At most once an hour per wallet: the sign-in log, and a security alert to the owner. */
export async function flagUnusualContext(ctx: Ctx, userId: string, risk: ContextRisk, app: string | null, ip: string) {
  const [recent] = await ctx.db.query(`SELECT 1 FROM auth_events WHERE user_id = $1 AND kind = 'unusual_context' AND created_at > now() - interval '1 hour'`, [userId])
  if (recent) return
  await logAuthEvent(ctx.db, { userId, kind: 'unusual_context', app, ip, detail: risk.reasons.join('; ') })
  void ctx.notifier.send({
    userIds: [userId],
    category: 'security',
    title: 'Unusual phone or place',
    body: "Your EcoCash wallet was used from a phone or place that doesn't look like yours. If this wasn't you, report your phone lost on the sign-in screen or call EcoCash customer care now.",
  })
}

/** Staff sign-ins end after this many hours even when in use. */
export const ADMIN_SESSION_HOURS = 12

export const authAdmin = (ctx: Ctx) => async (req: FastifyRequest) => {
  const token = bearer(req)
  if (!token) throw new AppError('UNAUTHORIZED', 'Sign in required')
  const tokenHash = hashToken(token)
  const [admin] = await ctx.db.query<AdminRow & { idle_min: number; age_hours: number }>(
    `SELECT a.*, extract(epoch FROM now() - s.last_used_at) / 60 AS idle_min, extract(epoch FROM now() - s.created_at) / 3600 AS age_hours
     FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = $1`,
    [tokenHash],
  )
  if (!admin) throw new AppError('UNAUTHORIZED', 'Your session has ended. Please sign in again')
  // Staff: the same minutes without use, and at most one working day (12 hours) per sign-in.
  const policy = await deviceSecurity(ctx.db)
  if (Number(admin.idle_min) > policy.idleMinutes || Number(admin.age_hours) > ADMIN_SESSION_HOURS) {
    await ctx.db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash])
    throw new AppError('UNAUTHORIZED', 'You were signed out after a while without use. Please sign in again')
  }
  await ctx.db.query(`UPDATE admin_sessions SET last_used_at = now() WHERE token_hash = $1 AND last_used_at < now() - interval '15 seconds'`, [tokenHash])
  req.admin = admin
  req.tokenHash = tokenHash
  // Support staff are read-only: every non-GET admin route is a write.
  if (admin.role !== 'admin' && req.method !== 'GET' && !req.url.startsWith('/admin/v1/logout')) {
    throw forbidden('Support accounts are read-only')
  }
}

export const noContent = (reply: FastifyReply) => reply.code(204).send()

// Shared zod pieces.
export const zAmount = z.number({ error: 'must be a number' })
export const zPin = z.string({ error: 'must be a string of 4 digits' })
export const zId = z.string().min(1).max(100)
export const zClientId = z.string().min(1).max(100)
export const zPage = z.coerce.number().int().min(1).default(1)

/**
 * Counts for a list's filter chips from rows grouped by every filter field: each field's values ("role:agent") and
 * "role:all", counted with the other fields' filters applied but not its own.
 */
export function facetCounts<K extends string>(rows: readonly ({ n: number } & Record<NoInfer<K>, string>)[], filters: Record<K, string | null>): Record<string, number> {
  const fields = Object.keys(filters) as K[]
  const counts: Record<string, number> = {}
  for (const field of fields) {
    counts[`${field}:all`] = 0
    for (const r of rows) {
      if (fields.some((f) => f !== field && filters[f] !== null && r[f] !== filters[f])) continue
      counts[`${field}:${r[field]}`] = (counts[`${field}:${r[field]}`] ?? 0) + r.n
      counts[`${field}:all`] += r.n
    }
  }
  return counts
}
