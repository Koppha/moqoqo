import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { LIMIT_GROUPS, type AdminServiceRequest, type KycLimits, type LimitGroup, type Page, type PendingItem, type ServiceBody } from '../../../shared/api'
import type { Ctx } from '../context'
import { readUpload } from '../ecosure/uploads'
import { notFound, validation } from '../errors'
import { authAdmin, authUser, noContent, parse, zClientId, zId, zPage, zPin } from '../http'
import { hashSecret } from '../lib/crypto'
import { fromCents } from '../lib/money'
import { iso } from '../lib/time'
import { myWithdrawals } from '../services/atm'
import * as catalogue from '../services/catalogue'
import { checkPin, checkStrongPin, parsePin } from '../services/pins'
import { getUsers, toPublicUser } from '../services/users'
import { postToInbox } from '../services/inbox'
import { getKycLimits, setKycLimits } from '../services/kyc'
import { audit } from './admin'

const zValues = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(500))

export async function serviceRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  app.get('/v1/services', auth, async () => catalogue.listServices(ctx.db, { enabledOnly: true }))

  app.post('/v1/services/:id/quote', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ values: zValues }), req.body)
    return catalogue.quote(ctx, id, body.values)
  })

  app.post('/v1/services/:id/submit', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ values: zValues, pin: zPin, clientId: zClientId }), req.body)
    return catalogue.submit(ctx, req.user, id, body)
  })

  app.get('/v1/service-requests', auth, async (req) => catalogue.myRequests(ctx.db, req.user))

  app.get('/v1/kyc-limits', auth, async () => getKycLimits(ctx.db))

  // ---------- self service ----------
  app.post('/v1/auth/change-pin', auth, async (req, reply) => {
    const body = parse(z.object({ currentPin: zPin, newPin: zPin }), req.body)
    const newPin = parsePin(body.newPin, 'newPin')
    await checkPin(ctx.db, req.user, body.currentPin)
    if (newPin === body.currentPin) throw validation('Choose a PIN different from the one you have')
    checkStrongPin(newPin)
    const { hash, salt } = await hashSecret(newPin)
    await ctx.db.query('UPDATE users SET pin_hash = $2, pin_salt = $3, failed_pins = 0, locked_until = NULL WHERE id = $1', [req.user.id, hash, salt])
    void ctx.notifier.send({
      userIds: [req.user.id],
      category: 'security',
      title: 'EcoCash PIN changed',
      body: "Your EcoCash wallet PIN was changed. If this wasn't you, call EcoCash customer care now.",
    })
    return noContent(reply)
  })

  /**
   * Me › Change PIN › App PIN: a PIN that opens the app, apart from the wallet PIN (which still pays). The current one
   * is the app PIN when set, else the wallet PIN. remove: open the app with the wallet PIN again.
   */
  app.post('/v1/auth/change-app-pin', auth, async (req, reply) => {
    const body = parse(z.object({ currentPin: zPin, newPin: zPin }), req.body)
    const newPin = parsePin(body.newPin, 'newPin')
    await checkPin(ctx.db, req.user, body.currentPin, req.user.app_pin_hash ? 'app' : 'wallet')
    if (newPin === body.currentPin) throw validation('Choose a PIN different from the one you have')
    checkStrongPin(newPin)
    const { hash, salt } = await hashSecret(newPin)
    await ctx.db.query('UPDATE users SET app_pin_hash = $2, app_pin_salt = $3, app_failed_pins = 0, app_locked_until = NULL WHERE id = $1', [req.user.id, hash, salt])
    void ctx.notifier.send({
      userIds: [req.user.id],
      category: 'security',
      title: 'App PIN changed',
      body: "The PIN that opens EcoCash Super App was changed. If this wasn't you, call EcoCash customer care now.",
    })
    return noContent(reply)
  })

  app.post('/v1/auth/remove-app-pin', auth, async (req, reply) => {
    const body = parse(z.object({ currentPin: zPin }), req.body)
    if (!req.user.app_pin_hash) return noContent(reply)
    await checkPin(ctx.db, req.user, body.currentPin, 'app')
    await ctx.db.query('UPDATE users SET app_pin_hash = NULL, app_pin_salt = NULL, app_failed_pins = 0, app_locked_until = NULL WHERE id = $1', [req.user.id])
    return noContent(reply)
  })

  app.get('/v1/pending', auth, async (req): Promise<PendingItem[]> => {
    const me = req.user
    const requests = await ctx.db.query<{
      message_id: string; chat_id: string; kind: string; requester_id: string; requester: string; to_name: string | null; amount_cents: number; paid_cents: number
      note: string | null; detail: string | null; created_at: Date; my_share: number | null; my_paid: Date | null; share_set: boolean
    }>(
      `SELECT r.message_id, m.chat_id, r.kind, r.requester_id, COALESCE(u.business_name, u.name) AS requester,
              COALESCE(c.title, (SELECT COALESCE(o.business_name, o.name) FROM chat_members om JOIN users o ON o.id = om.user_id
                                 WHERE om.chat_id = c.id AND om.user_id <> $1 LIMIT 1)) AS to_name,
              r.amount_cents, r.paid_cents, r.note, r.detail, m.created_at, s.amount_cents AS my_share, s.paid_at AS my_paid, s.message_id IS NOT NULL AS share_set
       FROM requests r JOIN messages m ON m.id = r.message_id JOIN chats c ON c.id = m.chat_id
         JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
         JOIN users u ON u.id = r.requester_id
         LEFT JOIN split_shares s ON s.message_id = r.message_id AND s.user_id = $1
       WHERE r.status = 'pending' ORDER BY m.created_at DESC LIMIT 50`,
      [me.id],
    )
    const items: PendingItem[] = []
    for (const r of requests) {
      const note = r.note ?? r.detail ?? undefined
      if (r.requester_id === me.id) {
        items.push({ kind: 'request_sent', messageId: r.message_id, chatId: r.chat_id, to: r.to_name ?? '', amount: fromCents(r.amount_cents), paid: fromCents(r.paid_cents), note, createdAt: iso(r.created_at) })
      } else if (r.kind !== 'split' || (r.share_set && !r.my_paid)) {
        const due = r.kind === 'split' ? Number(r.my_share ?? 0) : Number(r.amount_cents) - Number(r.paid_cents)
        items.push({ kind: 'request_to_pay', messageId: r.message_id, chatId: r.chat_id, from: r.requester, amount: fromCents(due), note, createdAt: iso(r.created_at) })
      }
    }
    const topups = await ctx.db.query<{ id: string; amount_cents: number; brand: string; last4: string; created_at: Date }>(
      `SELECT t.id, t.amount_cents, c.brand, c.last4, t.created_at FROM card_topups t JOIN cards c ON c.id = t.card_id
       WHERE t.user_id = $1 AND t.status = 'pending_otp' AND t.expires_at > now() ORDER BY t.created_at DESC`,
      [me.id],
    )
    for (const t of topups) items.push({ kind: 'topup', id: t.id, amount: fromCents(t.amount_cents), card: `${t.brand === 'visa' ? 'Visa' : 'Mastercard'} •• ${t.last4}`, createdAt: iso(t.created_at) })
    for (const r of await catalogue.myRequests(ctx.db, me)) if (r.status === 'pending') items.push({ kind: 'service_request', request: r })
    for (const w of await myWithdrawals(ctx.db, me)) if (w.status === 'active') items.push({ kind: 'atm', withdrawal: w })
    return items
  })
}

