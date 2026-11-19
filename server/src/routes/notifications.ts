import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  CODES_BY_EMAIL_MAX_DAYS,
  DEFAULT_NOTIFICATION_PREFS,
  EMAIL_CODE_TTL_SECONDS,
  NOTIFY_CHANNELS,
  NOTIFY_MATRIX,
  type AdminNotification,
  type ChoosableCategory,
  type NotificationPrefs,
  type NotificationProviders,
  type NotificationSettings,
  type NotifyCategory,
  type NotifyChannel,
  type Page,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, validation } from '../errors'
import { authAdmin, authUser, parse, zPage, zPin } from '../http'
import { hashToken, newId, randomDigits } from '../lib/crypto'
import { iso } from '../lib/time'
import { logAuthEvent } from '../services/authLog'
import { checkPin } from '../services/pins'
import { getUsers, toPublicUser, type UserRow } from '../services/users'
import { audit } from './admin'

const MAX_EMAIL_ATTEMPTS = 5
const codeHash = (userId: string, code: string) => hashToken(`${userId}:${code}`)

async function settings(q: Queryable, userId: string): Promise<NotificationSettings> {
  const [u] = await q.query<{ email: string | null; verified: boolean; devices: number; codes_until: Date | null }>(
    `SELECT email, email_verified_at IS NOT NULL AS verified, (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id) AS devices,
       CASE WHEN codes_by_email_until > now() AND email_verified_at IS NOT NULL THEN codes_by_email_until END AS codes_until
     FROM users u WHERE id = $1`,
    [userId],
  )
  const rows = await q.query<{ channel: NotifyChannel; category: ChoosableCategory; enabled: boolean }>('SELECT channel, category, enabled FROM notification_prefs WHERE user_id = $1', [userId])
  const prefs = {} as NotificationPrefs
  for (const channel of NOTIFY_CHANNELS) {
    prefs[channel] = {}
    for (const category of NOTIFY_MATRIX[channel]) {
      prefs[channel][category] = rows.find((r) => r.channel === channel && r.category === category)?.enabled ?? DEFAULT_NOTIFICATION_PREFS[channel][category] ?? false
    }
  }
  return { prefs, email: u?.email ?? null, emailVerified: !!u?.verified, pushDevice: (u?.devices ?? 0) > 0, codesByEmailUntil: u?.codes_until ? iso(u.codes_until) : null }
}

