// Channel map: every agent and merchant for the portal's staff map, with where they are and how they're doing.
// Location: one staff set for the wallet (channel_locations), else their Find us place matched by code, then number.
import type { ChannelLocationBody, ChannelMap, ChannelUser, ChurnBand, Role } from '../../../shared/api'
import { LESOTHO_BOUNDS } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { notFound, validation } from '../errors'
import { fromCents } from '../lib/money'
import { isoOrNull } from '../lib/time'

interface Row {
  id: string
  name: string
  business_name: string | null
  msisdn: string | null
  role: Role
  code: string | null
  status: 'active' | 'suspended'
  balance_cents: string | number
  set_lat: number | null
  set_lng: number | null
  set_address: string | null
  place_lat: number | null
  place_lng: number | null
  place_address: string | null
  score: number | null
  band: ChurnBand | null
  last_at: Date | null
  tx30: number
}

const SELECT = `SELECT u.id, u.name, u.business_name, u.msisdn, u.role, u.code, u.status, u.balance_cents,
       cl.lat AS set_lat, cl.lng AS set_lng, cl.address AS set_address,
       pl.lat AS place_lat, pl.lng AS place_lng, pl.address AS place_address,
       cs.score, cs.band,
       (SELECT max(t.created_at) FROM transactions t WHERE (t.from_user_id = u.id OR t.to_user_id = u.id) AND t.kind NOT IN ('fee', 'register')) AS last_at,
       (SELECT count(*)::int FROM transactions t WHERE (t.from_user_id = u.id OR t.to_user_id = u.id) AND t.kind NOT IN ('fee', 'register')
          AND t.created_at >= now() - interval '30 days') AS tx30
  FROM users u
  LEFT JOIN channel_locations cl ON cl.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT p.lat, p.lng, p.address FROM places p
     WHERE p.kind = u.role AND ((u.code IS NOT NULL AND p.code = u.code) OR (u.msisdn IS NOT NULL AND p.phone = u.msisdn))
     ORDER BY (p.code = u.code) DESC NULLS LAST, p.enabled DESC LIMIT 1
  ) pl ON true
  LEFT JOIN LATERAL (SELECT score, band FROM churn_scores WHERE user_id = u.id ORDER BY day DESC LIMIT 1) cs ON true
 WHERE u.kind = 'person' AND u.role IN ('agent', 'merchant')`

const toUser = (r: Row): ChannelUser => {
  const location =
    r.set_lat !== null && r.set_lng !== null
      ? { lat: r.set_lat, lng: r.set_lng, address: r.set_address, source: 'set' as const }
      : r.place_lat !== null && r.place_lng !== null
        ? { lat: r.place_lat, lng: r.place_lng, address: r.place_address, source: 'place' as const }
        : null
  return {
    user: { id: r.id, msisdn: r.msisdn ?? '', name: r.name, role: r.role, code: r.code, ...(r.business_name ? { businessName: r.business_name } : {}) },
    status: r.status,
    location,
    churn: r.score === null || r.band === null ? null : { score: r.score, band: r.band },
    lastTransactionAt: isoOrNull(r.last_at),
    tx30: r.tx30 ?? 0,
    balance: fromCents(Number(r.balance_cents)),
  }
}

export async function channelMap(q: Queryable): Promise<ChannelMap> {
  const users = (await q.query<Row>(`${SELECT} ORDER BY COALESCE(u.business_name, u.name)`)).map(toUser)
  const located = users.filter((u) => u.location).length
  return { users, located, unlocated: users.length - located }
}

async function channelUser(q: Queryable, userId: string): Promise<ChannelUser> {
  const [r] = await q.query<Row>(`${SELECT} AND u.id = $1`, [userId])
  if (!r) throw notFound('No agent or merchant with that id')
  return toUser(r)
}

export async function setChannelLocation(q: Queryable, userId: string, body: ChannelLocationBody, by: string): Promise<ChannelUser> {
  const b = LESOTHO_BOUNDS
  if (body.lat < b.minLat || body.lat > b.maxLat || body.lng < b.minLng || body.lng > b.maxLng) {
    throw validation('That point is outside Lesotho. Check the latitude (negative, south) and longitude.')
  }
  await channelUser(q, userId)
  await q.query(
    `INSERT INTO channel_locations (user_id, lat, lng, address, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET lat = $2, lng = $3, address = $4, updated_by = $5, updated_at = now()`,
    [userId, body.lat, body.lng, body.address?.trim() || null, by],
  )
  return channelUser(q, userId)
}

export async function clearChannelLocation(q: Queryable, userId: string): Promise<void> {
  await channelUser(q, userId)
  await q.query('DELETE FROM channel_locations WHERE user_id = $1', [userId])
}
