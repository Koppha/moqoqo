// Pictures uploaded in the portal: the in-app logo, the home-screen icon (for the next build), mini app icons and
// service icons.
import { MINI_APP_ICON_IDS, type Asset, type AssetKind, type AssetUploadBody, type Branding, type MiniAppIconId, type MiniAppIconPaths } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { iso } from '../lib/time'
import { setSetting } from './maintenance'
import { openBytes, sealBytes } from '../lib/vault'

const MAX_BYTES = 2 * 1024 * 1024

/** Width and height from the file itself (PNG IHDR, JPEG SOF), so a renamed file of another type is refused. */
export function imageSize(type: 'image/png' | 'image/jpeg', b: Buffer): { width: number; height: number } | null {
  if (type === 'image/png') {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (b.length < 24 || !b.subarray(0, 8).equals(sig) || b.subarray(12, 16).toString('latin1') !== 'IHDR') return null
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

interface AssetRow { id: string; kind: AssetKind; content_type: string; width: number; height: number; size_bytes: number; created_at: Date }
const toAsset = (r: AssetRow): Asset => ({ id: r.id, kind: r.kind, path: `/v1/assets/${r.id}`, width: r.width, height: r.height, size: r.size_bytes, createdAt: iso(r.created_at) })

export async function uploadAsset(q: Queryable, adminEmail: string, body: AssetUploadBody): Promise<Asset> {
  const b64 = body.base64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
  if (!b64 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(b64)) throw validation('The file is not valid base64')
  const content = Buffer.from(b64, 'base64')
  if (!content.length) throw validation('The file is empty')
  if (content.length > MAX_BYTES) throw validation('The picture is too large. The limit is 2 MB')
  const size = imageSize(body.contentType, content)
  if (!size) throw validation(`The file is not a valid ${body.contentType === 'image/png' ? 'PNG' : 'JPEG'} picture`)
  if (body.kind === 'app_icon') {
    if (body.contentType !== 'image/png') throw validation('The home-screen icon must be a PNG')
    if (size.width !== size.height || size.width < 512) throw validation('The home-screen icon must be square and at least 512 × 512 (1024 × 1024 is best)')
  }
  if ((body.kind === 'service_icon' || body.kind === 'logo' || body.kind === 'profile_photo') && Math.min(size.width, size.height) < 64) throw validation('The picture is too small: at least 64 px')
  const [r] = await q.query<AssetRow>(
    `INSERT INTO assets (id, kind, content_type, width, height, size_bytes, content, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, kind, content_type, width, height, size_bytes, created_at`,
    [newId(), body.kind, body.contentType, size.width, size.height, content.length, sealBytes(content), adminEmail],
  )
  return toAsset(r)
}

/**
 * A person's profile picture: the new one replaces (and deletes) the old; `null` removes it. The app crops it square
 * and shrinks it first.
 */
export async function setProfilePhoto(q: Queryable, userId: string, body: { contentType: 'image/png' | 'image/jpeg'; base64: string } | null): Promise<void> {
  const [u] = await q.query<{ photo_id: string | null }>('SELECT photo_id FROM users WHERE id = $1 FOR UPDATE', [userId])
  const photo = body ? await uploadAsset(q, `user:${userId}`, { kind: 'profile_photo', ...body }) : null
  await q.query('UPDATE users SET photo_id = $2 WHERE id = $1', [userId, photo?.id ?? null])
  if (u?.photo_id) await q.query(`DELETE FROM assets WHERE id = $1 AND kind = 'profile_photo'`, [u.photo_id])
}

export async function readAsset(q: Queryable, id: string): Promise<{ contentType: string; content: Buffer } | null> {
  const [r] = await q.query<{ content_type: string; content: Uint8Array }>('SELECT content_type, content FROM assets WHERE id = $1', [id])
  return r ? { contentType: r.content_type, content: openBytes(r.content) } : null
}

async function asset(q: Queryable, id: string | null | undefined, kind?: AssetKind): Promise<Asset | null> {
  if (!id) return null
  const [r] = await q.query<AssetRow>('SELECT id, kind, content_type, width, height, size_bytes, created_at FROM assets WHERE id = $1', [id])
  if (!r) return null
  if (kind && r.kind !== kind) throw validation(`That picture was uploaded as a ${r.kind.replace('_', ' ')}, not a ${kind.replace('_', ' ')}`)
  return toAsset(r)
}

interface BrandingSetting { logoId?: string | null; appIconId?: string | null; miniAppIcons?: Partial<Record<MiniAppIconId, string>> }

async function brandingSetting(q: Queryable): Promise<BrandingSetting> {
  const [row] = await q.query<{ value: BrandingSetting | null }>(`SELECT value FROM app_settings WHERE key = 'branding'`)
  return row?.value ?? {}
}

export async function getBranding(q: Queryable): Promise<Branding> {
  const v = await brandingSetting(q)
  const miniAppIcons: Branding['miniAppIcons'] = {}
  for (const id of MINI_APP_ICON_IDS) {
    const a = await asset(q, v.miniAppIcons?.[id])
    if (a) miniAppIcons[id] = a
  }
  return { logo: await asset(q, v.logoId), appIcon: await asset(q, v.appIconId), miniAppIcons }
}

/** For AppConfig: just the picture paths. */
export async function miniAppIconPaths(q: Queryable): Promise<MiniAppIconPaths> {
  const icons = (await getBranding(q)).miniAppIcons
  return Object.fromEntries(Object.entries(icons).map(([id, a]) => [id, a.path]))
}

export async function setBranding(q: Queryable, body: { logoId: string | null; appIconId: string | null }): Promise<Branding> {
  if (body.logoId && !(await asset(q, body.logoId, 'logo'))) throw notFound('Logo not found: upload it again')
  if (body.appIconId && !(await asset(q, body.appIconId, 'app_icon'))) throw notFound('Icon not found: upload it again')
  await setSetting(q, 'branding', { ...(await brandingSetting(q)), logoId: body.logoId, appIconId: body.appIconId })
  return getBranding(q)
}

/** A mini app's icon (an uploaded app icon: square PNG, at least 512 px), or null for its built-in one. */
export async function setMiniAppIcon(q: Queryable, id: MiniAppIconId, assetId: string | null): Promise<Branding> {
  if (assetId && !(await asset(q, assetId, 'app_icon'))) throw notFound('Icon not found: upload it again')
  const v = await brandingSetting(q)
  const miniAppIcons = { ...v.miniAppIcons }
  if (assetId) miniAppIcons[id] = assetId
  else delete miniAppIcons[id]
  await setSetting(q, 'branding', { ...v, miniAppIcons })
  return getBranding(q)
}

/** A service's picture must be an uploaded service icon. */
export async function checkServiceImage(q: Queryable, path: string | undefined): Promise<void> {
  if (!path) return
  const id = /^\/v1\/assets\/([\w-]+)$/.exec(path)?.[1]
  if (!id || !(await asset(q, id, 'service_icon'))) throw validation('Upload the service picture again')
}
