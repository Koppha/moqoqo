// Money in and out: card → wallet top-ups (/v1/cards, /v1/topups), wallet → bank (/v1/banks, /v1/bank-accounts,
// /v1/bank-transfers), and the tariff (/v1/tariff, /admin/v1/tariff). Contract: shared/api.ts "money in and out".
import type { FastifyInstance } from 'fastify'
import { ATM_NOTE, MAX_TRANSACTION, type Bank, type Tariff } from '../../../shared/api'
import { z } from 'zod'
import type { Ctx } from '../context'
import { validation } from '../errors'
import { authAdmin, authUser, noContent, parse, zAmount, zClientId, zId, zPin } from '../http'
import { addCard, confirmTopup, listCards, removeCard, startTopup } from '../services/cards'
import { listAccounts, lookupAccount, removeAccount, sendToBank } from '../services/banking'
import { setSetting } from '../services/maintenance'
import { getTariff } from '../services/tariff'
import { audit } from './admin'

export async function cardBankRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  app.get('/v1/tariff', auth, async (): Promise<Tariff> => getTariff(ctx.db))

  // ---------- cards ----------
  app.get('/v1/cards', auth, async (req) => listCards(ctx.db, req.user))

  app.post('/v1/cards', auth, async (req, reply) => {
    const body = parse(
      z.object({
        number: z.string().max(40),
        expMonth: z.number().int(),
        expYear: z.number().int(),
        cvv: z.string().max(10),
        holderName: z.string().max(200),
      }),
      req.body,
    )
    reply.code(201)
    return addCard(ctx, req.user, body)
  })

  app.delete('/v1/cards/:id', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await removeCard(ctx.db, req.user, id)
    return noContent(reply)
  })

  // ---------- top-ups ----------
  app.post('/v1/topups', auth, async (req, reply) => {
    const body = parse(z.object({ cardId: zId, amount: zAmount, pin: zPin, clientId: zClientId }), req.body)
    const { start, created } = await startTopup(ctx, req.user, body)
    reply.code(created ? 201 : 200)
    return start
  })

  app.post('/v1/topups/:id/confirm', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ otp: z.string().trim().min(1, 'Enter the code').max(12) }), req.body)
    return confirmTopup(ctx, req.user, id, body.otp)
  })

  // ---------- banks ----------
  app.get('/v1/banks', auth, async (): Promise<Bank[]> => ctx.banks.banks())

  app.get('/v1/banks/lookup', auth, async (req) => {
    const query = parse(z.object({ bank: z.string().max(10), account: z.string().max(40) }), req.query)
    return lookupAccount(ctx, query.bank, query.account)
  })

  app.get('/v1/bank-accounts', auth, async (req) => listAccounts(ctx.db, req.user))

  app.delete('/v1/bank-accounts/:id', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await removeAccount(ctx.db, req.user, id)
    return noContent(reply)
  })

  app.post('/v1/bank-transfers', auth, async (req, reply) => {
    const body = parse(
      z.object({
        bankCode: z.string().max(10),
        accountNumber: z.string().max(40),
        amount: zAmount,
        pin: zPin,
        clientId: zClientId,
        save: z.boolean().optional(),
      }),
      req.body,
    )
    reply.code(201)
    return sendToBank(ctx, req.user, body)
  })
}

const zMoney = (field: string, max?: number) =>
  z
    .number({ error: 'must be a number' })
    
    .min(0, `${field} can't be negative`)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `${field} can have at most 2 decimals`)
    .refine((n) => max === undefined || n <= max, `${field} can be at most M${(max ?? 0).toLocaleString('en')}`)

export async function cardBankAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/tariff', auth, async (): Promise<Tariff> => getTariff(ctx.db))

  app.put('/admin/v1/tariff', auth, async (req): Promise<Tariff> => {
    const body = parse(
      z.object({
        cardTopupFeePercent: z
          .number({ error: 'must be a number' })
          .min(0, "cardTopupFeePercent can't be negative")
          .max(20, 'cardTopupFeePercent can be at most 20'),
        cardTopupFeeMin: zMoney('cardTopupFeeMin', MAX_TRANSACTION),
        cardTopupMax: zMoney('cardTopupMax', MAX_TRANSACTION),
        bankTransferFee: zMoney('bankTransferFee', MAX_TRANSACTION),
        bankTransferMax: zMoney('bankTransferMax', MAX_TRANSACTION),
        dailyMax: zMoney('dailyMax', 1_000_000),
        atmFee: zMoney('atmFee', 1000),
        atmMax: zMoney('atmMax', MAX_TRANSACTION).refine((n) => n % ATM_NOTE === 0, `atmMax must be a multiple of M${ATM_NOTE}`),
      }),
      req.body,
    )
    if (body.dailyMax < Math.max(body.cardTopupMax, body.bankTransferMax)) {
      throw validation('dailyMax must be at least the per-transaction maximums')
    }
    const before = await getTariff(ctx.db)
    await ctx.tx(async (q) => {
      await setSetting(q, 'tariff', body)
      const changes = (Object.keys(body) as (keyof Tariff)[])
        .filter((k) => body[k] !== before[k])
        .map((k) => `${k}: ${before[k]} → ${body[k]}`)
      await audit(q, req.admin, 'tariff.update', 'tariff', changes.join('; ') || 'no changes')
    })
    return getTariff(ctx.db)
  })
}
