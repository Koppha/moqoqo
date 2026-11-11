// Split bill approval and collection: /v1/splits/:id/approve, /resolve, /cancel, /v1/split-settings, and the portal's
// /admin/v1/split-settings. Creating and listing splits, paying now and declining live in v1.ts.
// Contract: shared/api.ts (ApproveShareBody, ResolveShareBody, CancelSplitBody, SplitSettings).
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { SplitSettings } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, authUser, parse, zAmount, zId, zPin } from '../http'
import { approveShare, cancelSplit, getSplitSettings, resolveShare, setSplitSettings } from '../services/splits'
import { audit } from './admin'

export async function splitRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  app.get('/v1/split-settings', auth, async (): Promise<SplitSettings> => getSplitSettings(ctx.db))

  app.post('/v1/splits/:id/approve', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ pin: zPin, amount: zAmount.optional() }), req.body)
    return approveShare(ctx, req.user, id, body)
  })

  app.post('/v1/splits/:id/shares/:userId/resolve', auth, async (req) => {
    const { id, userId } = parse(z.object({ id: zId, userId: zId }), req.params)
    const body = parse(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('reassign'), userId: zId }),
        z.object({ action: z.literal('cover'), pin: zPin.optional() }),
      ]),
      req.body,
    )
    return resolveShare(ctx, req.user, id, userId, body)
  })

  app.post('/v1/splits/:id/cancel', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ pin: zPin, refund: z.boolean().optional() }), req.body)
    return cancelSplit(ctx, req.user, id, body)
  })
}

const zLimit = (max: number) => z.number().min(0).max(max)

export async function splitAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/split-settings', auth, async (): Promise<SplitSettings> => getSplitSettings(ctx.db))

  app.put('/admin/v1/split-settings', auth, async (req): Promise<SplitSettings> => {
    const body: SplitSettings = parse(
      z.object({
        approvalHours: zLimit(24 * 30),
        reminderHours: z.array(zLimit(24 * 30)).max(5),
        collectionDays: zLimit(365),
        maxShare: zLimit(100_000),
        maxShareTier1: zLimit(100_000),
        maxOpenOwed: zLimit(1_000_000),
        maxParticipants: z.number().int().min(2).max(256),
        balanceFloor: zLimit(10_000),
        merchantDirect: z.boolean(),
      }),
      req.body,
    )
    const before = await getSplitSettings(ctx.db)
    return ctx.tx(async (q) => {
      const saved = await setSplitSettings(q, body)
      const changes = (Object.keys(saved) as (keyof SplitSettings)[])
        .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(saved[k]))
        .map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(saved[k])}`)
      await audit(q, req.admin, 'split.update', 'split', changes.join('; ') || 'no changes')
      return saved
    })
  })
}
