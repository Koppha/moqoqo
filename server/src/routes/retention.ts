// Portal API: Retention (agent & merchant churn risk). Reads for all staff; follow-ups and "score now" need the
// admin role (enforced by authAdmin for writes) and go in the audit log. Contract: shared/api.ts "retention".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ChurnBand, ChurnFollowupStatus } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, parse, zId, zPage } from '../http'
import { churnDetail, listChurn, runChurnScoring, setFollowup } from '../services/churn'
import { audit } from './admin'

export async function retentionRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/churn', auth, async (req) => {
    const q = parse(
      z.object({
        role: z.enum(['agent', 'merchant', '']).optional(),
        band: z.enum(['high', 'medium', 'low', 'quiet', '']).optional(),
        followup: z.enum(['new', 'contacted', 'retained', 'lost', '']).optional(),
        q: z.string().max(60).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    )
    return listChurn(
      ctx.db,
      { role: q.role || null, band: (q.band || null) as ChurnBand | null, followup: (q.followup || null) as ChurnFollowupStatus | null, query: q.q || null },
      q.page,
      q.pageSize,
    )
  })

  app.get('/admin/v1/churn/:userId', auth, async (req) => {
    const { userId } = parse(z.object({ userId: zId }), req.params)
    return churnDetail(ctx.db, userId)
  })

  app.put('/admin/v1/churn/:userId/followup', auth, async (req) => {
    const { userId } = parse(z.object({ userId: zId }), req.params)
    const body = parse(z.object({ status: z.enum(['new', 'contacted', 'retained', 'lost']), note: z.string().max(1000) }), req.body)
    const row = await ctx.db.tx((q) => setFollowup(q, userId, body, req.admin.email))
    await audit(ctx.db, req.admin, 'churn.followup', `user:${userId}`, `${body.status}${body.note.trim() ? ` · ${body.note.trim()}` : ''}`)
    return row
  })

  app.post('/admin/v1/churn/run', auth, async (req) => {
    const scored = await runChurnScoring(ctx)
    await audit(ctx.db, req.admin, 'churn.run', 'model:churn_risk', `${scored} scored`)
    return { scored }
  })
}
