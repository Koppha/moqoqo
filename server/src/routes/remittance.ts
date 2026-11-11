// Remittance (send money abroad): /v1/remit, /v1/remittances, and the portal's /admin/v1/remit, /admin/v1/remittances.
// Contract: shared/api.ts "remittance".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MAX_TRANSACTION, REMIT_PAYOUTS, type RemitPayout, type RemitSettings } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, authUser, parse, zAmount, zClientId, zPin } from '../http'
import { adminRemittances, getRemitSettings, listRemittances, publicRemitSettings, sendRemittance, setRemitSettings } from '../services/remittance'
import { audit } from './admin'

const zPayout = z.enum(REMIT_PAYOUTS as [RemitPayout, ...RemitPayout[]])

export async function remittanceRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  app.get('/v1/remit', auth, async (): Promise<RemitSettings> => publicRemitSettings(ctx.db))

  app.get('/v1/remittances', auth, async (req) => listRemittances(ctx.db, req.user))

  app.post('/v1/remittances', auth, async (req, reply) => {
    const body = parse(
      z.object({
        country: z.string().min(2).max(3),
        payout: zPayout,
        recipientName: z.string().max(200),
        recipientPhone: z.string().max(40).optional(),
        bankName: z.string().max(100).optional(),
        accountNumber: z.string().max(60).optional(),
        amount: zAmount,
        pin: zPin,
        clientId: zClientId,
      }),
      req.body,
    )
    reply.code(201)
    return sendRemittance(ctx, req.user, body)
  })
}

const zMoney = (field: string, max: number) =>
  z
    .number({ error: `${field} must be a number` })
    .min(0, `${field} can't be negative`)
    .max(max, `${field} can be at most ${max.toLocaleString('en')}`)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `${field} can have at most 2 decimals`)

const zCorridor = z.object({
  code: z.string().trim().regex(/^[A-Za-z]{2}$/, 'country code must be 2 letters (ISO), e.g. ZA'),
  country: z.string().trim().min(2, 'enter the country name').max(60),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'currency must be 3 letters (ISO), e.g. ZAR'),
  rate: z.number({ error: 'rate must be a number' }).gt(0, 'rate must be more than 0').max(100000),
  fee: zMoney('fee', 1000),
  feePercent: z.number({ error: 'fee % must be a number' }).min(0, "fee % can't be negative").max(20, 'fee % can be at most 20'),
  max: zMoney('max', MAX_TRANSACTION).refine((n) => n > 0, 'max must be more than 0'),
  payouts: z.array(zPayout).max(3),
  enabled: z.boolean(),
})

export async function remittanceAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/remit', auth, async (): Promise<RemitSettings> => getRemitSettings(ctx.db))

  app.put('/admin/v1/remit', auth, async (req): Promise<RemitSettings> => {
    const body: RemitSettings = parse(z.object({ dailyMax: zMoney('dailyMax', 1_000_000), corridors: z.array(zCorridor).max(50) }), req.body)
    const before = await getRemitSettings(ctx.db)
    return ctx.tx(async (q) => {
      const saved = await setRemitSettings(q, body)
      const was = new Map(before.corridors.map((c) => [c.code, JSON.stringify(c)]))
      const changed = saved.corridors.filter((c) => was.get(c.code) !== JSON.stringify(c)).map((c) => c.code)
      const removed = before.corridors.filter((c) => !saved.corridors.some((s) => s.code === c.code)).map((c) => `removed ${c.code}`)
      const daily = before.dailyMax !== saved.dailyMax ? [`dailyMax: ${before.dailyMax} → ${saved.dailyMax}`] : []
      await audit(q, req.admin, 'remit.update', 'remit', [...daily, ...changed, ...removed].join('; ') || 'no changes')
      return saved
    })
  })

  app.get('/admin/v1/remittances', auth, async () => adminRemittances(ctx.db))
}
