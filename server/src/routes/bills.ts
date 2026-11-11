// Pay bill categories (Econet, LEC, MultiChoice, WASCO, Insurance, …), managed in the portal. The billers in them are
// services with a `category`. Contract: shared/api.ts "Pay bill".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { BillCategory, LocalizedText } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { conflict, notFound } from '../errors'
import { authAdmin, authUser, noContent, parse } from '../http'
import { checkServiceImage } from '../services/branding'
import { audit } from './admin'

interface CategoryRow { id: string; name: LocalizedText; icon: string; color: string; image: string | null; sort: number; enabled: boolean }

const toCategory = (r: CategoryRow): BillCategory => ({
  id: r.id, name: r.name, icon: r.icon, color: r.color, sort: r.sort, enabled: r.enabled, ...(r.image ? { image: r.image } : {}),
})

export async function listBillCategories(q: Queryable, enabledOnly: boolean): Promise<BillCategory[]> {
  const rows = await q.query<CategoryRow>(`SELECT * FROM bill_categories WHERE ($1::boolean IS FALSE OR enabled) ORDER BY sort, id`, [enabledOnly])
  return rows.map(toCategory)
}

const zText = z.object({ en: z.string().trim().min(1).max(40), st: z.string().trim().min(1).max(40) })
const zCategory = z.object({
  name: zText,
  icon: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'icon: an Ionicons name like flash'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color: like #16A34A'),
  image: z.string().max(200).optional(),
  sort: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
})
const zCategoryId = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, 'id: lowercase letters, digits and -, like "insurance"')

export async function billRoutes(app: FastifyInstance, ctx: Ctx) {
  const admin = { preHandler: authAdmin(ctx) }

  app.get('/v1/bill-categories', { preHandler: authUser(ctx) }, async () => listBillCategories(ctx.db, true))

  app.get('/admin/v1/bill-categories', admin, async () => listBillCategories(ctx.db, false))

  app.post('/admin/v1/bill-categories', admin, async (req, reply) => {
    const body = parse(zCategory.extend({ id: zCategoryId }), req.body)
    await checkServiceImage(ctx.db, body.image)
    const made = await ctx.tx(async (q) => {
      const [taken] = await q.query('SELECT 1 FROM bill_categories WHERE id = $1', [body.id])
      if (taken) throw conflict(`There is already a category "${body.id}"`)
      const [r] = await q.query<CategoryRow>(
        'INSERT INTO bill_categories (id, name, icon, color, image, sort, enabled) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [body.id, JSON.stringify(body.name), body.icon, body.color, body.image ?? null, body.sort, body.enabled],
      )
      await audit(q, req.admin, 'bill_category.create', `bill_category:${body.id}`, body.name.en)
      return toCategory(r)
    })
    reply.code(201)
    return made
  })

  app.put('/admin/v1/bill-categories/:id', admin, async (req) => {
    const { id } = parse(z.object({ id: zCategoryId }), req.params)
    const body = parse(zCategory, req.body)
    await checkServiceImage(ctx.db, body.image)
    return ctx.tx(async (q) => {
      const [r] = await q.query<CategoryRow>(
        'UPDATE bill_categories SET name = $2, icon = $3, color = $4, image = $5, sort = $6, enabled = $7, updated_at = now() WHERE id = $1 RETURNING *',
        [id, JSON.stringify(body.name), body.icon, body.color, body.image ?? null, body.sort, body.enabled],
      )
      if (!r) throw notFound('Category not found')
      await audit(q, req.admin, 'bill_category.update', `bill_category:${id}`, `${body.name.en}${body.enabled ? '' : ' (hidden)'}`)
      return toCategory(r)
    })
  })

  // Only an empty category goes: move or remove its billers first (they'd vanish from Pay bill otherwise).
  app.delete('/admin/v1/bill-categories/:id', admin, async (req, reply) => {
    const { id } = parse(z.object({ id: zCategoryId }), req.params)
    await ctx.tx(async (q) => {
      const [{ n }] = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM services WHERE category = $1', [id])
      if (n > 0) throw conflict(`${n} biller${n === 1 ? ' is' : 's are'} still in this category. Move or remove them first`)
      const [r] = await q.query<CategoryRow>('DELETE FROM bill_categories WHERE id = $1 RETURNING *', [id])
      if (!r) throw notFound('Category not found')
      await audit(q, req.admin, 'bill_category.delete', `bill_category:${id}`, r.name.en)
    })
    return noContent(reply)
  })
}
