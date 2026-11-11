// EcoSure funeral claims: the holder submits (PIN), staff verify, assess and decide; approval pays into the wallet.
import type { EsCauseOfDeath, EsClaim, EsClaimBody, EsClaimDecisionBody, EsClaimStatus, EsRelationship, PublicUser } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents, toCents } from '../lib/money'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { checkPin } from '../services/pins'
import { getUsers, toPublicUser, type UserRow } from '../services/users'
import { isDate, notify, todayMaseru } from './account'
import { loadProducts } from './catalogue'
import { requireOwnPolicy } from './policies'
import { markUsed, requireOwnUploads } from './uploads'

const OPEN: EsClaimStatus[] = ['submitted', 'documents_verified', 'under_assessment']
const MAX_PAYOUT_CENTS = 1_000_000 * 100

interface ClaimRow {
  id: string
  reference: string
  policy_id: string
  policy_number: string
  holder_id: string
  member_id: string
  member_name: string
  relationship: EsRelationship
  date_of_death: string
  cause: EsCauseOfDeath
  status: EsClaimStatus
  payout_cents: number | null
  reason: string | null
  created_at: Date
  updated_at: Date
  verified_at: Date | null
  assessed_at: Date | null
  decided_at: Date | null
}

const CLAIM_SELECT = `SELECT c.id, c.reference, c.policy_id, p.number AS policy_number, p.holder_id, c.member_id, m.name AS member_name,
    m.relationship, c.date_of_death::text AS date_of_death, c.cause, c.status, c.payout_cents, c.reason,
    c.created_at, c.updated_at, c.verified_at, c.assessed_at, c.decided_at
  FROM ecosure_claims c JOIN ecosure_policies p ON p.id = c.policy_id JOIN ecosure_members m ON m.id = c.member_id`

/** Documents the product requires for a cause of death: those without a cause in brackets, plus the cause's own. */
export function requiredClaimDocuments(claimDocuments: string[], cause: EsCauseOfDeath): string[] {
  const CAUSE = /\((natural|unnatural|undetermined) cause\)/
  return claimDocuments.filter((label) => !CAUSE.test(label) || label.includes(`(${cause} cause)`))
}

export async function toClaims(q: Queryable, rows: ClaimRow[]): Promise<EsClaim[]> {
  if (!rows.length) return []
  const docs = await q.query<{ claim_id: string; label: string; file_name: string }>(
    `SELECT d.claim_id, d.label, u.file_name FROM ecosure_claim_documents d JOIN ecosure_uploads u ON u.id = d.upload_id
     WHERE d.claim_id = ANY($1) ORDER BY d.sort, d.label`,
    [rows.map((r) => r.id)],
  )
  return rows.map((r) => {
    const decided = r.status === 'approved' || r.status === 'rejected'
    const c: EsClaim = {
      id: r.id,
      reference: r.reference,
      policyNumber: r.policy_number,
      member: { id: r.member_id, name: r.member_name, relationship: r.relationship },
      dateOfDeath: r.date_of_death,
      cause: r.cause,
      status: r.status,
      documents: docs.filter((d) => d.claim_id === r.id).map((d) => ({ label: d.label, fileName: d.file_name })),
      steps: [
        { label: 'Submitted', at: iso(r.created_at), done: true },
        { label: 'Documents verified', at: r.verified_at ? iso(r.verified_at) : undefined, done: !!r.verified_at },
        { label: 'Under assessment', at: r.assessed_at ? iso(r.assessed_at) : undefined, done: !!r.assessed_at },
        { label: 'Decision and payout', at: r.decided_at ? iso(r.decided_at) : undefined, done: decided },
      ].map((s) => (s.at ? s : { label: s.label, done: s.done })),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    }
    if (r.payout_cents != null) c.payout = fromCents(r.payout_cents)
    if (r.reason) c.reason = r.reason
    return c
  })
}

export async function myClaims(q: Queryable, me: UserRow): Promise<EsClaim[]> {
  return toClaims(q, await q.query<ClaimRow>(`${CLAIM_SELECT} WHERE p.holder_id = $1 ORDER BY c.created_at DESC, c.reference DESC`, [me.id]))
}

