import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  DEFAULT_DEVICE_SECURITY,
  SECURITY_LIMITS,
  type Admin,
  type AdminLoginResponse,
  type AdminStats,
  type AdminTransaction,
  type AdminUser,
  type AppConfig,
  type AuditEntry,
  type MaintenanceWindow,
  type Page,
  type Role,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { TransactionRow } from '../ecocash/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { authAdmin, facetCounts, noContent, parse, zAmount, zId, zPage, zPin, type AdminRow } from '../http'
import { hashSecret, hashToken, newId, newToken, verifySecret } from '../lib/crypto'
import { fromCents, toCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso, startOfMaseruDay } from '../lib/time'
import { logAuthEvent } from '../services/authLog'
import { appConfig, currentMaintenance, deviceSecurity, setSetting, toWindow, windowStatus, type WindowRow } from '../services/maintenance'
import { checkStrongPin, parsePin } from '../services/pins'
import { toAdminTransactions } from '../services/transactions'
import { toAdminUser, type UserRow } from '../services/users'
import { WS_CLOSE } from './ws'

const PAGE_SIZE = 25
const MAX_FLOAT_CENTS = 1_000_000 * 100

const toAdmin = (a: AdminRow): Admin => ({ id: a.id, email: a.email, name: a.name, role: a.role })

export async function audit(q: Queryable, admin: AdminRow, action: string, target: string, detail = '') {
  await q.query('INSERT INTO audit_log (id, admin_id, admin_email, action, target, detail) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId(),
    admin.id,
    admin.email,
    action,
    target,
    detail,
  ])
}

