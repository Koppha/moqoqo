import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HOME_SECTIONS, type HomeLayout, type OfferBody } from '../../../shared/api'
import type { Ctx } from '../context'
import { notFound } from '../errors'
import { authAdmin, authUser, noContent, parse, zId } from '../http'
import { broadcast, getLayout, homeContent, listBroadcasts, listOffers, offersFor, saveOffer, setLayout, zOffer } from '../services/home'
import { audit } from './admin'

export async function homeRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  app.get('/v1/home', auth, async (req) => homeContent(ctx.db, req.user))
  app.get('/v1/news', auth, async (req) => offersFor(ctx.db, req.user, 'news'))

  const admin = { preHandler: authAdmin(ctx) }
  app.get('/admin/v1/offers', admin, async () => listOffers(ctx.db))
  app.post('/admin/v1/offers', admin, async (req, reply) => {
    const body = parse(zOffer, req.body) as OfferBody
    const o = await saveOffer(ctx.db, null, body)
    await audit(ctx.db, req.admin, 'offer.create', `offer:${o.id}`, o.title.en)
    reply.code(201)
    return o
  })
  app.put('/admin/v1/offers/:id', admin, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const o = await saveOffer(ctx.db, id, parse(zOffer, req.body) as OfferBody)
    await audit(ctx.db, req.admin, 'offer.update', `offer:${id}`, `${o.title.en}${o.enabled ? '' : ' (off)'}`)
    return o
  })
  app.delete('/admin/v1/offers/:id', admin, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const [r] = await ctx.db.query<{ title: { en: string } }>('DELETE FROM offers WHERE id = $1 RETURNING title', [id])
    if (!r) throw notFound('Offer not found')
    await audit(ctx.db, req.admin, 'offer.delete', `offer:${id}`, r.title.en)
    return noContent(reply)
  })

  app.get('/admin/v1/home-layout', admin, async () => getLayout(ctx.db))
  app.put('/admin/v1/home-layout', admin, async (req) => {
    const body = parse(z.object({ sections: z.array(z.object({ key: z.enum(HOME_SECTIONS as [string, ...string[]]), visible: z.boolean() })).max(10) }), req.body) as HomeLayout
    const saved = await setLayout(ctx.db, body)
    await audit(ctx.db, req.admin, 'home.layout', 'home', saved.sections.map((s) => `${s.key}${s.visible ? '' : ' (hidden)'}`).join(', '))
    return saved
  })

  app.get('/admin/v1/broadcasts', admin, async () => listBroadcasts(ctx.db))
  app.post('/admin/v1/broadcasts', admin, async (req, reply) => {
    const body = parse(
      z.object({
        text: z.object({ en: z.string().trim().min(1).max(1000), st: z.string().trim().max(1000) }),
        audience: z.enum(['all', 'customers', 'business', 'tier1', 'tier2']),
        sms: z.boolean(),
      }),
      req.body,
    )
    const b = await broadcast(ctx, req.admin.email, body)
    await audit(ctx.db, req.admin, 'broadcast.send', `broadcast:${b.id}`, `${b.audience} · ${b.recipients} people${b.sms ? ' · SMS' : ''}`)
    reply.code(201)
    return b
  })
}
