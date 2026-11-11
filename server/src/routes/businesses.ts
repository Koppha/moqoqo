// EcoCash Business as a mini app: /v1/businesses…. Contract: shared/api.ts "EcoCash Business as a mini app".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authUser, noContent, parse, zId, zPin } from '../http'
import { linkBusiness, myBusinesses, openBusiness, unlinkBusiness } from '../services/businesses'

export async function businessRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  const idParam = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/v1/businesses', auth, async (req) => myBusinesses(ctx.db, req.user))
  app.post('/v1/businesses/link', auth, async (req, reply) => {
    const body = parse(z.object({ msisdn: z.string().max(20), pin: zPin }), req.body)
    reply.code(201)
    return linkBusiness(ctx, req.user, req.sessionApp, body)
  })
  app.delete('/v1/businesses/:id', auth, async (req, reply) => {
    await unlinkBusiness(ctx, req.user, idParam(req.params))
    return noContent(reply)
  })
  app.post('/v1/businesses/:id/open', auth, async (req) => openBusiness(ctx, req.user, req.sessionApp, req.boundDeviceId, idParam(req.params)))
}
