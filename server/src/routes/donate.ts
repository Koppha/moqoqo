// Donate: /v1/causes…, and the portal's /admin/v1/causes and /admin/v1/donate-settings. Contract: shared/api.ts "Donate".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DonateSettings } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, authUser, parse, zAmount, zClientId, zId, zPin } from '../http'
import {
  adminCauses,
  closeCause,
  createCause,
  donate,
  getCause,
  getDonateSettings,
  myCauses,
  setCauseHold,
  setDonateSettings,
  shareCause,
  withdraw,
} from '../services/donate'
import { audit } from './admin'

export async function donateRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  const idParam = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/v1/causes', auth, async (req) => myCauses(ctx.db, req.user))
  app.get('/v1/causes/:code', auth, async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Za-z0-9]{6}$/, 'must be 6 letters and digits') }), req.params)
    return getCause(ctx.db, req.user, code)
  })
  app.post('/v1/causes', auth, async (req, reply) => {
    const body = parse(z.object({ title: z.string().max(60), description: z.string().max(1000), target: zAmount, endsAt: z.string().max(40).optional() }), req.body)
    reply.code(201)
    return createCause(ctx, req.user, body)
  })
  app.post('/v1/causes/:id/donate', auth, async (req) => {
    const body = parse(z.object({ amount: zAmount, note: z.string().max(200).optional(), anonymous: z.boolean().optional(), pin: zPin, clientId: zClientId }), req.body)
    return donate(ctx, req.user, idParam(req.params), body)
  })
  app.post('/v1/causes/:id/withdraw', auth, async (req) => {
    const { amount, pin } = parse(z.object({ amount: zAmount, pin: zPin }), req.body)
    return withdraw(ctx, req.user, idParam(req.params), amount, pin)
  })
  app.post('/v1/causes/:id/close', auth, async (req) => closeCause(ctx, req.user, idParam(req.params)))
  app.post('/v1/causes/:id/share', auth, async (req, reply) => {
    const { chatId } = parse(z.object({ chatId: zId }), req.body)
    reply.code(201)
    return shareCause(ctx, req.user, idParam(req.params), chatId)
  })
}

export async function donateAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }
  const idParam = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/admin/v1/causes', auth, async () => adminCauses(ctx.db))
  app.post('/admin/v1/causes/:id/suspend', auth, async (req) => {
    const id = idParam(req.params)
    const { reason } = parse(z.object({ reason: z.string().max(300) }), req.body)
    await ctx.tx(async (q, out) => {
      const c = await setCauseHold(q, out, id, true, reason)
      await audit(q, req.admin, 'cause.suspend', id, `${c.code} ${c.title}: ${reason.trim()}`)
    })
    return (await adminCauses(ctx.db)).find((c) => c.id === id)
  })
  app.post('/admin/v1/causes/:id/reopen', auth, async (req) => {
    const id = idParam(req.params)
    await ctx.tx(async (q, out) => {
      const c = await setCauseHold(q, out, id, false, null)
      await audit(q, req.admin, 'cause.reopen', id, `${c.code} ${c.title}`)
    })
    return (await adminCauses(ctx.db)).find((c) => c.id === id)
  })
  app.get('/admin/v1/donate-settings', auth, async () => getDonateSettings(ctx.db))
  app.put('/admin/v1/donate-settings', auth, async (req): Promise<DonateSettings> => {
    const body = parse(
      z.object({ enabled: z.boolean(), minKycTier: z.union([z.literal(1), z.literal(2)]), maxTarget: z.number().positive().max(10_000_000), maxOpenPerUser: z.number().int().min(1).max(50) }),
      req.body,
    )
    const before = await getDonateSettings(ctx.db)
    return ctx.tx(async (q) => {
      const saved = await setDonateSettings(q, body)
      const changes = (Object.keys(saved) as (keyof DonateSettings)[]).filter((k) => before[k] !== saved[k]).map((k) => `${k}: ${before[k]} → ${saved[k]}`)
      await audit(q, req.admin, 'donate.update', 'donate', changes.join('; ') || 'no changes')
      return saved
    })
  })
}
