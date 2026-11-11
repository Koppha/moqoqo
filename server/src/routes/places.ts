// Places on the map, app feedback and contact details. Contract: shared/api.ts "Places" and "Feedback, Contact us".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PLACE_KINDS, type FeedbackBody, type PlaceBody } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, authUser, noContent, parse, zId } from '../http'
import { getContactSettings, leaveFeedback, listFeedback, setContactSettings } from '../services/feedback'
import { createPlace, deletePlace, listPlaces, updatePlace } from '../services/places'
import { audit } from './admin'

const zPlace = z.object({
  kind: z.enum(PLACE_KINDS as [string, ...string[]]),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(200),
  lat: z.number().finite(),
  lng: z.number().finite(),
  hours: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  code: z.string().max(30).optional(),
  enabled: z.boolean(),
})

export async function placesRoutes(app: FastifyInstance, ctx: Ctx, configChanged: () => Promise<void>) {
  const admin = { preHandler: authAdmin(ctx) }

  // The apps: where to find an agent, a merchant or an ATM. Public, like the services list.
  app.get('/v1/places', async () => listPlaces(ctx.db))

  app.get('/admin/v1/places', admin, async () => listPlaces(ctx.db, true))
  app.post('/admin/v1/places', admin, async (req, reply) => {
    const body = parse(zPlace, req.body) as PlaceBody
    const place = await ctx.tx(async (q) => {
      const p = await createPlace(q, body, req.admin.email)
      await audit(q, req.admin, 'place.create', `place:${p.id}`, `${p.kind} · ${p.name}`)
      return p
    })
    reply.code(201)
    return place
  })
  app.put('/admin/v1/places/:id', admin, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(zPlace, req.body) as PlaceBody
    return ctx.tx(async (q) => {
      const p = await updatePlace(q, id, body)
      await audit(q, req.admin, 'place.update', `place:${p.id}`, `${p.kind} · ${p.name}${p.enabled ? '' : ' (hidden)'}`)
      return p
    })
  })
  app.delete('/admin/v1/places/:id', admin, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await ctx.tx(async (q) => {
      const p = await deletePlace(q, id)
      await audit(q, req.admin, 'place.delete', `place:${p.id}`, `${p.kind} · ${p.name}`)
    })
    return noContent(reply)
  })

  // Me › Leave feedback.
  app.post('/v1/feedback', { preHandler: authUser(ctx) }, async (req, reply) => {
    const body = parse(
      z.object({
        rating: z.number().int().min(1).max(5),
        text: z.string().max(2000).optional(),
        app: z.enum(['customer', 'business', 'ecosure', 'society']),
        appVersion: z.string().max(40).optional(),
      }),
      req.body,
    ) as FeedbackBody
    await leaveFeedback(ctx.db, req.user.id, body)
    reply.code(201)
    return { ok: true }
  })
  app.get('/admin/v1/feedback', admin, async () => listFeedback(ctx.db))

  // Me › Contact us and Share the app.
  app.get('/admin/v1/contact-settings', admin, async () => getContactSettings(ctx.db))
  app.put('/admin/v1/contact-settings', admin, async (req) => {
    const body = parse(
      z.object({ phone: z.string().max(30), whatsapp: z.string().max(30), email: z.string().max(120), website: z.string().max(200), shareLink: z.string().max(300) }),
      req.body,
    )
    const saved = await ctx.tx(async (q) => {
      const s = await setContactSettings(q, body)
      await audit(q, req.admin, 'contact.update', 'contact', `${s.phone} · ${s.email}`)
      return s
    })
    await configChanged()
    return saved
  })
}
