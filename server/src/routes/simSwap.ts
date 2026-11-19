// SIM swap: Econet's webhook and the portal's per-user view. Contract: shared/api.ts "SIM swap".
import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { notFound } from '../errors'
import { authAdmin, authUser, parse, zId } from '../http'
import { clearSimSwap, mySimSwap, recordSimSwap, reportSimSignal, simSwapStatus, simulateSimSwap } from '../services/simSwap'
import { audit } from './admin'

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function simSwapRoutes(app: FastifyInstance, ctx: Ctx) {
  // Econet pushes each SIM swap here (to be connected). Off (404) until SIM_SWAP_WEBHOOK_SECRET is set.
  app.post('/v1/hooks/sim-swap', async (req) => {
    const secret = ctx.config.simSwapWebhookSecret
    const given = req.headers['x-webhook-secret']
    if (!secret || typeof given !== 'string' || !sameSecret(given, secret)) throw notFound('Not found')
    const body = parse(z.object({ msisdn: z.string().max(20), swappedAt: z.string().max(40) }), req.body)
    const r = await recordSimSwap(ctx, { ...body, source: 'network' })
    return { recorded: r.recorded, known: !!r.userId }
  })

  // The app's SIM watch on the bound phone.
  const auth = { preHandler: authUser(ctx) }
  const zSim = z.object({
    slot: z.number().int().min(0).max(8),
    mcc: z.string().max(4).nullable(),
    mnc: z.string().max(4).nullable(),
    carrier: z.string().max(60).nullable(),
    inService: z.boolean().nullable(),
  })
  app.post('/v1/me/sim-signal', auth, async (req) => {
    const body = parse(z.object({
      signal: z.enum(['sim_changed', 'sim_removed', 'no_service', 'sim_ok']),
      since: z.string().max(40),
      minutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
      sims: z.array(zSim).max(8),
    }), req.body)
    return reportSimSignal(ctx, req.user, body, req.ip)
  })
  app.get('/v1/me/sim-swap', auth, async (req) => mySimSwap(ctx, req.user.id))

  const admin = { preHandler: authAdmin(ctx) }
  const userId = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/admin/v1/users/:id/sim-swaps', admin, async (req) => simSwapStatus(ctx, userId(req.params)))

  app.post('/admin/v1/users/:id/sim-swaps/simulate', admin, async (req) => {
    const id = userId(req.params)
    const { hoursAgo } = parse(z.object({ hoursAgo: z.number().min(0).max(24 * 30).default(0) }), req.body ?? {})
    const status = await simulateSimSwap(ctx, id, hoursAgo)
    await audit(ctx.db, req.admin, 'sim-swap.simulate', `user:${id}`, `${hoursAgo} h ago`)
    return status
  })

  app.post('/admin/v1/users/:id/sim-swaps/clear', admin, async (req) => {
    const id = userId(req.params)
    const { note } = parse(z.object({ note: z.string().trim().min(3, 'Say how you checked the owner').max(300) }), req.body)
    await ctx.db.tx(async (q) => {
      await clearSimSwap(q, id, req.admin.email, note)
      await audit(q, req.admin, 'sim-swap.clear', `user:${id}`, note)
    })
    return simSwapStatus(ctx, id)
  })
}
