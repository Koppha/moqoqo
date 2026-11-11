// Sponsorship: someone pays for a family member's EcoSure cover. The member accepts in their EcoSure mini app.
import type { EsSponsorship, EsSponsorships } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { conflict, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import { displayName, getUsers, requireWallet, type UserRow } from '../services/users'
import { notify } from './account'
import { policyRows, toLookup } from './policies'

type Status = EsSponsorship['status']

interface SponsorshipRow {
  id: string
  sponsor_id: string
  member_id: string
  policy_id: string
  status: Status
  created_at: Date
}

async function toSponsorships(q: Queryable, rows: SponsorshipRow[]): Promise<EsSponsorship[]> {
  if (!rows.length) return []
  const users = await getUsers(q, rows.flatMap((r) => [r.sponsor_id, r.member_id]))
  const policies = new Map((await policyRows(q, 'p.id = ANY($2)', [rows.map((r) => r.policy_id)])).map((p) => [p.id, p]))
  return rows.map((r) => {
    const sponsor = users.get(r.sponsor_id)!
    const member = users.get(r.member_id)!
    return {
      id: r.id,
      status: r.status,
      sponsor: { name: displayName(sponsor) },
      member: { name: displayName(member), msisdn: member.msisdn ?? '' },
      policy: toLookup(policies.get(r.policy_id)!),
      createdAt: iso(r.created_at),
    }
  })
}

export async function mySponsorships(q: Queryable, me: UserRow): Promise<EsSponsorships> {
  const rows = await q.query<SponsorshipRow>(
    'SELECT * FROM ecosure_sponsorships WHERE sponsor_id = $1 OR member_id = $1 ORDER BY created_at DESC, id',
    [me.id],
  )
  const all = await toSponsorships(q, rows)
  return { mine: all.filter((_, i) => rows[i].sponsor_id === me.id), forMe: all.filter((_, i) => rows[i].member_id === me.id) }
}

async function loadOne(q: Queryable, id: string): Promise<EsSponsorship> {
  const [s] = await toSponsorships(q, await q.query<SponsorshipRow>('SELECT * FROM ecosure_sponsorships WHERE id = $1', [id]))
  if (!s) throw notFound('Sponsorship not found')
  return s
}

export async function createSponsorship(ctx: Ctx, me: UserRow, rawMsisdn: string): Promise<EsSponsorship> {
  const msisdn = normalizeMsisdn(rawMsisdn)
  const id = await ctx.tx(async (q, out) => {
    const member = await requireWallet(q, msisdn)
    if (member.id === me.id) throw validation('You cannot sponsor your own cover')
    const [policy] = await policyRows(
      q,
      `p.holder_id = $2 AND p.cancelled_at IS NULL AND pr.line = 'funeral'`,
      [member.id],
      'ORDER BY p.created_at DESC LIMIT 1',
    )
    if (!policy) throw notFound(`${displayName(member)} has no EcoSure funeral cover yet`)
    await q.query('SELECT id FROM ecosure_policies WHERE id = $1 FOR UPDATE', [policy.id])
    const [open] = await q.query<{ status: Status; sponsor_id: string }>(
      `SELECT status, sponsor_id FROM ecosure_sponsorships WHERE policy_id = $1 AND status IN ('awaiting', 'active')`,
      [policy.id],
    )
    if (open) {
      throw conflict(
        open.sponsor_id === me.id
          ? `You already ${open.status === 'active' ? 'sponsor' : 'asked to sponsor'} ${displayName(member)}'s cover`
          : `${displayName(member)}'s cover already has a sponsor`,
      )
    }
    const id = newId()
    await q.query('INSERT INTO ecosure_sponsorships (id, sponsor_id, member_id, policy_id) VALUES ($1, $2, $3, $4)', [id, me.id, member.id, policy.id])
    await notify(
      q,
      out,
      member.id,
      `${displayName(me)} would like to pay for your EcoSure cover ${policy.number}. Open EcoSure to accept or decline.`,
    )
    return id
  })
  return loadOne(ctx.db, id)
}

/** accept / decline: the member only, while awaiting. cancel: either side, while awaiting or active. */
export async function changeSponsorship(ctx: Ctx, me: UserRow, id: string, action: 'accept' | 'decline' | 'cancel'): Promise<EsSponsorship> {
  await ctx.tx(async (q, out) => {
    const [s] = await q.query<SponsorshipRow>('SELECT * FROM ecosure_sponsorships WHERE id = $1 FOR UPDATE', [id])
    if (!s || (s.sponsor_id !== me.id && s.member_id !== me.id)) throw notFound('Sponsorship not found')
    const [{ number }] = await q.query<{ number: string }>('SELECT number FROM ecosure_policies WHERE id = $1', [s.policy_id])
    const users = await getUsers(q, [s.sponsor_id, s.member_id])
    const memberName = displayName(users.get(s.member_id)!)
    let status: Status
    if (action === 'cancel') {
      if (s.status !== 'awaiting' && s.status !== 'active') throw conflict(`This sponsorship is already ${s.status}`)
      status = 'cancelled'
    } else {
      if (s.member_id !== me.id) throw forbidden(`Only ${memberName} can ${action} this`)
      if (s.status !== 'awaiting') throw conflict(`This sponsorship is already ${s.status}`)
      status = action === 'accept' ? 'active' : 'declined'
    }
    await q.query('UPDATE ecosure_sponsorships SET status = $2, updated_at = now() WHERE id = $1', [id, status])
    if (status === 'active') {
      await notify(q, out, s.sponsor_id, `${memberName} accepted. You now sponsor EcoSure cover ${number}; pay its premiums from EcoSure.`)
    } else if (status === 'declined') {
      await notify(q, out, s.sponsor_id, `${memberName} declined your offer to pay for EcoSure cover ${number}.`)
    } else {
      const other = me.id === s.sponsor_id ? s.member_id : s.sponsor_id
      await notify(q, out, other, `${displayName(me)} cancelled the sponsorship of EcoSure cover ${number}.`)
    }
  })
  return loadOne(ctx.db, id)
}
