// Saved bills, saved recipients and stop orders. Contract: shared/api.ts "Saved bills, saved recipients and stop orders".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authUser, noContent, parse, zAmount, zId, zPin } from '../http'
import * as so from '../services/stopOrders'

export async function stopOrderRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  const idParam = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/v1/saved-bills', auth, async (req) => so.listSavedBills(ctx.db, req.user.id))
  app.post('/v1/saved-bills', auth, async (req, reply) => {
    const body = parse(z.object({ target: z.string().max(80), account: z.string().max(60), nickname: z.string().max(40) }), req.body)
    const saved = await ctx.tx((q) => so.saveBill(q, req.user.id, body))
    reply.code(201)
    return saved
  })
  app.delete('/v1/saved-bills/:id', auth, async (req, reply) => {
    await so.deleteSavedBill(ctx.db, req.user.id, idParam(req.params))
    return noContent(reply)
  })

  app.get('/v1/saved-recipients', auth, async (req) => so.listRecipients(ctx.db, req.user.id))
  app.post('/v1/saved-recipients', auth, async (req, reply) => {
    const body = parse(z.object({ msisdn: z.string().max(20), nickname: z.string().max(40).optional() }), req.body)
    const saved = await ctx.tx((q) => so.saveRecipient(q, req.user, body.msisdn, body.nickname))
    reply.code(201)
    return saved
  })
  app.delete('/v1/saved-recipients/:id', auth, async (req, reply) => {
    await so.deleteRecipient(ctx.db, req.user.id, idParam(req.params))
    return noContent(reply)
  })

  app.get('/v1/stop-orders', auth, async (req) => so.listStopOrders(ctx.db, req.user.id))
  app.post('/v1/stop-orders', auth, async (req, reply) => {
    const body = parse(
      z.object({
        kind: z.enum(['bill', 'send']),
        savedBillId: zId.optional(),
        recipientId: zId.optional(),
        amount: zAmount,
        frequency: z.enum(['monthly', 'weekly']),
        day: z.number().int(),
        endDate: z.string().max(10).optional(),
        payments: z.number().int().optional(),
        note: z.string().max(100).optional(),
        pin: zPin,
      }),
      req.body,
    )
    const order = await so.createStopOrder(ctx, req.user, body)
    reply.code(201)
    return order
  })
  app.put('/v1/stop-orders/:id', auth, async (req) => {
    const { status } = parse(z.object({ status: z.enum(['active', 'paused']) }), req.body)
    return so.setStopOrderStatus(ctx.db, req.user.id, idParam(req.params), status)
  })
  app.delete('/v1/stop-orders/:id', auth, async (req, reply) => {
    await so.cancelStopOrder(ctx.db, req.user.id, idParam(req.params))
    return noContent(reply)
  })
  app.get('/v1/stop-orders/:id/runs', auth, async (req) => so.stopOrderRuns(ctx.db, req.user.id, idParam(req.params)))
}