export async function notificationRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  app.get('/v1/me/notifications', auth, async (req) => settings(ctx.db, req.user.id))

  app.put('/v1/me/notifications', auth, async (req) => {
    const zSwitches = z.record(z.string(), z.boolean()).optional()
    const body = parse(z.object({ prefs: z.object({ push: zSwitches, sms: zSwitches, email: zSwitches }) }), req.body)
    await ctx.db.tx(async (q) => {
      for (const channel of NOTIFY_CHANNELS) {
        for (const [category, enabled] of Object.entries(body.prefs[channel] ?? {})) {
          if (!NOTIFY_MATRIX[channel].includes(category as ChoosableCategory)) {
            throw validation(category === 'security' ? 'Security alerts are always on' : `${channel} has no ${category} notifications`)
          }
          await q.query(
            `INSERT INTO notification_prefs (user_id, channel, category, enabled) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, channel, category) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [req.user.id, channel, category, enabled],
          )
        }
      }
    })
    return settings(ctx.db, req.user.id)
  })

  app.post('/v1/me/email', auth, async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().max(200).pipe(z.email('Enter a valid email address')) }), req.body)
    const code = randomDigits(6)
    await ctx.db.query(
      `INSERT INTO email_codes (user_id, email, code_hash, attempts, expires_at) VALUES ($1, $2, $3, 0, now() + make_interval(secs => $4))
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at`,
      [req.user.id, email, codeHash(req.user.id, code), EMAIL_CODE_TTL_SECONDS],
    )
    const text = `Your EcoCash Super App code is ${code}. It confirms this email address for your wallet and expires in ${EMAIL_CODE_TTL_SECONDS / 60} minutes. If you didn't ask for it, ignore this email.`
    try {
      await ctx.notifier.email.send(email, 'Confirm your email for EcoCash Super App', text)
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'email code not sent')
      throw new AppError('UNKNOWN', "We couldn't send the email. Check the address and try again")
    }
    // With a real provider the code is never stored readable; with the mock it is, so testers can find it in the portal.
    await ctx.db.query(
      `INSERT INTO notifications (id, user_id, channel, category, recipient, title, body, status) VALUES ($6, $1, 'email', 'security', $2, $3, $4, $5)`,
      [req.user.id, email, 'Confirm your email for EcoCash Super App', ctx.notifier.email.real ? text.replace(code, '••••••') : text, ctx.notifier.email.real ? 'sent' : 'mock', newId()],
    )
    return settings(ctx.db, req.user.id)
  })

  app.post('/v1/me/email/verify', auth, async (req) => {
    const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits') }), req.body)
    const [pending] = await ctx.db.query<{ email: string; code_hash: string; attempts: number; expired: boolean }>(
      'SELECT email, code_hash, attempts, expires_at < now() AS expired FROM email_codes WHERE user_id = $1',
      [req.user.id],
    )
    if (!pending || pending.expired || pending.attempts >= MAX_EMAIL_ATTEMPTS) throw validation('This code has expired. Ask for a new one')
    if (pending.code_hash !== codeHash(req.user.id, code)) {
      await ctx.db.query('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = $1', [req.user.id])
      throw validation('That code is not right. Check the email and try again')
    }
    const previous = req.user.email_verified_at ? req.user.email : null
    await ctx.db.tx(async (q) => {
      // A new address turns codes by email off: they are turned on again knowingly, with the PIN.
      await q.query('UPDATE users SET email = $2, email_verified_at = now(), codes_by_email_until = CASE WHEN email = $2 THEN codes_by_email_until END WHERE id = $1', [req.user.id, pending.email])
      await q.query('DELETE FROM email_codes WHERE user_id = $1', [req.user.id])
    })
    void ctx.notifier.send({
      userIds: [req.user.id],
      category: 'security',
      title: 'Email address changed',
      body: `EcoCash Super App will now email ${pending.email}${previous && previous !== pending.email ? ` instead of ${previous}` : ''}. If this wasn't you, call EcoCash customer care.`,
      channels: ['push', 'sms'],
    })
    return settings(ctx.db, req.user.id)
  })

  // Travelling abroad: the code for setting up a phone goes to the confirmed email instead of by SMS, until a date.
  // Off by default; on only from a signed-in phone with the wallet PIN; every change is a security alert.
  app.put('/v1/me/codes-by-email', auth, async (req) => {
    const body = parse(z.object({ on: z.boolean(), days: z.number().int().min(1).max(CODES_BY_EMAIL_MAX_DAYS).default(30), pin: zPin.optional() }), req.body)
    if (body.on) {
      if (!req.user.email || !req.user.email_verified_at) throw validation('Add and confirm an email address first')
      await checkPin(ctx.db, req.user, body.pin)
      const [row] = await ctx.db.query<{ until: Date }>(
        `UPDATE users SET codes_by_email_until = now() + make_interval(days => $2) WHERE id = $1 RETURNING codes_by_email_until AS until`,
        [req.user.id, body.days],
      )
      const until = row.until.toLocaleDateString('en-GB', { timeZone: 'Africa/Maseru', day: 'numeric', month: 'long', year: 'numeric' })
      await logAuthEvent(ctx.db, { userId: req.user.id, kind: 'codes_email_on', ip: req.ip, detail: `${req.user.email} until ${until}` })
      void ctx.notifier.send({
        userIds: [req.user.id],
        category: 'security',
        title: 'Sign-in codes will come by email',
        body: `Until ${until}, the code for setting up EcoCash Super App on a phone goes to ${req.user.email} instead of by SMS. If this wasn't you, call EcoCash customer care now.`,
        channels: ['push', 'sms', 'email'],
      })
    } else {
      await ctx.db.query('UPDATE users SET codes_by_email_until = NULL WHERE id = $1', [req.user.id])
      await logAuthEvent(ctx.db, { userId: req.user.id, kind: 'codes_email_off', ip: req.ip })
    }
    return settings(ctx.db, req.user.id)
  })

  app.delete('/v1/me/email', auth, async (req) => {
    await ctx.db.query('UPDATE users SET email = NULL, email_verified_at = NULL, codes_by_email_until = NULL WHERE id = $1', [req.user.id])
    await ctx.db.query('DELETE FROM email_codes WHERE user_id = $1', [req.user.id])
    return settings(ctx.db, req.user.id)
  })
}

export async function notificationAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/notifications', auth, async (req): Promise<Page<AdminNotification>> => {
    const query = parse(
      z.object({
        channel: z.enum(['push', 'sms', 'email']).optional().or(z.literal('')),
        category: z.enum(['money', 'requests', 'ecosure', 'chats', 'news', 'security']).optional().or(z.literal('')),
        query: z.string().trim().max(100).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    )
    const where = `($1::text IS NULL OR n.channel = $1) AND ($2::text IS NULL OR n.category = $2)
      AND ($3::text IS NULL OR n.recipient ILIKE $3 OR n.body ILIKE $3 OR u.name ILIKE $3)`
    const params = [query.channel || null, query.category || null, query.query ? `%${query.query}%` : null]
    const [{ total }] = await ctx.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE ${where}`, params)
    const rows = await ctx.db.query<{
      id: string; user_id: string | null; channel: NotifyChannel; category: NotifyCategory; recipient: string; title: string; body: string
      status: AdminNotification['status']; error: string | null; created_at: Date
    }>(
      `SELECT n.* FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE ${where} ORDER BY n.created_at DESC, n.id LIMIT $4 OFFSET $5`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    )
    const users = await getUsers(ctx.db, rows.map((r) => r.user_id).filter((x): x is string => !!x))
    return {
      items: rows.map((r) => {
        const u: UserRow | undefined = r.user_id ? users.get(r.user_id) : undefined
        const n: AdminNotification = {
          id: r.id, user: u ? toPublicUser(u) : null, channel: r.channel, category: r.category, recipient: r.recipient,
          title: r.title, body: r.body, status: r.status, createdAt: iso(r.created_at),
        }
        if (r.error) n.error = r.error
        return n
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  })

  app.get('/admin/v1/notifications/providers', auth, async (): Promise<NotificationProviders> => ({
    push: ctx.config.pushEnabled,
    sms: ctx.notifier.sms.real,
    email: ctx.notifier.email.real,
    assistant: ctx.assistant.enabled,
  }))

  app.post('/admin/v1/notifications/news', auth, async (req) => {
    const body = parse(z.object({ title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(300) }), req.body)
    // Everyone active gets it offered; each person's own switches decide whether (and how) it reaches them.
    const people = await ctx.db.query<{ id: string }>(`SELECT id FROM users WHERE kind = 'person' AND status = 'active'`)
    await audit(ctx.db, req.admin, 'notifications.news', 'notifications:news', body.title)
    void ctx.notifier.send({ userIds: people.map((p) => p.id), category: 'news', title: body.title, body: body.body })
    const [{ n }] = await ctx.db.query<{ n: number }>(
      `SELECT count(DISTINCT u.id)::int AS n FROM users u WHERE u.kind = 'person' AND u.status = 'active' AND EXISTS (
         SELECT 1 FROM notification_prefs p WHERE p.user_id = u.id AND p.category = 'news' AND p.enabled)`,
    )
    return { recipients: n }
  })
}
