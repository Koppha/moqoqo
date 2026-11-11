// Society (Mekhatlo): /v1/societies…, /v1/society-transfers…, and the portal's /admin/v1/societies.
// Contract: shared/api.ts "Society".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../context'
import { authAdmin, authUser, parse, zAmount, zClientId, zId, zPin } from '../http'
import {
  addMember,
  adminSocieties,
  contribute,
  createSociety,
  createTransfer,
  decideTransfer,
  mySocieties,
  remindUnpaid,
  removeMember,
  requireMemberDetail,
  societyDetail,
} from '../services/societies'
import {
  activateApplication,
  adminApplications,
  apply,
  applicationById,
  cancelApplication,
  decideApplication,
  getApplySettings,
  myApplications,
  setApplySettings,
} from '../services/societyApplications'
import { askForLoan, decideLoan, decideLoanTerms, repayLoan, setLoanSettings, societyLoans } from '../services/societyLoans'
import { audit } from './admin'

const zKind = z.enum(['society', 'motselo', 'burial'])

const zTo = z.string().trim().min(1).max(40)

export async function societyRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  const idParam = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/v1/societies', auth, async (req) => mySocieties(ctx.db, req.user))
  app.get('/v1/societies/:id', auth, async (req) => requireMemberDetail(ctx.db, req.user, idParam(req.params)))

  app.post('/v1/societies/:id/members', auth, async (req) => {
    const body = parse(z.object({ to: zTo, role: z.enum(['member', 'signatory']).optional() }), req.body)
    return addMember(ctx, req.user, idParam(req.params), body)
  })
  app.delete('/v1/societies/:id/members/:userId', auth, async (req) => {
    const { id, userId } = parse(z.object({ id: zId, userId: zId }), req.params)
    return removeMember(ctx, req.user, id, userId)
  })

  app.post('/v1/societies/:id/remind', auth, async (req) => remindUnpaid(ctx, req.user, idParam(req.params)))

  app.post('/v1/societies/:id/contributions', auth, async (req) => {
    const body = parse(z.object({ amount: zAmount, pin: zPin, note: z.string().max(200).optional() }), req.body)
    return contribute(ctx, req.user, idParam(req.params), body)
  })

  app.post('/v1/societies/:id/transfers', auth, async (req, reply) => {
    const body = parse(z.object({ to: zTo, amount: zAmount, note: z.string().max(200).optional(), pin: zPin, clientId: zClientId }), req.body)
    reply.code(201)
    return createTransfer(ctx, req.user, idParam(req.params), body)
  })

  for (const action of ['approve', 'reject'] as const) {
    app.post(`/v1/society-transfers/:id/${action}`, auth, async (req) => {
      const { pin } = parse(z.object({ pin: zPin }), req.body)
      return decideTransfer(ctx, req.user, idParam(req.params), action === 'approve', pin)
    })
  }

  // Loans from the society, on terms the executives set.
  app.get('/v1/societies/:id/loans', auth, async (req) => societyLoans(ctx.db, req.user, idParam(req.params)))
  app.put('/v1/societies/:id/loan-settings', auth, async (req) => {
    const body = parse(
      z.object({ enabled: z.boolean(), interestPercent: z.number().min(0).max(100), maxMonths: z.number().int().min(1).max(24), maxAmount: zAmount.optional() }),
      req.body,
    )
    return setLoanSettings(ctx, req.user, idParam(req.params), body)
  })
  app.post('/v1/societies/:id/loans', auth, async (req, reply) => {
    const body = parse(
      z.object({ amount: zAmount, months: z.number().int().min(1).max(24), purpose: z.string().max(200).optional(), pin: zPin, clientId: zClientId }),
      req.body,
    )
    reply.code(201)
    return askForLoan(ctx, req.user, idParam(req.params), body)
  })
  for (const action of ['approve', 'reject'] as const) {
    app.post(`/v1/society-loans/:id/${action}`, auth, async (req) => {
      const { pin } = parse(z.object({ pin: zPin }), req.body)
      return decideLoan(ctx, req.user, idParam(req.params), action === 'approve', pin)
    })
  }
  for (const action of ['approve', 'reject'] as const) {
    app.post(`/v1/society-loan-terms/:id/${action}`, auth, async (req) => {
      const { pin } = parse(z.object({ pin: zPin }), req.body)
      return decideLoanTerms(ctx, req.user, idParam(req.params), action === 'approve', pin)
    })
  }
  app.post('/v1/society-loans/:id/repay', auth, async (req) => {
    const body = parse(z.object({ amount: zAmount, pin: zPin }), req.body)
    return repayLoan(ctx, req.user, idParam(req.params), body)
  })

  // Applying for a new society: approved in the portal, opened once the Mokhatlo SIM is collected.
  app.get('/v1/society-apply-settings', auth, async () => getApplySettings(ctx.db))
  app.get('/v1/society-applications', auth, async (req) => myApplications(ctx.db, req.user))
  app.post('/v1/society-applications', auth, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().max(60),
        kind: zKind,
        contribution: zAmount.optional(),
        approvalsRequired: z.number().int().min(1).max(10),
        executives: z.array(zTo).max(9),
      }),
      req.body,
    )
    reply.code(201)
    return apply(ctx, req.user, body)
  })
  app.post('/v1/society-applications/:id/cancel', auth, async (req) => cancelApplication(ctx, req.user, idParam(req.params)))
}

