// Portal API: Channel map (every agent and merchant on a staff map). Reads for all staff; setting a location needs
// the admin role (authAdmin) and goes in the audit log. Contract: shared/api.ts "channel map".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authAdmin, noContent, parse, zId } from '../http'
import { channelMap, clearChannelLocation, setChannelLocation } from '../services/channelMap'
import { audit } from './admin'

export async function channelMapRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/channel-map', auth, async () => channelMap(ctx.db))

  app.put('/admin/v1/channel-map/:userId/location', auth, async (req) => {
    const { userId } = parse(z.object({ userId: zId }), req.params)
    const body = parse(z.object({ lat: z.number().finite(), lng: z.number().finite(), address: z.string().max(200).optional() }), req.body)
    const u = await ctx.db.tx((q) => setChannelLocation(q, userId, body, req.admin.email))
    await audit(ctx.db, req.admin, 'channel.location', `user:${userId}`, `${body.lat.toFixed(5)}, ${body.lng.toFixed(5)}${body.address ? ` · ${body.address}` : ''}`)
    return u
  })

  app.delete('/admin/v1/channel-map/:userId/location', auth, async (req, reply) => {
    const { userId } = parse(z.object({ userId: zId }), req.params)
    await ctx.db.tx((q) => clearChannelLocation(q, userId))
    await audit(ctx.db, req.admin, 'channel.location.clear', `user:${userId}`)
    return noContent(reply)
  })
}
