// Applying for a new society (Mekhatlo). Contract: shared/api.ts "Applying for a new society".
// A member applies in the app and becomes the first executive. ETL approves or rejects in the portal. Approved, the
// executives collect a Mokhatlo merchant SIM at an Econet shop; when staff record the SIM, the society opens with
// the SIM's number as its wallet and the named executives as its signatories.
import type { SocietyApplication, SocietyApplicationStatus, SocietyApplyBody, SocietyApplySettings, SocietyKind, SocietySimBody } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { conflict, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { fromCents, paymentCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import { setSetting } from './maintenance'
import { openSociety } from './societies'
import { getUsers, requireByNumberOrUsername, toPublicUser, type UserRow } from './users'

interface AppRow {
  id: string
  reference: string
  applicant_id: string
  name: string
  kind: SocietyKind
  contribution_cents: number | null
  approvals_required: number
  executive_ids: string[]
  status: SocietyApplicationStatus
  reason: string | null
  decided_at: Date | null
  sim_msisdn: string | null
  society_id: string | null
  society_code: string | null
  created_at: Date
}

const SELECT = `SELECT a.*, s.code AS society_code FROM society_applications a LEFT JOIN societies s ON s.id = a.society_id`

const DEFAULTS: SocietyApplySettings = {
  enabled: true,
  maxOpen: 2,
  collectInstructions: 'Collect your Mokhatlo SIM at any Econet shop. All executives come together and bring their ID books.',
}

export async function getApplySettings(q: Queryable): Promise<SocietyApplySettings> {
  const [row] = await q.query<{ value: Partial<SocietyApplySettings> | null }>(`SELECT value FROM app_settings WHERE key = 'societyApply'`)
  const v = row?.value ?? {}
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULTS.enabled,
    maxOpen: typeof v.maxOpen === 'number' && v.maxOpen >= 1 ? v.maxOpen : DEFAULTS.maxOpen,
    collectInstructions: typeof v.collectInstructions === 'string' && v.collectInstructions.trim() ? v.collectInstructions : DEFAULTS.collectInstructions,
  }
}

export async function setApplySettings(q: Queryable, s: SocietyApplySettings): Promise<SocietyApplySettings> {
  const clean = { ...s, collectInstructions: s.collectInstructions.trim() }
  if (!clean.collectInstructions) throw validation('Say where to collect the SIM and what to bring')
  await setSetting(q, 'societyApply', clean)
  return clean
}

async function toApplications(q: Queryable, rows: AppRow[]): Promise<SocietyApplication[]> {
  const users = await getUsers(q, rows.flatMap((r) => [r.applicant_id, ...r.executive_ids]))
  return rows.map((r) => {
    const a: SocietyApplication = {
      id: r.id,
      reference: r.reference,
      name: r.name,
      kind: r.kind,
      approvalsRequired: r.approvals_required,
      applicant: toPublicUser(users.get(r.applicant_id)!),
      executives: r.executive_ids.map((id) => toPublicUser(users.get(id)!)),
      status: r.status,
      createdAt: iso(r.created_at),
    }
    if (r.contribution_cents) a.contribution = fromCents(Number(r.contribution_cents))
    if (r.reason) a.reason = r.reason
    if (r.sim_msisdn) a.simNumber = r.sim_msisdn
    if (r.society_id) a.societyId = r.society_id
    if (r.society_code) a.societyCode = r.society_code
    if (r.decided_at) a.decidedAt = iso(r.decided_at)
    return a
  })
}

async function byId(q: Queryable, id: string, lock = false): Promise<AppRow> {
  const [r] = await q.query<AppRow>(lock ? 'SELECT *, NULL AS society_code FROM society_applications WHERE id = $1 FOR UPDATE' : `${SELECT} WHERE a.id = $1`, [id])
  if (!r) throw notFound('Application not found')
  return r
}

async function one(q: Queryable, id: string): Promise<SocietyApplication> {
  return (await toApplications(q, [await byId(q, id)]))[0]
}

// ---------- the applicant ----------

export async function myApplications(q: Queryable, me: UserRow): Promise<SocietyApplication[]> {
  return toApplications(q, await q.query<AppRow>(`${SELECT} WHERE a.applicant_id = $1 ORDER BY a.created_at DESC LIMIT 20`, [me.id]))
}

export async function apply(ctx: Ctx, me: UserRow, body: SocietyApplyBody): Promise<SocietyApplication> {
  const settings = await getApplySettings(ctx.db)
  if (!settings.enabled) throw validation('Registering a society in the app is closed for now. Visit an Econet shop')
  const name = body.name.trim()
  if (name.length < 2 || name.length > 60) throw validation('The name is 2 to 60 characters')
  const contributionCents = body.contribution ? paymentCents(body.contribution) : null
  if (body.kind === 'motselo' && !contributionCents) throw validation('A Motšelo needs the amount each member pays a month')
  const executives: UserRow[] = [me]
  for (const raw of body.executives) {
    const u = await requireByNumberOrUsername(ctx.db, raw)
    if (executives.some((x) => x.id === u.id)) throw validation(u.id === me.id ? 'You are already an executive' : `${u.name} is listed twice`)
    executives.push(u)
  }
  if (executives.length > 10) throw validation('A society has at most 10 executives')
  if (body.approvalsRequired < 1 || body.approvalsRequired > executives.length) {
    throw validation(`Approvals needed is 1 to ${executives.length}, one for each executive at most`)
  }
  const [{ n }] = await ctx.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM society_applications WHERE applicant_id = $1 AND status IN ('pending', 'approved')`,
    [me.id],
  )
  if (n >= settings.maxOpen) throw conflict(`You already have ${n} applications in progress`)
  const id = newId()
  await ctx.tx(async (q, out) => {
    await q.query(
      `INSERT INTO society_applications (id, applicant_id, name, kind, contribution_cents, approvals_required, executive_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, me.id, name, body.kind, contributionCents, body.approvalsRequired, executives.map((u) => u.id)],
    )
    const others = executives.slice(1).map((u) => u.id)
    if (others.length) {
      out.notify({
        userIds: others,
        category: 'money',
        title: 'Society (Mekhatlo)',
        body: `${me.name} applied to register ${name} with you as an executive. EcoCash will let you know when it is approved.`,
        data: { screen: 'society' },
      })
    }
  })
  return one(ctx.db, id)
}

