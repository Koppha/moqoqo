// Agents, merchants and ATMs on the map, managed in the portal. Contract: shared/api.ts "Places".
import { LESOTHO_BOUNDS, type Place, type PlaceBody, type PlaceKind } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { iso } from '../lib/time'

interface PlaceRow {
  id: string
  kind: PlaceKind
  name: string
  address: string
  lat: number
  lng: number
  hours: string | null
  phone: string | null
  code: string | null
  enabled: boolean
  updated_at: Date
}

const toPlace = (r: PlaceRow): Place => {
  const p: Place = { id: r.id, kind: r.kind, name: r.name, address: r.address, lat: Number(r.lat), lng: Number(r.lng), enabled: r.enabled, updatedAt: iso(r.updated_at) }
  if (r.hours) p.hours = r.hours
  if (r.phone) p.phone = r.phone
  if (r.code) p.code = r.code
  return p
}

/** The apps: enabled places only. The portal: all of them. */
export async function listPlaces(q: Queryable, includeDisabled = false): Promise<Place[]> {
  const rows = await q.query<PlaceRow>(`SELECT * FROM places ${includeDisabled ? '' : 'WHERE enabled'} ORDER BY kind, name`)
  return rows.map(toPlace)
}

function check(b: PlaceBody): PlaceBody {
  const { minLat, maxLat, minLng, maxLng } = LESOTHO_BOUNDS
  if (b.lat < minLat || b.lat > maxLat || b.lng < minLng || b.lng > maxLng) {
    throw validation('That location is outside Lesotho. Check the latitude (about -29) and longitude (about 27.5) are not swapped')
  }
  const clean = (s?: string) => (s?.trim() ? s.trim() : undefined)
  return { ...b, name: b.name.trim(), address: b.address.trim(), hours: clean(b.hours), phone: clean(b.phone), code: clean(b.code)?.toUpperCase() }
}

export async function createPlace(q: Queryable, body: PlaceBody, adminEmail: string): Promise<Place> {
  const b = check(body)
  const [r] = await q.query<PlaceRow>(
    `INSERT INTO places (id, kind, name, address, lat, lng, hours, phone, code, enabled, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [newId(), b.kind, b.name, b.address, b.lat, b.lng, b.hours ?? null, b.phone ?? null, b.code ?? null, b.enabled, adminEmail],
  )
  return toPlace(r)
}

export async function updatePlace(q: Queryable, id: string, body: PlaceBody): Promise<Place> {
  const b = check(body)
  const [r] = await q.query<PlaceRow>(
    `UPDATE places SET kind = $2, name = $3, address = $4, lat = $5, lng = $6, hours = $7, phone = $8, code = $9, enabled = $10, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, b.kind, b.name, b.address, b.lat, b.lng, b.hours ?? null, b.phone ?? null, b.code ?? null, b.enabled],
  )
  if (!r) throw notFound('Place not found')
  return toPlace(r)
}

export async function deletePlace(q: Queryable, id: string): Promise<Place> {
  const [r] = await q.query<PlaceRow>('DELETE FROM places WHERE id = $1 RETURNING *', [id])
  if (!r) throw notFound('Place not found')
  return toPlace(r)
}

// ---------- a business's own listing (EcoCash Business › Business profile) ----------

/** The listing of an agent or merchant: the place carrying its EcoCash code, enabled or not. */
export async function businessListing(q: Queryable, biz: { role: string; code: string | null }): Promise<Place | null> {
  if (!biz.code) return null
  const [r] = await q.query<PlaceRow>(`SELECT * FROM places WHERE code = $1 AND kind = $2 ORDER BY enabled DESC, created_at LIMIT 1`, [biz.code, biz.role])
  return r ? toPlace(r) : null
}

export interface ListingInput { name: string; address: string; hours?: string; phone?: string; lat?: number; lng?: number; listed: boolean }

/**
 * The business adds or edits its own listing. Its name always follows the business name EcoCash recorded; the code
 * and kind follow the account, so a business can only describe itself. A new listing needs the shop's location.
 */
export async function saveBusinessListing(q: Queryable, biz: { id: string; role: 'agent' | 'merchant'; code: string | null }, b: ListingInput): Promise<Place> {
  if (!biz.code) throw validation('This business has no EcoCash code yet. Visit an EcoCash shop')
  const current = await businessListing(q, biz)
  const lat = b.lat ?? current?.lat
  const lng = b.lng ?? current?.lng
  if (lat === undefined || lng === undefined) throw validation('Add the shop’s location: stand at the shop and use this phone’s location')
  const body = check({ kind: biz.role, name: b.name, address: b.address, lat, lng, hours: b.hours, phone: b.phone, code: biz.code, enabled: b.listed })
  if (!current) return createPlace(q, body, `business:${biz.id}`)
  return updatePlace(q, current.id, body)
}
