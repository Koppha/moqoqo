import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authAdmin, authUser, parse, zAmount, zClientId, zId, zPin } from '../http'
import { cancelWithdrawal, createWithdrawal, myWithdrawals, redeem } from '../services/atm'
import { audit } from './admin'

export async function atmRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  app.post('/v1/atm/withdrawals', auth, async (req, reply) => {
    const body = parse(z.object({ amount: zAmount, pin: zPin, clientId: zClientId }), req.body)
    reply.code(201)
    return createWithdrawal(ctx, req.user, body)
  })
  app.get('/v1/atm/withdrawals', auth, async (req) => myWithdrawals(ctx.db, req.user))
  app.post('/v1/atm/withdrawals/:id/cancel', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return cancelWithdrawal(ctx, req.user, id)
  })

  // ATM simulator (portal) until the ATM switch is connected.
  app.post('/admin/v1/atm/redeem', { preHandler: authAdmin(ctx) }, async (req) => {
    const body = parse(z.object({ msisdn: z.string(), code: z.string().trim().regex(/^\d{8}$/, 'The code has 8 digits'), amount: zAmount, atm: z.string().trim().min(1).max(60) }), req.body)
    const w = await redeem(ctx, body)
    await audit(ctx.db, req.admin, 'atm.simulate', `atm:${w.id}`, `${w.reference} · ${body.atm}`)
    return w
  })
}