export async function cancelApplication(ctx: Ctx, me: UserRow, id: string): Promise<SocietyApplication> {
  const r = await byId(ctx.db, id)
  if (r.applicant_id !== me.id) throw notFound('Application not found')
  if (r.status !== 'pending') throw conflict(`This application is already ${r.status}`)
  await ctx.db.query(`UPDATE society_applications SET status = 'cancelled', decided_at = now() WHERE id = $1 AND status = 'pending'`, [id])
  return one(ctx.db, id)
}

// ---------- the portal ----------

export async function adminApplications(q: Queryable): Promise<SocietyApplication[]> {
  return toApplications(
    q,
    await q.query<AppRow>(
      `${SELECT} ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.created_at DESC LIMIT 100`,
    ),
  )
}

/** Approve or reject a pending application; the applicant is told either way. Runs inside the caller's transaction. */
export async function decideApplication(
  q: Queryable,
  out: Parameters<Parameters<Ctx['tx']>[0]>[1],
  adminId: string,
  id: string,
  decision: { approve: true } | { approve: false; reason: string },
): Promise<AppRow> {
  const r = await byId(q, id, true)
  if (r.status !== 'pending') throw conflict(`This application is already ${r.status}`)
  if (decision.approve) {
    await q.query(`UPDATE society_applications SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [id, adminId])
    const { collectInstructions } = await getApplySettings(q)
    out.notify({
      userIds: r.executive_ids,
      category: 'money',
      title: `${r.name} is approved`,
      body: `${r.reference}: ${collectInstructions} Quote ${r.reference}.`,
      data: { screen: 'society' },
    })
  } else {
    const reason = decision.reason.trim()
    if (!reason) throw validation('Give the reason the applicant will see')
    await q.query(`UPDATE society_applications SET status = 'rejected', reason = $3, decided_by = $2, decided_at = now() WHERE id = $1`, [id, adminId, reason])
    out.notify({ userIds: [r.applicant_id], category: 'money', title: 'Society (Mekhatlo)', body: `${r.reference} (${r.name}) was not approved: ${reason}`, data: { screen: 'society' } })
  }
  return r
}

/** The executives collected the Mokhatlo SIM: open the society with the SIM's number as its wallet. */
export async function activateApplication(
  q: Queryable,
  out: Parameters<Parameters<Ctx['tx']>[0]>[1],
  adminId: string,
  id: string,
  body: SocietySimBody,
): Promise<{ row: AppRow; code: string; sim: string }> {
  const r = await byId(q, id, true)
  if (r.status !== 'approved') throw conflict(r.status === 'pending' ? 'Approve the application first' : `This application is already ${r.status}`)
  const sim = normalizeMsisdn(body.simNumber, 'SIM number')
  const society = await openSociety(q, {
    name: r.name,
    code: body.code,
    kind: r.kind,
    contributionCents: r.contribution_cents == null ? null : Number(r.contribution_cents),
    approvalsRequired: r.approvals_required,
    signatoryIds: r.executive_ids,
    walletMsisdn: sim,
  })
  await q.query(
    `UPDATE society_applications SET status = 'active', sim_msisdn = $2, society_id = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
    [id, sim, society.id, adminId],
  )
  out.notify({
    userIds: r.executive_ids,
    category: 'money',
    title: `${r.name} is open`,
    body: `Society ${society.code} is ready in Society (Mekhatlo). Add your members and start paying in.`,
    data: { screen: 'society' },
  })
  return { row: r, code: society.code, sim }
}

export { one as applicationById }
