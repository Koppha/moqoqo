// USSD fallback settings: GET/PUT /admin/v1/ussd-settings. The apps get them in AppConfig. Contract: shared/api.ts "USSD fallback".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { USSD_FUNCTIONS, type UssdSettings } from '../../../shared/api'
import type { Ctx } from '../context'
import { authAdmin, parse } from '../http'
import { getUssdSettings, setUssdSettings } from '../services/ussd'
import { audit } from './admin'

const zFn = z.object({
  enabled: z.boolean(),
  shortcut: z.string().max(100),
  steps: z.object({ en: z.string().max(300), st: z.string().max(300) }),
})

export async function ussdRoutes(app: FastifyInstance, ctx: Ctx, configChanged: () => Promise<void>) {
  const auth = { preHandler: authAdmin(ctx) }
  app.get('/admin/v1/ussd-settings', auth, async () => getUssdSettings(ctx.db))
  app.put('/admin/v1/ussd-settings', auth, async (req): Promise<UssdSettings> => {
    const body = parse(
      z.object({ enabled: z.boolean(), code: z.string().max(40), functions: z.object(Object.fromEntries(USSD_FUNCTIONS.map((f) => [f, zFn]))) }),
      req.body,
    ) as UssdSettings
    const before = await getUssdSettings(ctx.db)
    const saved = await ctx.tx(async (q) => {
      const s = await setUssdSettings(q, body)
      const changes = [
        before.enabled !== s.enabled ? `enabled: ${before.enabled} → ${s.enabled}` : null,
        before.code !== s.code ? `code: ${before.code} → ${s.code}` : null,
        ...USSD_FUNCTIONS.map((f) => (JSON.stringify(before.functions[f]) !== JSON.stringify(s.functions[f]) ? `${f} changed` : null)),
      ].filter(Boolean)
      await audit(q, req.admin, 'ussd.update', 'ussd', changes.join('; ') || 'no changes')
      return s
    })
    // The apps keep the copy they get now, for when they have no internet.
    await configChanged()
    return saved
  })
}
