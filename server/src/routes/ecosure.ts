// EcoSure mini app (/v1/ecosure) and its back office (/admin/v1/ecosure). Contract: shared/api.ts "EcoSure".
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { AdminEsCatalogue, EsClaimStatus, EsContent, EsPolicy, Page } from '../../../shared/api'
import type { Ctx } from '../context'
import { AppError, notFound } from '../errors'
import { authAdmin, authUser, parse, zAmount, zId, zPage, zPin } from '../http'
import { todayMaseru } from '../ecosure/account'
import { adminProducts, catalogue, ecosureContent } from '../ecosure/catalogue'
import { lastSync, type createCatalogueSync } from '../ecosure/sync'
import { adminClaims, claimDocumentUploadId, decideClaim, myClaims, submitClaim, type AdminClaim } from '../ecosure/claims'
import {
  addMember,
  buy,
  lookup,
  migratePolicy,
  myPayments,
  myPolicies,
  payPremium,
  policyRows,
  POLICY_STATUS_SQL,
  removeMember,
  toPolicies,
  updatePolicy,
} from '../ecosure/policies'
import { adminQuotes, createQuote, myQuotes, priceQuote, quoteDocumentUploadId, type AdminQuote } from '../ecosure/quotes'
import { changeSponsorship, createSponsorship, mySponsorships } from '../ecosure/sponsorships'
import { createUpload, readUpload, UPLOAD_BODY_LIMIT, UPLOAD_CONTENT_TYPES } from '../ecosure/uploads'
import { audit } from './admin'

const zCover = z.enum(['family', 'single'])
const zText = (max: number) => z.string().max(max)
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date like 2026-10-16')
const PAGE_SIZE = 25
const zPageSize = z.coerce.number().int().min(1).max(100).default(PAGE_SIZE)

export async function ecosureRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  const E = '/v1/ecosure'

  // The catalogue is public: the standalone EcoSure app shows cover and prices before sign-in (quotes need sign-in).
  app.get(`${E}/products`, async () => catalogue(ctx.db))
  app.get(`${E}/content`, async (): Promise<EsContent> => ecosureContent(ctx.db))

  // ---------- policies ----------
  app.get(`${E}/policies`, auth, async (req) => myPolicies(ctx.db, req.user))

  app.get(`${E}/policies/lookup`, auth, async (req) => {
    const { ref } = parse(z.object({ ref: z.string().trim().min(1).max(40) }), req.query)
    return lookup(ctx.db, ref)
  })

  app.post(`${E}/policies`, auth, async (req, reply) => {
    const body = parse(
      z.object({
        productCode: zText(40),
        cover: zCover,
        idNumber: zText(60),
        fullName: zText(120),
        dob: zDate,
        gender: z.enum(['female', 'male']),
        beneficiaryName: zText(120).optional(),
        beneficiaryMsisdn: zText(40).optional(),
        acceptedTerms: z.boolean(),
        pin: zPin,
      }),
      req.body,
    )
    reply.code(201)
    return buy(ctx, req.user, body)
  })

  app.patch(`${E}/policies/:id`, auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(
      z.object({ productCode: zText(40).optional(), beneficiaryName: zText(120).optional(), beneficiaryMsisdn: zText(40).optional() }),
      req.body,
    )
    return updatePolicy(ctx, req.user, id, body)
  })

  app.post(`${E}/policies/:id/migrate`, auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ cover: zCover }), req.body)
    return migratePolicy(ctx, req.user, id, body.cover)
  })

  app.post(`${E}/policies/:id/members`, auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(
      z.object({ name: zText(120), relationship: z.enum(['spouse', 'child', 'parent', 'extended']), dob: zDate.optional() }),
      req.body,
    )
    reply.code(201)
    return addMember(ctx, req.user, id, body)
  })

  app.delete(`${E}/policies/:id/members/:memberId`, auth, async (req) => {
    const { id, memberId } = parse(z.object({ id: zId, memberId: zId }), req.params)
    return removeMember(ctx, req.user, id, memberId)
  })

  // ---------- premiums ----------
  app.post(`${E}/payments`, auth, async (req) => {
    const body = parse(z.object({ policyNumber: zText(40), months: z.number().int().min(1).max(12).optional(), pin: zPin }), req.body)
    return payPremium(ctx, req.user, body)
  })

  app.get(`${E}/payments`, auth, async (req) => myPayments(ctx.db, req.user))

  // ---------- documents ----------
  app.post(`${E}/uploads`, { ...auth, bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
    const body = parse(z.object({ fileName: zText(255), contentType: z.enum(UPLOAD_CONTENT_TYPES), base64: z.string().min(1) }), req.body)
    reply.code(201)
    return createUpload(ctx.db, req.user, body)
  })

  // ---------- claims ----------
  app.post(`${E}/claims`, auth, async (req, reply) => {
    const body = parse(
      z.object({
        policyId: zId,
        memberId: zId,
        dateOfDeath: zDate,
        cause: z.enum(['natural', 'unnatural', 'undetermined']),
        documents: z.array(z.object({ label: zText(200), uploadId: zId })).max(20),
        pin: zPin,
      }),
      req.body,
    )
    reply.code(201)
    return submitClaim(ctx, req.user, body)
  })

  app.get(`${E}/claims`, auth, async (req) => myClaims(ctx.db, req.user))

  // ---------- quotes ----------
  app.post(`${E}/quotes`, auth, async (req, reply) => {
    const body = parse(
      z.object({
        productCode: zText(40),
        option: zText(80).optional(),
        answers: z.record(z.string().max(200), z.string().max(2000)).default({}),
        documents: z.record(z.string().max(200), zId).default({}),
        contactName: zText(120).optional(),
        msisdn: zText(40).optional(),
        consent: z.boolean(),
      }),
      req.body,
    )
    reply.code(201)
    return createQuote(ctx, req.user, body)
  })

  app.get(`${E}/quotes`, auth, async (req) => myQuotes(ctx.db, req.user))


  // ---------- sponsorships ----------
  app.get(`${E}/sponsorships`, auth, async (req) => mySponsorships(ctx.db, req.user))

  app.post(`${E}/sponsorships`, auth, async (req, reply) => {
    const body = parse(z.object({ msisdn: zText(40) }), req.body)
    reply.code(201)
    return createSponsorship(ctx, req.user, body.msisdn)
  })

  for (const action of ['accept', 'decline', 'cancel'] as const) {
    app.post(`${E}/sponsorships/:id/${action}`, auth, async (req) => {
      const { id } = parse(z.object({ id: zId }), req.params)
      return changeSponsorship(ctx, req.user, id, action)
    })
  }
}

