// Portal API: AI governance (models, versions, decisions) and financial crime cases. Writes need the admin role
// (support staff read only, enforced by authAdmin) and every write is in the audit log.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AiModelKey, AiOutcome, CasePriority, CaseStatus } from '../../../shared/api'
import type { Ctx } from '../context'
import { AppError } from '../errors'
import { authAdmin, parse, zId, zPage } from '../http'
import { listDecisions, listModels, modelVersions, setModel, type ConfigurableModel } from '../services/ai'
import { caseStats, closeCase, fileStr, freezeCase, getCase, listCases, openCaseManually, summariseCase, updateCase } from '../services/cases'
import { audit } from './admin'

const CONFIGURABLE = ['fraud_score', 'aml_surveillance', 'case_summary', 'churn_risk'] as const
const zNote = z.string().max(2000)

export async function aiRiskRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  // ---------- AI governance ----------
  app.get('/admin/v1/ai/models', auth, async () => listModels(ctx))
  app.get('/admin/v1/ai/models/:key/versions', auth, async (req) => {
    const { key } = parse(z.object({ key: z.enum(CONFIGURABLE) }), req.params)
    return modelVersions(ctx.db, key)
  })
  app.put('/admin/v1/ai/models/:key', auth, async (req) => {
    const { key } = parse(z.object({ key: z.enum(CONFIGURABLE) }), req.params)
    const body = parse(
      z.object({ mode: z.enum(['off', 'shadow', 'active']), params: z.record(z.string(), z.number()), note: zNote.min(3, 'Say why you are changing it') }),
      req.body,
    )
    await setModel(ctx.db, key as ConfigurableModel, body, req.admin.email)
    const m = (await listModels(ctx)).find((x) => x.key === key)!
    await audit(ctx.db, req.admin, 'ai.model', `model:${key}`, `v${m.version} ${m.mode} ${JSON.stringify(m.params)} · ${body.note}`)
    return m
  })
  app.get('/admin/v1/ai/decisions', auth, async (req) => {
    const q = parse(
      z.object({
        model: z.enum(['fraud_score', 'aml_surveillance', 'case_summary', 'churn_risk', 'assistant', '']).optional(),
        outcome: z.enum(['allow', 'flag', 'block', 'info', '']).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    )
    return listDecisions(ctx.db, { model: (q.model || null) as AiModelKey | null, outcome: (q.outcome || null) as AiOutcome | null }, q.page, q.pageSize)
  })

  // ---------- financial crime cases ----------
  app.get('/admin/v1/cases', auth, async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['active', 'open', 'investigating', 'escalated', 'closed_fraud', 'closed_ok', '']).optional(),
        priority: z.enum(['high', 'medium', 'low', '']).optional(),
        mine: z.enum(['1', '0', '']).optional(),
        page: zPage,
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    )
    return listCases(
      ctx.db,
      { status: (q.status || null) as CaseStatus | 'active' | null, priority: (q.priority || null) as CasePriority | null, assignedTo: q.mine === '1' ? req.admin.email : null },
      q.page,
      q.pageSize,
    )
  })
  app.get('/admin/v1/cases/stats', auth, async () => caseStats(ctx.db))
  app.post('/admin/v1/cases', auth, async (req) => {
    const body = parse(z.object({ msisdn: z.string().min(8).max(20), title: z.string().trim().min(3).max(200), note: zNote }), req.body)
    const id = await ctx.db.tx((q) => openCaseManually(q, body.msisdn.replace(/\s+/g, ''), body.title, body.note, req.admin.email))
    const c = await getCase(ctx.db, id)
    await audit(ctx.db, req.admin, 'case.open', `case:${c.ref}`, `user:${c.user.id} · ${body.title}`)
    return c
  })
  app.get('/admin/v1/cases/:id', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return getCase(ctx.db, id)
  })
  app.patch('/admin/v1/cases/:id', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(
      z.object({ status: z.enum(['open', 'investigating', 'escalated']).optional(), assignedTo: z.string().email().nullable().optional(), note: zNote.optional() }),
      req.body,
    )
    await ctx.db.tx((q) => updateCase(q, id, body, req.admin.email))
    const c = await getCase(ctx.db, id)
    await audit(ctx.db, req.admin, 'case.update', `case:${c.ref}`, [body.status && `status ${body.status}`, body.assignedTo !== undefined && `assigned ${body.assignedTo ?? 'nobody'}`, body.note && 'note'].filter(Boolean).join(', '))
    return c
  })
  app.post('/admin/v1/cases/:id/close', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ outcome: z.enum(['fraud', 'ok']), note: zNote.min(3, 'Say what you found') }), req.body)
    await ctx.db.tx((q) => closeCase(q, id, body.outcome, body.note, req.admin.email))
    const c = await getCase(ctx.db, id)
    await audit(ctx.db, req.admin, `case.close.${body.outcome}`, `case:${c.ref}`, body.note)
    return c
  })
  app.post('/admin/v1/cases/:id/freeze', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ frozen: z.boolean(), note: zNote.min(3, 'Say why') }), req.body)
    await freezeCase(ctx, id, body.frozen, body.note, req.admin.email)
    const c = await getCase(ctx.db, id)
    await audit(ctx.db, req.admin, body.frozen ? 'case.freeze' : 'case.unfreeze', `user:${c.user.id}`, `${c.ref} · ${body.note}`)
    return c
  })
  app.post('/admin/v1/cases/:id/summary', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    try {
      await summariseCase(ctx, id, req.admin.email)
    } catch (err) {
      if (err instanceof AppError) throw err
      ctx.log.error({ err }, 'case summary failed')
      throw new AppError('UNKNOWN', 'The AI summary failed; try again in a moment')
    }
    const c = await getCase(ctx.db, id)
    await audit(ctx.db, req.admin, 'case.ai_summary', `case:${c.ref}`)
    return c
  })
  app.post('/admin/v1/cases/:id/str', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ reference: z.string().trim().min(2).max(100) }), req.body)
    await fileStr(ctx.db, id, body.reference, req.admin.email)
    const c = await getCase(ctx.db, id)
    await audit(ctx.db, req.admin, 'case.str', `case:${c.ref}`, body.reference)
    return c
  })
}
