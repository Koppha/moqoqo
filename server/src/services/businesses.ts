// EcoCash Business as a mini app in EcoCash Super App. Contract: shared/api.ts "EcoCash Business as a mini app".
// A person links the agent or merchant accounts they own, once: their verified ID must match the owner ID EcoCash
// recorded for the business (portal), and they enter the business PIN. Opening one starts a
// business session from the person's EcoCash Super App, so they don't sign in again; unlinking ends those sessions.
import { BUSINESS_LINKS_MAX, type LinkedBusiness, type LoginResponse } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { hashToken, newToken } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { checkPin } from './pins'
import { toMe, type UserRow } from './users'

const toLinked = (u: UserRow): LinkedBusiness => ({
  id: u.id,
  name: u.business_name ?? u.name,
  role: u.role as LinkedBusiness['role'],
  code: u.code,
  msisdn: u.msisdn ?? '',
})

/** The business is this person's: their verified national ID is the owner ID EcoCash recorded for it. */
function requireOwner(me: UserRow, biz: UserRow) {
  if (!me.id_number) throw forbidden('Verify your ID first (Me › Update KYC). Only the owner of a business can add it')
  if (!biz.owner_id_number) throw forbidden('EcoCash has not recorded who owns this business. Visit an EcoCash shop with your ID')
  if (biz.owner_id_number !== me.id_number) throw forbidden('This business is registered to someone else. Only its owner can add it')
}

/** Only a person in EcoCash Super App links and opens businesses (not from inside a business session). */
function requirePerson(me: UserRow, app: string) {
  if (me.role !== 'customer' || app !== 'customer') throw forbidden('Open EcoCash Business from your EcoCash Super App')
}

export async function myBusinesses(q: Queryable, me: UserRow): Promise<LinkedBusiness[]> {
  const rows = await q.query<UserRow>(
    `SELECT u.* FROM business_links l JOIN users u ON u.id = l.business_id WHERE l.owner_id = $1 ORDER BY l.created_at`,
    [me.id],
  )
  return rows.map(toLinked)
}

export async function linkBusiness(ctx: Ctx, me: UserRow, app: string, body: { msisdn: string; pin: string }): Promise<LinkedBusiness> {
  requirePerson(me, app)
  let msisdn: string
  try {
    msisdn = normalizeMsisdn(body.msisdn)
  } catch {
    throw validation('Enter the business account’s EcoCash number')
  }
  const [biz] = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (!biz || !biz.pin_hash) throw new AppError('NOT_REGISTERED', `${msisdn} is not an EcoCash agent or merchant`)
  if (biz.role === 'customer') throw validation(`${msisdn} is a personal wallet. Link an agent or merchant number`)
  if (biz.status === 'suspended') throw new AppError('SUSPENDED', 'This business account is suspended. Please contact EcoCash')
  // The business account's own PIN (its wrong tries count and lock it, as at sign-in).
  await checkPin(ctx.db, biz, body.pin, 'wallet')
  requireOwner(me, biz)
  return ctx.tx(async (q, out) => {
    const [{ count }] = await q.query<{ count: number }>('SELECT count(*)::int AS count FROM business_links WHERE owner_id = $1', [me.id])
    const [already] = await q.query('SELECT 1 FROM business_links WHERE owner_id = $1 AND business_id = $2', [me.id, biz.id])
    if (already) throw conflict(`${biz.business_name ?? biz.name} is already in your EcoCash Super App`)
    if (count >= BUSINESS_LINKS_MAX) throw validation(`You can link up to ${BUSINESS_LINKS_MAX} businesses`)
    await q.query('INSERT INTO business_links (owner_id, business_id) VALUES ($1, $2)', [me.id, biz.id])
    out.notify({
      userIds: [biz.id],
      category: 'security',
      title: 'Business linked',
      body: `${me.name} (${me.msisdn}) can now open ${biz.business_name ?? biz.name} from their EcoCash Super App. If you didn't do this, call EcoCash customer care now.`,
      data: { screen: 'notifications' },
    })
    return toLinked(biz)
  })
}

export async function unlinkBusiness(ctx: Ctx, me: UserRow, businessId: string): Promise<void> {
  await ctx.tx(async (q) => {
    const gone = await q.query('DELETE FROM business_links WHERE owner_id = $1 AND business_id = $2 RETURNING 1', [me.id, businessId])
    if (!gone.length) throw notFound('Business not found')
    await q.query('DELETE FROM sessions WHERE user_id = $1 AND opened_by = $2', [businessId, me.id])
  })
}

/** A session for the business account, on the same phone as the person's own session. */
export async function openBusiness(ctx: Ctx, me: UserRow, app: string, boundDeviceId: string | null, businessId: string): Promise<LoginResponse> {
  requirePerson(me, app)
  const [biz] = await ctx.db.query<UserRow>(
    `SELECT u.* FROM business_links l JOIN users u ON u.id = l.business_id WHERE l.owner_id = $1 AND l.business_id = $2`,
    [me.id, businessId],
  )
  if (!biz) throw notFound('Business not found')
  requireOwner(me, biz)
  if (biz.status === 'suspended') throw new AppError('SUSPENDED', 'This business account is suspended. Please contact EcoCash')
  const token = newToken()
  await ctx.db.query(
    `INSERT INTO sessions (token_hash, user_id, app, bound_device_id, opened_by) VALUES ($1, $2, 'business', $3, $4)`,
    [hashToken(token), biz.id, boundDeviceId, me.id],
  )
  const [fresh] = await ctx.db.query<UserRow>('UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING *', [biz.id])
  return { token, user: toMe(fresh) }
}