async function requireUserRow(q: Queryable, id: string): Promise<UserRow> {
  const [u] = await q.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND kind = 'person'`, [id])
  if (!u) throw notFound('User not found')
  return u
}

async function nextCode(q: Queryable, prefix: string): Promise<string> {
  const rows = await q.query<{ code: string }>('SELECT code FROM users WHERE code LIKE $1', [`${prefix}-%`])
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(prefix.length + 1)) || 0), 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

/** Merchant codes are plain numbers (1001, 1002, …): the next one after the highest in use. */
async function nextMerchantCode(q: Queryable): Promise<string> {
  const [{ max }] = await q.query<{ max: string | null }>(`SELECT max(code::bigint)::text AS max FROM users WHERE role = 'merchant' AND code ~ '^[0-9]+$'`)
  return String(Math.max(Number(max ?? 0), 1000) + 1)
}

const zLocalized = z.object({ en: z.string().trim().min(1).max(500), st: z.string().trim().min(1).max(500) })
/** A business owner's national ID, stored as sign-up stores ID numbers (no spaces or dashes, upper case); empty clears it. */
const zOwnerId = z.string().max(30).transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .refine((v) => v === '' || /^[0-9A-Z]{6,20}$/.test(v), 'must be the ID number as it is on the ID (6 to 20 letters and digits)').optional()
const zSemver = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a version like 1.2.0').nullable()
const zDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date')

/** A PIN staff set for a customer: 4 digits and not easy to guess (DFS guidelines 3.2.5b-ii). */
const strongPin = (pin: unknown) => {
  const p = parsePin(pin)
  checkStrongPin(p)
  return p
}

export async function adminRoutes(app: FastifyInstance, ctx: Ctx, onConfigChange: () => Promise<void>) {
  const auth = { preHandler: authAdmin(ctx) }

  app.post('/admin/v1/login', async (req): Promise<AdminLoginResponse> => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }), req.body)
    const [admin] = await ctx.db.query<AdminRow & { failed_logins: number; locked: boolean }>(
      `SELECT *, (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM admins WHERE lower(email) = $1`,
      [body.email],
    )
    // Locked after the portal's wrong-attempt limit, for its lock time (DFS guidelines 3.2.5b-v); every try is logged.
    if (admin?.locked) {
      await logAuthEvent(ctx.db, { adminId: admin.id, kind: 'login_failed', ip: req.ip, detail: 'locked' })
      throw new AppError('PIN_LOCKED', 'Too many wrong passwords. This account is locked for a while; ask another admin or try later')
    }
    if (!admin || !(await verifySecret(body.password, admin.password_hash, admin.password_salt))) {
      if (admin) {
        const policy = await deviceSecurity(ctx.db)
        const [after] = await ctx.db.query<{ locked_until: Date | null }>(
          `UPDATE admins SET
             failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
             locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
           WHERE id = $1 RETURNING locked_until`,
          [admin.id, policy.maxPinAttempts, policy.pinLockMinutes],
        )
        await logAuthEvent(ctx.db, { adminId: admin.id, kind: after?.locked_until ? 'pin_locked' : 'login_failed', ip: req.ip, detail: 'wrong password' })
      }
      throw new AppError('UNAUTHORIZED', 'Wrong email or password')
    }
    if (admin.failed_logins > 0) await ctx.db.query('UPDATE admins SET failed_logins = 0, locked_until = NULL WHERE id = $1', [admin.id])
    await logAuthEvent(ctx.db, { adminId: admin.id, kind: 'login', ip: req.ip })
    const token = newToken()
    await ctx.db.query('INSERT INTO admin_sessions (token_hash, admin_id) VALUES ($1, $2)', [hashToken(token), admin.id])
    req.log.info({ adminId: admin.id }, 'admin login')
    return { token, admin: toAdmin(admin) }
  })

  app.post('/admin/v1/logout', auth, async (req, reply) => {
    await ctx.db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [req.tokenHash])
    return noContent(reply)
  })

  app.get('/admin/v1/me', auth, async (req): Promise<Admin> => toAdmin(req.admin))

  app.get('/admin/v1/stats', auth, async (): Promise<AdminStats> => {
    const since = startOfMaseruDay()
    const roles = await ctx.db.query<{ role: Role; n: number }>(`SELECT role, count(*) AS n FROM users WHERE kind = 'person' GROUP BY role`)
    const [s] = await ctx.db.query<{ suspended: number; tx: number; volume: number; messages: number; new_users: number }>(
      `SELECT
         (SELECT count(*) FROM users WHERE kind = 'person' AND status = 'suspended') AS suspended,
         (SELECT count(*) FROM transactions WHERE created_at >= $1 AND amount_cents > 0) AS tx,
         (SELECT COALESCE(sum(amount_cents), 0) FROM transactions WHERE created_at >= $1) AS volume,
         (SELECT count(*) FROM messages WHERE created_at >= $1) AS messages,
         (SELECT count(*) FROM users WHERE kind = 'person' AND created_at >= $1) AS new_users`,
      [since],
    )
    const users: Record<Role, number> = { customer: 0, agent: 0, merchant: 0 }
    for (const r of roles) users[r.role] = r.n
    return {
      users,
      suspended: s.suspended,
      today: { transactions: s.tx, volume: fromCents(s.volume), messages: s.messages, newUsers: s.new_users },
      maintenance: await currentMaintenance(ctx.db),
    }
  })

  // ---------- maintenance ----------
  app.get('/admin/v1/maintenance', auth, async (): Promise<MaintenanceWindow[]> => {
    const rows = await ctx.db.query<WindowRow>('SELECT * FROM maintenance_windows ORDER BY created_at DESC, starts_at DESC LIMIT 200')
    return rows.map(toWindow)
  })

  app.post('/admin/v1/maintenance', auth, async (req, reply): Promise<MaintenanceWindow> => {
    const body = parse(z.object({ startsAt: zDate, endsAt: zDate, message: zLocalized }), req.body)
    const now = Date.now()
    // "Start now" from the portal may arrive a moment in the past; clamp to the server clock.
    const starts = new Date(Math.max(Date.parse(body.startsAt), now))
    const ends = new Date(body.endsAt)
    if (ends <= starts) throw validation('endsAt must be after startsAt')
    const row = await ctx.tx(async (q) => {
      const [w] = await q.query<WindowRow>(
        `INSERT INTO maintenance_windows (id, starts_at, ends_at, message_en, message_st, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [newId(), starts, ends, body.message.en, body.message.st, req.admin.email],
      )
      await audit(q, req.admin, 'maintenance.create', `maintenance:${w.id}`, `${iso(starts)} → ${iso(ends)}`)
      return w
    })
    await onConfigChange()
    reply.code(201)
    return toWindow(row)
  })

  async function changeWindow(id: string, admin: AdminRow, action: string, fn: (q: Queryable, w: WindowRow) => Promise<WindowRow>) {
    const row = await ctx.tx(async (q) => {
      const [w] = await q.query<WindowRow>('SELECT * FROM maintenance_windows WHERE id = $1 FOR UPDATE', [id])
      if (!w) throw notFound('Maintenance window not found')
      const updated = await fn(q, w)
      await audit(q, admin, action, `maintenance:${id}`, `${iso(updated.starts_at)} → ${iso(updated.ends_at)}`)
      return updated
    })
    await onConfigChange()
    return toWindow(row)
  }

  app.patch('/admin/v1/maintenance/:id', auth, async (req): Promise<MaintenanceWindow> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ startsAt: zDate.optional(), endsAt: zDate.optional(), message: zLocalized.optional() }), req.body)
    return changeWindow(id, req.admin, 'maintenance.update', async (q, w) => {
      const status = windowStatus(w)
      if (status !== 'scheduled' && status !== 'active') throw conflict(`This window is ${status}`)
      const starts = body.startsAt ? new Date(Math.max(Date.parse(body.startsAt), status === 'active' ? 0 : Date.now())) : new Date(w.starts_at)
      const ends = body.endsAt ? new Date(body.endsAt) : new Date(w.ends_at)
      if (ends <= starts) throw validation('endsAt must be after startsAt')
      if (ends.getTime() <= Date.now()) throw validation('endsAt must be in the future (use end to stop a window now)')
      const [u] = await q.query<WindowRow>(
        `UPDATE maintenance_windows SET starts_at = $2, ends_at = $3, message_en = $4, message_st = $5 WHERE id = $1 RETURNING *`,
        [id, starts, ends, body.message?.en ?? w.message_en, body.message?.st ?? w.message_st],
      )
      return u
    })
  })

  app.post('/admin/v1/maintenance/:id/end', auth, async (req): Promise<MaintenanceWindow> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return changeWindow(id, req.admin, 'maintenance.end', async (q, w) => {
      if (windowStatus(w) !== 'active') throw conflict('Only an active window can be ended')
      const [u] = await q.query<WindowRow>(
        `UPDATE maintenance_windows SET ends_at = GREATEST(now(), starts_at + interval '1 millisecond') WHERE id = $1 RETURNING *`,
        [id],
      )
      return u
    })
  })

  app.post('/admin/v1/maintenance/:id/cancel', auth, async (req): Promise<MaintenanceWindow> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return changeWindow(id, req.admin, 'maintenance.cancel', async (q, w) => {
      if (windowStatus(w) !== 'scheduled') throw conflict('Only a scheduled window can be cancelled')
      const [u] = await q.query<WindowRow>('UPDATE maintenance_windows SET cancelled = true WHERE id = $1 RETURNING *', [id])
      return u
    })
  })

  // ---------- app config ----------
  app.get('/admin/v1/app-config', auth, async (): Promise<AppConfig> => appConfig(ctx.db))

  app.put('/admin/v1/app-config', auth, async (req): Promise<AppConfig> => {
    const body = parse(
      z.object({
        announcement: zLocalized.nullable(),
        minVersion: z.object({ customer: zSemver, business: zSemver, ecosure: zSemver.default(null), society: zSemver.default(null) }),
        deviceSecurity: z.object({
          blockRooted: z.boolean(),
          blockDeveloperMode: z.boolean(),
          requireSimMatch: z.boolean().default(true),
          idleMinutes: z.number().int().min(SECURITY_LIMITS.idleMinutes[0]).max(SECURITY_LIMITS.idleMinutes[1]).default(DEFAULT_DEVICE_SECURITY.idleMinutes),
          sessionDays: z.number().int().min(SECURITY_LIMITS.sessionDays[0]).max(SECURITY_LIMITS.sessionDays[1]).default(DEFAULT_DEVICE_SECURITY.sessionDays),
          maxPinAttempts: z.number().int().min(SECURITY_LIMITS.maxPinAttempts[0]).max(SECURITY_LIMITS.maxPinAttempts[1]).default(DEFAULT_DEVICE_SECURITY.maxPinAttempts),
          pinLockMinutes: z.number().int().min(SECURITY_LIMITS.pinLockMinutes[0]).max(SECURITY_LIMITS.pinLockMinutes[1]).default(DEFAULT_DEVICE_SECURITY.pinLockMinutes),
        }).optional(),
      }),
      req.body,
    )
    await ctx.tx(async (q) => {
      await setSetting(q, 'announcement', body.announcement)
      await setSetting(q, 'minVersion', body.minVersion)
      if (body.deviceSecurity) await setSetting(q, 'deviceSecurity', body.deviceSecurity)
      await audit(q, req.admin, 'app-config.update', 'app-config', JSON.stringify(body))
    })
    await onConfigChange()
    return appConfig(ctx.db)
  })

  // ---------- users ----------
  app.get('/admin/v1/users', auth, async (req): Promise<Page<AdminUser>> => {
    const query = parse(
      z.object({
        query: z.string().trim().optional(),
        role: z.enum(['customer', 'agent', 'merchant', '']).optional(),
        status: z.enum(['active', 'suspended', '']).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
      }),
      req.query,
    )
    const term = query.query ? `%${query.query.replace(/[\s%_\\]/g, (c) => (c === ' ' ? '%' : `\\${c}`))}%` : null
    const where = `kind = 'person'
      AND ($1::text IS NULL OR name ILIKE $1 OR msisdn LIKE $1 OR business_name ILIKE $1 OR code ILIKE $1)
      AND ($2::text IS NULL OR role = $2) AND ($3::text IS NULL OR status = $3)`
    const params = [term, query.role || null, query.status || null]
    const [{ total }] = await ctx.db.query<{ total: number }>(`SELECT count(*) AS total FROM users WHERE ${where}`, params)
    const rows = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE ${where} ORDER BY created_at DESC, name LIMIT $4 OFFSET $5`, [
      ...params,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ])
    // Chip counts: each filter's values counted with the search and the other filter applied.
    const groups = await ctx.db.query<{ role: string; status: string; n: number }>(
      `SELECT role, status, count(*)::int AS n FROM users WHERE kind = 'person'
         AND ($1::text IS NULL OR name ILIKE $1 OR msisdn LIKE $1 OR business_name ILIKE $1 OR code ILIKE $1) GROUP BY role, status`,
      [term],
    )
    const counts = facetCounts(groups, { role: query.role || null, status: query.status || null })
    return { items: rows.map(toAdminUser), total, page: query.page, pageSize: query.pageSize, counts }
  })

  app.get('/admin/v1/users/:id', auth, async (req): Promise<AdminUser> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return toAdminUser(await requireUserRow(ctx.db, id))
  })

  app.post('/admin/v1/users', auth, async (req, reply): Promise<AdminUser> => {
    const body = parse(
      z.object({
        msisdn: z.string(),
        name: z.string().trim().min(1).max(60),
        role: z.enum(['customer', 'agent', 'merchant']),
        pin: zPin,
        businessName: z.string().trim().max(80).optional(),
        ownerIdNumber: zOwnerId,
      }),
      req.body,
    )
    const msisdn = normalizeMsisdn(body.msisdn)
    const { hash, salt } = await hashSecret(strongPin(body.pin))
    const user = await ctx.tx(async (q) => {
      const [exists] = await q.query('SELECT 1 FROM users WHERE msisdn = $1', [msisdn])
      if (exists) throw conflict(`${msisdn} already has a wallet`)
      const code = body.role === 'agent' ? await nextCode(q, 'AGENT') : body.role === 'merchant' ? await nextMerchantCode(q) : null
      const businessName = body.role === 'customer' ? null : body.businessName || null
      const [u] = await q.query<UserRow>(
        `INSERT INTO users (id, msisdn, name, role, business_name, code, kyc_tier, pin_hash, pin_salt, owner_id_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [newId(), msisdn, body.name, body.role, businessName, code, body.role === 'customer' ? 1 : 2, hash, salt, body.role === 'customer' ? null : body.ownerIdNumber || null],
      )
      await audit(q, req.admin, 'user.create', `user:${u.id}`, `${body.role} ${msisdn}${code ? ` ${code}` : ''}`)
      return u
    })
    reply.code(201)
    return toAdminUser(user)
  })

  app.patch('/admin/v1/users/:id', auth, async (req): Promise<AdminUser> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        status: z.enum(['active', 'suspended']).optional(),
        businessName: z.string().trim().max(80).optional(),
        ownerIdNumber: zOwnerId,
      }),
      req.body,
    )
    const user = await ctx.tx(async (q) => {
      const before = await requireUserRow(q, id)
      const ownerId = body.ownerIdNumber === undefined || before.role === 'customer' ? before.owner_id_number ?? null : body.ownerIdNumber || null
      const [u] = await q.query<UserRow>(
        `UPDATE users SET name = $2, status = $3, business_name = $4, owner_id_number = $5 WHERE id = $1 RETURNING *`,
        [id, body.name ?? before.name, body.status ?? before.status, body.businessName === undefined ? before.business_name : body.businessName || null, ownerId],
      )
      // A new owner: whoever had linked the business no longer may open it.
      if (ownerId !== (before.owner_id_number ?? null)) {
        await q.query(
          `DELETE FROM business_links l USING users o WHERE l.business_id = $1 AND l.owner_id = o.id AND (o.id_number IS DISTINCT FROM $2 OR $2 IS NULL)`,
          [id, ownerId],
        )
        await q.query(`DELETE FROM sessions WHERE user_id = $1 AND opened_by IS NOT NULL AND opened_by NOT IN (SELECT owner_id FROM business_links WHERE business_id = $1)`, [id])
      }
      if (body.status && body.status !== before.status) {
        await audit(q, req.admin, body.status === 'suspended' ? 'user.suspend' : 'user.reactivate', `user:${id}`, before.msisdn ?? '')
        // Sessions are kept: every authenticated call checks the status and answers SUSPENDED,
        // so the apps can show "account suspended" instead of a plain sign-out.
      }
      const changes = [
        body.name !== undefined && body.name !== before.name ? `name: ${before.name} → ${body.name}` : null,
        body.businessName !== undefined && (body.businessName || null) !== before.business_name ? `businessName: ${before.business_name ?? '-'} → ${body.businessName || '-'}` : null,
        ownerId !== (before.owner_id_number ?? null) ? `ownerIdNumber: ${before.owner_id_number ?? '-'} → ${ownerId ?? '-'}` : null,
      ].filter(Boolean)
      if (changes.length) await audit(q, req.admin, 'user.update', `user:${id}`, changes.join('; '))
      return u
    })
    if (user.status === 'suspended') ctx.hub.disconnectUser(id, WS_CLOSE.SUSPENDED, 'SUSPENDED')
    return toAdminUser(user)
  })

  app.post('/admin/v1/users/:id/reset-pin', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ pin: zPin }), req.body)
    const { hash, salt } = await hashSecret(strongPin(body.pin))
    await ctx.tx(async (q) => {
      await requireUserRow(q, id)
      await q.query('UPDATE users SET pin_hash = $2, pin_salt = $3, failed_pins = 0, locked_until = NULL WHERE id = $1', [id, hash, salt])
      // A PIN reset signs the wallet out everywhere.
      await q.query('DELETE FROM sessions WHERE user_id = $1', [id])
      await audit(q, req.admin, 'user.reset-pin', `user:${id}`)
    })
    ctx.hub.disconnectUser(id, WS_CLOSE.UNAUTHORIZED, 'UNAUTHORIZED')
    return noContent(reply)
  })

  app.post('/admin/v1/users/:id/float', auth, async (req): Promise<AdminUser> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ amount: zAmount, note: z.string().trim().min(1).max(200) }), req.body)
    const cents = toCents(body.amount)
    if (cents <= 0) throw validation('amount must be greater than 0')
    if (cents > MAX_FLOAT_CENTS) throw new AppError('LIMIT_EXCEEDED', 'Float top-ups are limited to M1,000,000 at a time')
    const user = await ctx.tx(async (q, out) => {
      const agent = await requireUserRow(q, id)
      if (agent.role !== 'agent') throw validation('Float can only be added to agents')
      const result = await ctx.ledger.transfer(q, { kind: 'float', fromUserId: null, toUserId: id, amountCents: cents, label: 'Float top-up', note: body.note })
      for (const [userId, balance] of result.balances) out.balance(userId, balance)
      await audit(q, req.admin, 'user.float', `user:${id}`, `M${body.amount.toFixed(2)} · ${result.tx.reference} · ${body.note}`)
      return requireUserRow(q, id)
    })
    return toAdminUser(user)
  })

  // ---------- transactions & audit ----------
  app.get('/admin/v1/transactions', auth, async (req): Promise<Page<AdminTransaction>> => {
    const query = parse(
      z.object({
        query: z.string().trim().optional(),
        kind: z.string().optional(),
        userId: z.string().optional(),
        days: z.coerce.number().int().min(1).max(3650).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
      }),
      req.query,
    )
    const term = query.query ? `%${query.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null
    const where = `($1::text IS NULL OR t.reference ILIKE $1 OR EXISTS (
        SELECT 1 FROM users u WHERE u.id IN (t.from_user_id, t.to_user_id) AND (u.name ILIKE $1 OR u.msisdn LIKE $1 OR u.business_name ILIKE $1)))
      AND ($2::text IS NULL OR t.kind = $2)
      AND ($3::text IS NULL OR t.from_user_id = $3 OR t.to_user_id = $3)
      AND ($4::timestamptz IS NULL OR t.created_at >= $4)`
    const since = query.days ? new Date(Date.now() - query.days * 86_400_000) : null
    const params = [term, query.kind || null, query.userId || null, since]
    const [{ total }] = await ctx.db.query<{ total: number }>(`SELECT count(*) AS total FROM transactions t WHERE ${where}`, params)
    const rows = await ctx.db.query<TransactionRow>(
      `SELECT t.* FROM transactions t WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT $5 OFFSET $6`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    )
    const kinds = await ctx.db.query<{ kind: string; n: number }>(
      `SELECT t.kind, count(*)::int AS n FROM transactions t WHERE ${where} GROUP BY t.kind`,
      [term, null, query.userId || null, since],
    )
    const counts = facetCounts(kinds, { kind: query.kind || null })
    return { items: await toAdminTransactions(ctx.db, rows), total, page: query.page, pageSize: query.pageSize, counts }
  })

  app.get('/admin/v1/audit', auth, async (req): Promise<Page<AuditEntry>> => {
    const query = parse(z.object({ page: zPage, pageSize: z.coerce.number().int().min(1).max(100).default(50) }), req.query)
    const [{ total }] = await ctx.db.query<{ total: number }>('SELECT count(*) AS total FROM audit_log')
    const rows = await ctx.db.query<{ id: string; admin_email: string; action: string; target: string; detail: string; created_at: Date }>(
      'SELECT * FROM audit_log ORDER BY seq DESC LIMIT $1 OFFSET $2',
      [query.pageSize, (query.page - 1) * query.pageSize],
    )
    return {
      items: rows.map((r) => ({ id: r.id, adminEmail: r.admin_email, action: r.action, target: r.target, detail: r.detail, createdAt: iso(r.created_at) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  })
}