export async function serviceAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/services', auth, async () => catalogue.listServices(ctx.db, { enabledOnly: false }))

  const zLimit = z.number().min(0).max(1_000_000).nullable()
  const zGroups = z.object(Object.fromEntries(LIMIT_GROUPS.map((g) => [g, zLimit])) as Record<LimitGroup, typeof zLimit>)
  app.get('/admin/v1/kyc-limits', auth, async () => getKycLimits(ctx.db))
  app.put('/admin/v1/kyc-limits', auth, async (req) => {
    const body = parse(z.object({ perTransaction: zGroups, daily: zGroups, dailyTotal: zLimit }), req.body) as KycLimits
    const saved = await setKycLimits(ctx.db, body)
    await audit(ctx.db, req.admin, 'kyc-limits.update', 'kyc-limits', JSON.stringify(body).slice(0, 300))
    return saved
  })

  app.post('/admin/v1/services', auth, async (req, reply) => {
    const body = parse(catalogue.zServiceBody, req.body) as ServiceBody
    const saved = await catalogue.saveService(ctx.db, null, body)
    await audit(ctx.db, req.admin, 'service.create', `service:${saved.id}`, saved.name.en)
    reply.code(201)
    return saved
  })

  app.put('/admin/v1/services/:id', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(catalogue.zServiceBody, req.body) as ServiceBody
    const saved = await catalogue.saveService(ctx.db, id, body)
    await audit(ctx.db, req.admin, 'service.update', `service:${id}`, `${saved.name.en}${saved.enabled ? '' : ' (off)'}`)
    return saved
  })

  app.delete('/admin/v1/services/:id', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const [r] = await ctx.db.query<{ name: { en: string } }>('DELETE FROM services WHERE id = $1 RETURNING name', [id])
    if (!r) throw notFound('Service not found')
    await audit(ctx.db, req.admin, 'service.delete', `service:${id}`, r.name.en)
    return noContent(reply)
  })

  const toAdmin = async (rows: catalogue.RequestRow[]): Promise<AdminServiceRequest[]> => {
    const users = await getUsers(ctx.db, rows.map((r) => r.user_id))
    return rows.map((r) => ({ ...catalogue.toRequest(r), user: toPublicUser(users.get(r.user_id)!), files: r.files.map((f) => ({ key: f.key, label: f.label })) }))
  }

  app.get('/admin/v1/service-requests', auth, async (req): Promise<Page<AdminServiceRequest>> => {
    const query = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional().or(z.literal('')), page: zPage, pageSize: z.coerce.number().int().min(1).max(100).default(20) }), req.query)
    const status = query.status || null
    const [{ total }] = await ctx.db.query<{ total: number }>('SELECT count(*)::int AS total FROM service_requests WHERE ($1::text IS NULL OR status = $1)', [status])
    const rows = await ctx.db.query<catalogue.RequestRow>(
      'SELECT * FROM service_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, query.pageSize, (query.page - 1) * query.pageSize],
    )
    return { items: await toAdmin(rows), total, page: query.page, pageSize: query.pageSize }
  })

  app.get('/admin/v1/service-requests/:id/files/:key', auth, async (req, reply) => {
    const { id, key } = parse(z.object({ id: zId, key: z.string() }), req.params)
    const [r] = await ctx.db.query<catalogue.RequestRow>('SELECT * FROM service_requests WHERE id = $1', [id])
    const f = r?.files.find((x) => x.key === key)
    const file = f ? await readUpload(ctx.db, f.uploadId) : null
    if (!file) throw notFound('File not found')
    reply.header('content-type', file.contentType).header('content-disposition', `inline; filename="${file.fileName}"`).header('cache-control', 'private, no-store')
    return reply.send(file.content)
  })

  app.post('/admin/v1/service-requests/:id/decision', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() }), req.body)
    if (body.status === 'rejected' && !body.note) throw validation('Say why, so the customer knows what to fix')
    const row = await ctx.tx(async (q, out) => {
      const [r] = await q.query<catalogue.RequestRow & { code: string | null }>(
        `UPDATE service_requests sr SET status = $2, note = $3, decided_by = $4, updated_at = now()
         FROM (SELECT id FROM service_requests WHERE id = $1 AND status = 'pending') pend
         WHERE sr.id = pend.id RETURNING sr.*, (SELECT code FROM services s WHERE s.id = sr.service_id) AS code`,
        [id, body.status, body.note ?? null, req.admin.email],
      )
      if (!r) throw validation('This request was already decided')
      const kyc = r.code === 'KYC'
      // An approved KYC update raises the wallet to tier 2.
      if (body.status === 'approved' && kyc) await q.query('UPDATE users SET kyc_tier = 2 WHERE id = $1', [r.user_id])
      await audit(q, req.admin, `service-request.${body.status}`, `service-request:${id}`, `${r.reference}${body.note ? ` · ${body.note}` : ''}`)
      // In-app message (the EcoCash Super App chat) …
      const extra = body.note ? `

${body.note}` : ''
      const text = body.status === 'approved'
        ? kyc
          ? `✅ Your KYC update ${r.reference} is approved. Your wallet is now on tier 2: you can cash out at agents and ATMs, and the lower limits no longer apply.${extra}`
          : `✅ Your ${r.service_name.en} request ${r.reference} is approved.${extra}`
        : `❌ Your ${r.service_name.en} request ${r.reference} was not approved: ${body.note}

You can send it again from Me${kyc ? ' › Update KYC' : ''}.`
      await postToInbox(q, out, r.user_id, text)
      // … and an SMS.
      out.notify({
        userIds: [r.user_id],
        category: 'security',
        title: `${r.service_name.en} ${body.status}`,
        body: body.status === 'approved' ? `Your ${r.service_name.en} request ${r.reference} is approved.` : `Your ${r.service_name.en} request ${r.reference} was not approved: ${body.note}`,
        channels: ['sms'],
      })
      return r
    })
    return (await toAdmin([row]))[0]
  })
}