async function sendUpload(ctx: Ctx, reply: FastifyReply, uploadId: string) {
  const file = await readUpload(ctx.db, uploadId)
  if (!file) throw notFound('Document not found')
  return reply
    .header('content-type', file.contentType)
    .header('content-disposition', `inline; filename="${file.fileName.replace(/[^\x20-\x7e]|"/g, '_')}"`)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .send(file.content)
}

export async function ecosureAdminRoutes(app: FastifyInstance, ctx: Ctx, sync: ReturnType<typeof createCatalogueSync>) {
  const auth = { preHandler: authAdmin(ctx) }
  const A = '/admin/v1/ecosure'
  const zLocalized = z.object({ en: z.string().trim().min(1).max(2000), st: z.string().trim().max(2000) })
  const catalogueNow = async (): Promise<AdminEsCatalogue> => ({ products: await adminProducts(ctx.db), content: await ecosureContent(ctx.db), sync: await lastSync(ctx.db) })

  // Catalogue: prices and cover terms come from EcoSure's package list; staff set the words around them.
  app.get(`${A}/catalogue`, auth, catalogueNow)

  app.post(`${A}/catalogue/sync`, auth, async (req) => {
    if (!sync.enabled) throw new AppError('VALIDATION', 'EcoSure package list is not connected (ECOSURE_PACKAGES_URL)')
    const r = await sync.sync()
    await audit(ctx.db, req.admin, 'ecosure.catalogue.sync', 'ecosure:catalogue', r ? `${r.ok ? 'ok' : 'failed'}, ${r.updated} changes` : '')
    return catalogueNow()
  })

  app.patch(`${A}/products/:code`, auth, async (req) => {
    const { code } = parse(z.object({ code: z.string().trim().toUpperCase().max(40) }), req.params)
    const body = parse(z.object({ tagline: zLocalized.nullable().optional(), popular: z.boolean().optional() }), req.body)
    await ctx.db.tx(async (q) => {
      const [p] = await q.query<{ line: string }>('SELECT line FROM ecosure_products WHERE code = $1', [code])
      if (!p) throw notFound(`No EcoSure product ${code}`)
      if (body.tagline !== undefined) await q.query('UPDATE ecosure_products SET tagline = $2 WHERE code = $1', [code, body.tagline ? JSON.stringify(body.tagline) : null])
      if (body.popular !== undefined) {
        // One "most popular" package per line.
        if (body.popular) await q.query('UPDATE ecosure_products SET popular = false WHERE line = $1', [p.line])
        await q.query('UPDATE ecosure_products SET popular = $2 WHERE code = $1', [code, body.popular])
      }
      await audit(q, req.admin, 'ecosure.product.text', `ecosure:${code}`, Object.keys(body).join(', '))
    })
    return catalogueNow()
  })

  app.put(`${A}/content`, auth, async (req) => {
    const body = parse(z.object({ terms: zLocalized, callCentre: z.string().trim().max(40).nullable() }), req.body)
    await ctx.db.tx(async (q) => {
      await q.query(
        `INSERT INTO ecosure_content (id, terms, call_centre, updated_at) VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET terms = $1, call_centre = $2, updated_at = now()`,
        [JSON.stringify(body.terms), body.callCentre || null],
      )
      await audit(q, req.admin, 'ecosure.content', 'ecosure:content')
    })
    return catalogueNow()
  })

  app.get(`${A}/policies`, auth, async (req): Promise<Page<EsPolicy>> => {
    const query = parse(
      z.object({
        query: z.string().trim().optional(),
        status: z.enum(['active', 'grace', 'lapsed', 'cancelled', '']).optional(),
        page: zPage,
        pageSize: zPageSize,
      }),
      req.query,
    )
    const term = query.query ? `%${query.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null
    const where = `($2::text IS NULL OR p.number ILIKE $2 OR p.full_name ILIKE $2 OR p.id_number ILIKE $2 OR u.msisdn LIKE $2 OR u.name ILIKE $2)
      AND ($3::text IS NULL OR ${POLICY_STATUS_SQL} = $3)`
    const params = [term, query.status || null]
    const [{ total }] = await ctx.db.query<{ total: number }>(
      `SELECT count(*) AS total FROM ecosure_policies p JOIN users u ON u.id = p.holder_id WHERE ${where}`,
      [todayMaseru(), ...params],
    )
    const rows = await policyRows(ctx.db, where, [...params, query.pageSize, (query.page - 1) * query.pageSize], 'ORDER BY p.created_at DESC, p.number DESC LIMIT $4 OFFSET $5')
    return { items: await toPolicies(ctx.db, rows), total, page: query.page, pageSize: query.pageSize }
  })

  app.get(`${A}/claims`, auth, async (req): Promise<Page<AdminClaim>> => {
    const query = parse(
      z.object({
        status: z.enum(['submitted', 'documents_verified', 'under_assessment', 'approved', 'rejected', '']).optional(),
        page: zPage,
        pageSize: zPageSize,
      }),
      req.query,
    )
    return adminClaims(ctx.db, (query.status || null) as EsClaimStatus | null, query.page, query.pageSize)
  })

  app.get(`${A}/claims/:id/documents/:index`, auth, async (req, reply) => {
    const { id, index } = parse(z.object({ id: zId, index: z.coerce.number().int().min(0).max(100) }), req.params)
    return sendUpload(ctx, reply, await claimDocumentUploadId(ctx.db, id, index))
  })

  app.post(`${A}/claims/:id/decision`, auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(
      z.object({
        action: z.enum(['verify_documents', 'start_assessment', 'approve', 'reject', 'request_info']),
        payout: zAmount.optional(),
        reason: zText(1000).optional(),
      }),
      req.body,
    )
    return ctx.tx(async (q, out) => {
      const { claim, detail } = await decideClaim(ctx, q, out, id, body)
      await audit(q, req.admin, `ecosure.claim.${body.action.replace(/_/g, '-')}`, `claim:${id}`, detail)
      return claim
    })
  })

  app.get(`${A}/quotes`, auth, async (req): Promise<Page<AdminQuote>> => {
    const query = parse(
      z.object({
        status: z.enum(['submitted', 'priced', 'accepted', 'expired', 'declined', '']).optional(),
        page: zPage,
        pageSize: zPageSize,
      }),
      req.query,
    )
    return adminQuotes(ctx.db, query.status || null, query.page, query.pageSize)
  })

  // Not in the contract: lets staff open a quote's documents while pricing it.
  app.get(`${A}/quotes/:reference/documents/:index`, auth, async (req, reply) => {
    const { reference, index } = parse(z.object({ reference: zId, index: z.coerce.number().int().min(0).max(100) }), req.params)
    return sendUpload(ctx, reply, await quoteDocumentUploadId(ctx.db, reference, index))
  })

  app.post(`${A}/quotes/:reference/price`, auth, async (req) => {
    const { reference } = parse(z.object({ reference: zId }), req.params)
    const body = parse(z.object({ monthlyPremium: zAmount }), req.body)
    return ctx.tx(async (q, out) => {
      const { quote, detail } = await priceQuote(q, out, reference, body.monthlyPremium)
      await audit(q, req.admin, 'ecosure.quote.price', `quote:${reference}`, detail)
      return quote
    })
  })
}
