import type { AdminUser, Me, PublicUser, Role } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { USERNAME_PATTERN } from '../../../shared/api'
import { AppError } from '../errors'
import { normalizeMsisdn } from '../lib/msisdn'
import { fromCents } from '../lib/money'
import { iso, isoOrNull } from '../lib/time'

export interface UserRow {
  id: string
  /** Profile picture (assets row), if they set one. */
  photo_id?: string | null
  /** Set when the person chose an app PIN apart from the wallet PIN. */
  app_pin_hash?: string | null
  msisdn: string | null
  name: string
  role: Role
  kind: 'person' | 'system'
  official: boolean
  business_name: string | null
  code: string | null
  biller: string | null
  kyc_tier: 1 | 2
  balance_cents: number
  pin_hash: string | null
  pin_salt: string | null
  failed_pins: number
  locked_until: Date | null
  /** The PIN for the standalone EcoSure app (EcoSure profile); NULL until they create one. Never the EcoCash PIN. */
  ecosure_pin_hash: string | null
  ecosure_pin_salt: string | null
  status: 'active' | 'suspended'
  quick_pay_at: Date | null
  message_policy?: 'everyone' | 'friends'
  email: string | null
  email_verified_at: Date | null
  username: string | null
  /** National ID (sign-up ID check); NULL until verified. */
  id_number?: string | null
  /** Agent and merchant accounts: the owner's national ID, recorded by staff (portal). */
  owner_id_number?: string | null
  created_at: Date
  last_seen_at: Date | null
}

export function toPublicUser(u: UserRow): PublicUser {
  const p: PublicUser = { id: u.id, msisdn: u.msisdn ?? '', name: u.name, role: u.role }
  if (u.official) p.official = true
  if (u.business_name) p.businessName = u.business_name
  if (u.username) p.username = u.username
  if (u.photo_id) p.photo = `/v1/assets/${u.photo_id}`
  return p
}

export function toMe(u: UserRow): Me {
  const me: Me = { ...toPublicUser(u), balance: fromCents(u.balance_cents), kycTier: u.kyc_tier }
  if (u.code) me.code = u.code
  if (u.quick_pay_at) me.quickPay = true
  if (u.message_policy) me.messagePolicy = u.message_policy
  if (u.app_pin_hash) me.appPin = true
  return me
}

export function toAdminUser(u: UserRow): AdminUser {
  return { ...toMe(u), status: u.status, createdAt: iso(u.created_at), lastSeenAt: isoOrNull(u.last_seen_at), ownerIdNumber: u.owner_id_number ?? null }
}

/** Display name of a wallet as others see it (merchants by business name). */
export const displayName = (u: Pick<UserRow, 'name' | 'business_name'>) => u.business_name || u.name

export async function getUser(q: Queryable, id: string): Promise<UserRow | null> {
  const [u] = await q.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
  return u ?? null
}

export async function getUsers(q: Queryable, ids: string[]): Promise<Map<string, UserRow>> {
  if (!ids.length) return new Map()
  const rows = await q.query<UserRow>('SELECT * FROM users WHERE id = ANY($1)', [[...new Set(ids)]])
  return new Map(rows.map((r) => [r.id, r]))
}

/** "@Lerato.M" → "lerato.m"; null when it isn't a username (e.g. a phone number). */
export function asUsername(input: string): string | null {
  const u = input.trim().replace(/^@/, '').toLowerCase()
  return USERNAME_PATTERN.test(u) ? u : null
}

/** A person's wallet by username. Throws NOT_REGISTERED. */
export async function requireByUsername(q: Queryable, username: string): Promise<UserRow> {
  const [u] = await q.query<UserRow>(`SELECT * FROM users WHERE username = $1 AND kind = 'person'`, [username])
  if (!u) throw new AppError('NOT_REGISTERED', `No one uses the username @${username}`)
  return u
}

/** A number or a username, as people type them. */
export async function requireByNumberOrUsername(q: Queryable, input: string): Promise<UserRow> {
  const name = /^\+?\d[\d\s-]*$/.test(input.trim()) ? null : asUsername(input)
  return name ? requireByUsername(q, name) : requireWallet(q, normalizeMsisdn(input))
}

/** A person's wallet by number (system accounts are not addressable). Throws NOT_REGISTERED. */
export async function requireWallet(q: Queryable, msisdn: string): Promise<UserRow> {
  const [u] = await q.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (!u) throw new AppError('NOT_REGISTERED', `${msisdn} is not registered for EcoCash`)
  return u
}