async function loadClaim(q: Queryable, id: string): Promise<EsClaim> {
  const [c] = await toClaims(q, await q.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.id = $1`, [id]))
  if (!c) throw notFound('Claim not found')
  return c
}

export async function submitClaim(ctx: Ctx, me: UserRow, body: EsClaimBody): Promise<EsClaim> {
  if (!isDate(body.dateOfDeath)) throw validation('dateOfDeath must be a date like 2026-10-01')
  if (body.dateOfDeath > todayMaseru()) throw validation("dateOfDeath can't be in the future")

  const check = async (q: Queryable) => {
    const policy = await requireOwnPolicy(q, me, body.policyId)
    if (policy.status !== 'active' && policy.status !== 'grace') {
      throw conflict(`Policy ${policy.number} is ${policy.status}. Claims need active cover (or cover in its grace period)`)
    }
    const [member] = await q.query<{ id: string; name: string; dob: string | null }>(
      'SELECT id, name, dob::text AS dob FROM ecosure_members WHERE id = $1 AND policy_id = $2 AND removed_at IS NULL',
      [body.memberId, policy.id],
    )
    if (!member) throw validation('memberId must be a member covered by this policy')
    if (member.dob && body.dateOfDeath < member.dob) throw validation('dateOfDeath is before the member’s date of birth')
    const [open] = await q.query<{ reference: string; status: EsClaimStatus }>(
      `SELECT reference, status FROM ecosure_claims WHERE member_id = $1 AND status <> 'rejected' LIMIT 1`,
      [member.id],
    )
    if (open) throw conflict(`There is already a claim for ${member.name} (${open.reference}, ${open.status.replace(/_/g, ' ')})`)

    const [product] = await loadProducts(q, { codes: [policy.product_code] })
    const required = requiredClaimDocuments(product.claimDocuments, body.cause)
    const labels = body.documents.map((d) => d.label)
    if (new Set(labels).size !== labels.length) throw validation('Each document can only be sent once')
    for (const label of labels) {
      if (!required.includes(label)) throw validation(`"${label}" is not needed for this claim`)
    }
    const missing = required.filter((label) => !labels.includes(label))
    if (missing.length) throw validation(`Please add: ${missing.join(', ')}`)
    await requireOwnUploads(q, me.id, body.documents)
    return { policy, member, required }
  }

  await check(ctx.db)
  await checkPin(ctx.db, me, body.pin)
  const id = await ctx.tx(async (q, out) => {
    await q.query('SELECT id FROM ecosure_members WHERE id = $1 FOR UPDATE', [body.memberId])
    const { policy, member, required } = await check(q)
    const id = newId()
    const [{ reference }] = await q.query<{ reference: string }>(
      `INSERT INTO ecosure_claims (id, policy_id, member_id, date_of_death, cause) VALUES ($1, $2, $3, $4, $5) RETURNING reference`,
      [id, policy.id, member.id, body.dateOfDeath, body.cause],
    )
    for (const d of body.documents) {
      await q.query('INSERT INTO ecosure_claim_documents (claim_id, label, upload_id, sort) VALUES ($1, $2, $3, $4)', [
        id,
        d.label,
        d.uploadId,
        required.indexOf(d.label),
      ])
    }
    await markUsed(
      q,
      body.documents.map((d) => d.uploadId),
    )
    await notify(
      q,
      out,
      me.id,
      `We received your claim ${reference} for ${member.name} (policy ${policy.number}). We are sorry for your loss. ` +
        `We will update you here as your claim moves forward.`,
    )
    return id
  })
  return loadClaim(ctx.db, id)
}

// ---------- back office ----------

export type AdminClaim = EsClaim & { holder: PublicUser }

export async function adminClaims(q: Queryable, status: EsClaimStatus | null, page: number, pageSize: number) {
  const [{ total }] = await q.query<{ total: number }>('SELECT count(*) AS total FROM ecosure_claims c WHERE ($1::text IS NULL OR c.status = $1)', [status])
  const rows = await q.query<ClaimRow>(`${CLAIM_SELECT} WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.created_at DESC, c.reference DESC LIMIT $2 OFFSET $3`, [
    status,
    pageSize,
    (page - 1) * pageSize,
  ])
  const claims = await toClaims(q, rows)
  const users = await getUsers(q, rows.map((r) => r.holder_id))
  const items: AdminClaim[] = claims.map((c, i) => ({ ...c, holder: toPublicUser(users.get(rows[i].holder_id)!) }))
  return { items, total, page, pageSize }
}

/** The n-th document (in claim order) of a claim: its upload id. */
export async function claimDocumentUploadId(q: Queryable, claimId: string, index: number): Promise<string> {
  const docs = await q.query<{ upload_id: string }>('SELECT upload_id FROM ecosure_claim_documents WHERE claim_id = $1 ORDER BY sort, label', [claimId])
  const doc = docs[index]
  if (!doc) throw notFound('Document not found')
  return doc.upload_id
}

/**
 * Staff decision. verify_documents: submitted → documents_verified. start_assessment: documents_verified → under_assessment.
 * approve: under_assessment → approved, pays `payout` into the holder's wallet. reject: any open claim, needs a reason.
 * request_info: any open claim, keeps the status, needs a reason. The holder is told in the EcoSure chat.
 */
export async function decideClaim(ctx: Ctx, q: Queryable, out: Outbox, id: string, body: EsClaimDecisionBody): Promise<{ claim: EsClaim; detail: string }> {
  await q.query('SELECT id FROM ecosure_claims WHERE id = $1 FOR UPDATE', [id])
  const [r] = await q.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.id = $1`, [id])
  if (!r) throw notFound('Claim not found')
  if (!OPEN.includes(r.status)) throw conflict(`Claim ${r.reference} is already ${r.status}`)
  const reason = body.reason?.trim() || null
  if (reason && reason.length > 500) throw validation('reason must be at most 500 characters')
  let detail = r.reference
  const need = (status: EsClaimStatus, action: string) => {
    if (r.status !== status) throw conflict(`Claim ${r.reference} is ${r.status.replace(/_/g, ' ')}; ${action} needs it to be ${status.replace(/_/g, ' ')}`)
  }
  switch (body.action) {
    case 'verify_documents':
      need('submitted', 'verifying documents')
      await q.query(`UPDATE ecosure_claims SET status = 'documents_verified', verified_at = now(), updated_at = now() WHERE id = $1`, [id])
      await notify(q, out, r.holder_id, `Your claim ${r.reference}: documents verified. Your claim is now waiting for assessment.`)
      break
    case 'start_assessment':
      need('documents_verified', 'starting the assessment')
      await q.query(`UPDATE ecosure_claims SET status = 'under_assessment', assessed_at = now(), updated_at = now() WHERE id = $1`, [id])
      await notify(q, out, r.holder_id, `Your claim ${r.reference} is now under assessment.`)
      break
    case 'approve': {
      need('under_assessment', 'approval')
      if (body.payout === undefined) throw validation('payout is required to approve a claim')
      const cents = toCents(body.payout, 'payout')
      if (cents <= 0) throw validation('payout must be greater than 0')
      if (cents > MAX_PAYOUT_CENTS) throw new AppError('LIMIT_EXCEEDED', 'Payouts are limited to M1,000,000')
      // Mock underwriter money: enters the wallet system from outside (fromUserId null), like agent float.
      const result = await ctx.ledger.transfer(q, { kind: 'claim', fromUserId: null, toUserId: r.holder_id, amountCents: cents, label: `EcoSure claim payout · ${r.reference}` })
      for (const [userId, balance] of result.balances) out.balance(userId, balance)
      await q.query(
        `UPDATE ecosure_claims SET status = 'approved', payout_cents = $2, decided_at = now(), updated_at = now(), transaction_id = $3,
           assessed_at = COALESCE(assessed_at, now()) WHERE id = $1`,
        [id, cents, result.tx.id],
      )
      await notify(q, out, r.holder_id, `Your claim ${r.reference} was approved. ${formatM(cents)} has been paid into your EcoCash wallet.`)
      detail = `${r.reference} · ${formatM(cents)} · ${result.tx.reference}`
      break
    }
    case 'reject':
      if (!reason) throw validation('reason is required to reject a claim')
      await q.query(`UPDATE ecosure_claims SET status = 'rejected', reason = $2, decided_at = now(), updated_at = now() WHERE id = $1`, [id, reason])
      await notify(q, out, r.holder_id, `Your claim ${r.reference} was not approved. Reason: ${reason}`)
      detail = `${r.reference} · ${reason}`
      break
    case 'request_info':
      if (!reason) throw validation('reason is required to ask for more information')
      await q.query(`UPDATE ecosure_claims SET reason = $2, updated_at = now() WHERE id = $1`, [id, reason])
      await notify(q, out, r.holder_id, `We need more information for your claim ${r.reference}: ${reason}`)
      detail = `${r.reference} · ${reason}`
      break
  }
  return { claim: await loadClaim(q, id), detail }
}

