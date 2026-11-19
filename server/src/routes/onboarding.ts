import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authAdmin, authUser, parse, zId } from '../http'
import { listDevices, confirm, identity, resend, setPin, startProfile, unbind, verify, zDevice, zNetwork } from '../services/onboarding'
import { audit } from './admin'

export async function onboardingRoutes(app: FastifyInstance, ctx: Ctx) {
  const params = (req: { params: unknown }) => parse(z.object({ id: zId }), req.params).id

  app.post('/v1/onboarding/:id/identity', async (req) => {
    const body = parse(z.object({ idNumber: z.string().min(1).max(30) }), req.body)
    return identity(ctx, params(req), body.idNumber)
  })

  app.post('/v1/onboarding/:id/confirm', async (req) => {
    const body = parse(
      z.object({ nameConfirmed: z.boolean(), dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'), gender: z.enum(['female', 'male']) }),
      req.body,
    )
    return confirm(ctx, params(req), body)
  })

  app.post('/v1/onboarding/:id/resend', async (req) => resend(ctx, params(req)))

  app.post('/v1/onboarding/:id/verify', async (req) => {
    const body = parse(z.object({ otp: z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits'), acceptTerms: z.boolean().optional() }), req.body)
    return verify(ctx, params(req), body.otp, body.acceptTerms === true)
  })

  // The standalone EcoSure app: create an EcoSure profile with the person's own PIN (or reset a forgotten one).
  app.post('/v1/ecosure/profile', async (req, reply) => {
    const body = parse(z.object({ msisdn: z.string().max(30), device: zDevice, network: zNetwork }), req.body)
    reply.code(201)
    return startProfile(ctx, body.msisdn, body.device, body.network)
  })

  app.post('/v1/onboarding/:id/pin', async (req) => {
    const body = parse(z.object({ pin: z.string() }), req.body)
    return setPin(ctx, params(req), body.pin)
  })

  app.get('/v1/me/devices', { preHandler: authUser(ctx) }, async (req) => listDevices(ctx.db, req.user.id, req.boundDeviceId))
}

export async function onboardingAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/users/:id/devices', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return listDevices(ctx.db, id, null, true)
  })

  app.post('/admin/v1/users/:id/devices/:deviceId/unbind', auth, async (req) => {
    const { id, deviceId } = parse(z.object({ id: zId, deviceId: zId }), req.params)
    await unbind(ctx, id, deviceId)
    await audit(ctx.db, req.admin, 'device.unbind', `user:${id}`, `device:${deviceId}`)
    return listDevices(ctx.db, id, null, true)
  })
}