export async function societyAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authAdmin(ctx) }

  app.get('/admin/v1/societies', auth, async () => adminSocieties(ctx.db))

  app.get('/admin/v1/societies/:id', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return societyDetail(ctx.db, id, null)
  })

  app.post('/admin/v1/societies', auth, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().max(60),
        code: z.string().max(4).optional(),
        kind: zKind.optional(),
        contribution: z.number().positive().max(100000).optional(),
        signatories: z.array(z.string().min(1).max(20)).min(1).max(10),
        approvalsRequired: z.number().int().min(1).max(10),
      }),
      req.body,
    )
    reply.code(201)
    return ctx.tx(async (q) => {
      const society = await createSociety(q, body)
      await audit(q, req.admin, 'society.create', society.id, `${society.name} (${society.code}, ${society.kind}${society.contribution ? `, M${society.contribution} a month` : ''}), ${body.approvalsRequired} approvals, signatories ${body.signatories.join(', ')}`)
      return society
    })
  })

  app.get('/admin/v1/societies/:id/loans', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return societyLoans(ctx.db, null, id)
  })

  // Applications from the app: approve or reject, then record the Mokhatlo SIM once it is collected.
  app.get('/admin/v1/society-applications', auth, async () => adminApplications(ctx.db))

  app.post('/admin/v1/society-applications/:id/approve', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await ctx.tx(async (q, out) => {
      const r = await decideApplication(q, out, req.admin.id, id, { approve: true })
      await audit(q, req.admin, 'society_application.approve', id, `${r.reference} ${r.name}`)
    })
    return applicationById(ctx.db, id)
  })

  app.post('/admin/v1/society-applications/:id/reject', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const { reason } = parse(z.object({ reason: z.string().max(300) }), req.body)
    await ctx.tx(async (q, out) => {
      const r = await decideApplication(q, out, req.admin.id, id, { approve: false, reason })
      await audit(q, req.admin, 'society_application.reject', id, `${r.reference} ${r.name}: ${reason.trim()}`)
    })
    return applicationById(ctx.db, id)
  })

  app.post('/admin/v1/society-applications/:id/activate', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ simNumber: z.string().min(1).max(20), code: z.string().max(4).optional() }), req.body)
    await ctx.tx(async (q, out) => {
      const { row, code, sim } = await activateApplication(q, out, req.admin.id, id, body)
      await audit(q, req.admin, 'society_application.activate', id, `${row.reference} ${row.name}: SIM ${sim} issued, society ${code}`)
    })
    return applicationById(ctx.db, id)
  })

  app.get('/admin/v1/society-apply-settings', auth, async () => getApplySettings(ctx.db))

  app.put('/admin/v1/society-apply-settings', auth, async (req) => {
    const body = parse(z.object({ enabled: z.boolean(), maxOpen: z.number().int().min(1).max(20), collectInstructions: z.string().max(600) }), req.body)
    const before = await getApplySettings(ctx.db)
    return ctx.tx(async (q) => {
      const saved = await setApplySettings(q, body)
      const changes = (Object.keys(saved) as (keyof typeof saved)[])
        .filter((k) => before[k] !== saved[k])
        .map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(saved[k])}`)
      await audit(q, req.admin, 'society_apply.update', 'societyApply', changes.join('; ') || 'no changes')
      return saved
    })
  })
}
