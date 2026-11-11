import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { notFound } from '../errors'
import { authAdmin, authUser, parse, zId } from '../http'
import { MINI_APP_ICON_IDS, MINI_APP_ICONS } from '../../../shared/api'
import { getBranding, readAsset, setBranding, setMiniAppIcon, setProfilePhoto, uploadAsset } from '../services/branding'
import { posterHtml } from '../services/poster'
import { buildStatement, statementHtml } from '../services/statement'
import { getUser, toMe } from '../services/users'
import { audit } from './admin'

export async function brandingRoutes(app: FastifyInstance, ctx: Ctx, onConfigChange: () => Promise<void>) {
  // Public: pictures in the apps (logo, service icons). Every upload has a new id, so they can be cached forever.
  app.get('/v1/assets/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const file = await readAsset(ctx.db, id)
    if (!file) throw notFound('Picture not found')
    reply.header('content-type', file.contentType).header('cache-control', 'public, max-age=31536000, immutable')
    return reply.send(file.content)
  })

  // Me › profile picture: anyone signed in sets or removes their own.
  app.put('/v1/me/photo', { preHandler: authUser(ctx), bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const body = parse(z.object({ contentType: z.enum(['image/png', 'image/jpeg']), base64: z.string().min(1) }), req.body)
    await ctx.tx((q) => setProfilePhoto(q, req.user.id, body))
    return toMe((await getUser(ctx.db, req.user.id))!)
  })
  app.delete('/v1/me/photo', { preHandler: authUser(ctx) }, async (req) => {
    await ctx.tx((q) => setProfilePhoto(q, req.user.id, null))
    return toMe((await getUser(ctx.db, req.user.id))!)
  })

  const auth = { preHandler: authAdmin(ctx), bodyLimit: 3 * 1024 * 1024 }

  app.post('/admin/v1/assets', auth, async (req, reply) => {
    const body = parse(
      z.object({ kind: z.enum(['logo', 'app_icon', 'service_icon', 'banner']), contentType: z.enum(['image/png', 'image/jpeg']), base64: z.string().min(1), fileName: z.string().max(200).optional() }),
      req.body,
    )
    const asset = await uploadAsset(ctx.db, req.admin.email, body)
    await audit(ctx.db, req.admin, 'asset.upload', `asset:${asset.id}`, `${body.kind}${body.fileName ? ` · ${body.fileName}` : ''}`)
    reply.code(201)
    return asset
  })

  app.get('/admin/v1/branding', { preHandler: authAdmin(ctx) }, async () => getBranding(ctx.db))

  app.put('/admin/v1/branding', { preHandler: authAdmin(ctx) }, async (req) => {
    const body = parse(z.object({ logoId: zId.nullable(), appIconId: zId.nullable() }), req.body)
    const branding = await setBranding(ctx.db, body)
    await audit(ctx.db, req.admin, 'branding.update', 'branding', `logo ${body.logoId ?? 'built-in'} · icon ${body.appIconId ?? 'built-in'}`)
    await onConfigChange()
    return branding
  })

  // A mini app's icon in EcoCash Super App (Home, Services) and inside the mini app; for EcoSure also the standalone app's.
  app.put('/admin/v1/branding/mini-apps/:id', { preHandler: authAdmin(ctx) }, async (req) => {
    const { id } = parse(z.object({ id: z.enum(MINI_APP_ICON_IDS as [string, ...string[]]) }), req.params)
    const { assetId } = parse(z.object({ assetId: zId.nullable() }), req.body)
    const appId = id as (typeof MINI_APP_ICON_IDS)[number]
    const branding = await setMiniAppIcon(ctx.db, appId, assetId)
    const name = MINI_APP_ICONS.find((a) => a.id === appId)?.name ?? appId
    await audit(ctx.db, req.admin, 'branding.mini_app_icon', `mini_app:${appId}`, `${name} icon ${assetId ?? 'built-in'}`)
    await onConfigChange()
    return branding
  })

  // Branded QR print-outs: staff for any merchant or agent, merchants and agents for themselves.
  const zSize = z.object({ size: z.enum(['a4', 'a5', 'a6']).default('a5') })
  app.get('/admin/v1/users/:id/poster', { preHandler: authAdmin(ctx) }, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const { size } = parse(zSize, req.query)
    const user = await getUser(ctx.db, id)
    if (!user) throw notFound('User not found')
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
    return reply.send(await posterHtml(ctx.db, user, size))
  })
  app.get('/v1/me/poster', { preHandler: authUser(ctx) }, async (req, reply) => {
    const { size } = parse(zSize, req.query)
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
    return reply.send(await posterHtml(ctx.db, req.user, size))
  })

  // Account statements (A4, printed or saved as PDF): customers for their own wallet, staff for anyone's.
  const zStatement = z.object({ from: z.string(), to: z.string(), lang: z.enum(['en', 'st']).default('en') })
  app.get('/v1/me/statement', { preHandler: authUser(ctx) }, async (req, reply) => {
    const { from, to, lang } = parse(zStatement, req.query)
    const html = await statementHtml(ctx.db, req.user, await buildStatement(ctx.db, req.user, from, to), lang)
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
    return reply.send(html)
  })
  app.get('/admin/v1/users/:id/statement', { preHandler: authAdmin(ctx) }, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const { from, to, lang } = parse(zStatement, req.query)
    const user = await getUser(ctx.db, id)
    if (!user) throw notFound('User not found')
    const html = await statementHtml(ctx.db, user, await buildStatement(ctx.db, user, from, to), lang)
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
    return reply.send(html)
  })
}
