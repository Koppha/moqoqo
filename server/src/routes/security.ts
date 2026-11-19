// Security self-service and the sign-in log (CBL/LCA DFS guidelines). Contract: shared/api.ts "security".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authAdmin, authUser, noContent, parse, zId, zPin } from '../http'
import { authMonitor } from '../services/authAnalysis'
import { listAuthEvents } from '../services/authLog'
import { disablePayBiometric, enablePayBiometric, removeOwnDevice, reportLostPhone } from '../services/security'

export async function securityRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  // Fingerprint/face for payments on this phone: the wallet PIN once, then a token the phone keeps behind its biometrics.
  app.post('/v1/me/pay-biometric', auth, async (req) => {
    const { pin } = parse(z.object({ pin: zPin }), req.body)
    return enablePayBiometric(ctx, req.user, req.boundDeviceId, pin, req.ip)
  })
  app.delete('/v1/me/pay-biometric', auth, async (req, reply) => {
    await disablePayBiometric(ctx, req.user, req.boundDeviceId, req.ip)
    return noContent(reply)
  })

  // Me › Phones: sign another of my phones out.
  app.delete('/v1/me/devices/:id', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return removeOwnDevice(ctx, req.user, req.boundDeviceId, id, req.ip)
  })

  // Login screen › Lost your phone? (no session: the wallet PIN proves ownership; PIN lockout applies)
  app.post('/v1/auth/report-lost', async (req) => {
    const body = parse(z.object({ msisdn: z.string().max(30), pin: zPin }), req.body)
    return reportLostPhone(ctx, body, req.ip)
  })

  app.get('/admin/v1/auth-monitor', { preHandler: authAdmin(ctx) }, async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), req.query)
    return authMonitor(ctx.db, days)
  })

  app.get('/admin/v1/users/:id/auth-events', { preHandler: authAdmin(ctx) }, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return listAuthEvents(ctx.db, id)
  })
}
