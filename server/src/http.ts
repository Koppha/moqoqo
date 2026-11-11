import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppKind, AdminRole } from '../../shared/api'
import type { Ctx } from './context'
import { AppError, forbidden } from './errors'
import { hashToken } from './lib/crypto'
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
export async function userForToken(ctx: Ctx, token: string | null): Promise<{ user: UserRow; tokenHash: string; boundDeviceId: string | null; app: AppKind }> {
  if (!token) throw new AppError('UNAUTHORIZED', 'Sign in required')
  const tokenHash = hashToken(token)
  const [row] = await ctx.db.query<UserRow & { session_device: string | null; session_app: AppKind }>(
    'SELECT u.*, s.bound_device_id AS session_device, s.app AS session_app FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
    [tokenHash],
  )
  const user = row
  if (!user) throw new AppError('UNAUTHORIZED', 'Your session has ended. Please sign in again')
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
  return { user, tokenHash, boundDeviceId: row.session_device, app: row.session_app }
}

export const authUser = (ctx: Ctx) => async (req: FastifyRequest) => {
  const { user, tokenHash, boundDeviceId, app } = await userForToken(ctx, bearer(req))
  req.user = user
  req.tokenHash = tokenHash
  req.boundDeviceId = boundDeviceId
  req.sessionApp = app
}

export const requireRole = (...roles: UserRow['role'][]) => async (req: FastifyRequest) => {
  if (!roles.includes(req.user.role)) throw forbidden(`Only ${roles.join(' and ')}s can do this`)
}

export const authAdmin = (ctx: Ctx) => async (req: FastifyRequest) => {
  const token = bearer(req)
  if (!token) throw new AppError('UNAUTHORIZED', 'Sign in required')
  const tokenHash = hashToken(token)
  const [admin] = await ctx.db.query<AdminRow>(
    'SELECT a.* FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = $1',
    [tokenHash],
  )
  if (!admin) throw new AppError('UNAUTHORIZED', 'Your session has ended. Please sign in again')
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
