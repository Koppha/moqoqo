import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authAdmin, parse, zId, zPage } from '../http'
import { close, listTickets, reply, stats, ticketDetail } from '../services/support'
import { audit } from './admin'

export async function supportAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/support/tickets', auth, async (req) => {
    const q = parse(
      z.object({ status: z.enum(['open', 'waiting', 'closed']).optional().or(z.literal('')), page: zPage, pageSize: z.coerce.number().int().min(1).max(100).default(20) }),
      req.query,
    )
    return listTickets(ctx.db, q.status || null, q.page, q.pageSize)
  })

  app.get('/admin/v1/support/tickets/:id', auth, async (req) => ticketDetail(ctx.db, parse(z.object({ id: zId }), req.params).id))

  app.post('/admin/v1/support/tickets/:id/reply', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body)
    const d = await reply(ctx, id, { email: req.admin.email, name: req.admin.name }, text)
    await audit(ctx.db, req.admin, 'support.reply', `ticket:${id}`, d.reference)
    return d
  })

  app.post('/admin/v1/support/tickets/:id/close', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const d = await close(ctx, id)
    await audit(ctx.db, req.admin, 'support.close', `ticket:${id}`, d.reference)
    return d
  })

  app.get('/admin/v1/support/stats', auth, async (req) => stats(ctx.db, parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query).days))
}
