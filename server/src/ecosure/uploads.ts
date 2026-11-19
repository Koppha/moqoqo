// Claim and quote documents (photos or PDFs), uploaded one at a time as base64 before the claim/quote is sent.
import { createHash } from 'node:crypto'
import type { EsUpload, EsUploadBody } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { validation } from '../errors'
import { newId } from '../lib/crypto'
import type { UserRow } from '../services/users'
import { openBytes, sealBytes } from '../lib/vault'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
/** JSON body limit for the upload route: 10 MB as base64 (≈13.4 MB) plus room for the rest. */
export const UPLOAD_BODY_LIMIT = 15 * 1024 * 1024
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const
const UNUSED_TTL_HOURS = 24

/** File signatures, so a renamed file of another type is turned away. */
function looksLike(contentType: EsUploadBody['contentType'], b: Buffer): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'image/png':
      return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'application/pdf':
      return b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-'
  }
}

export async function createUpload(q: Queryable, me: UserRow, body: EsUploadBody): Promise<EsUpload> {
  const fileName = body.fileName.trim().replace(/[\\/\r\n"]/g, '_').slice(0, 120)
  if (!fileName) throw validation('fileName is required')
  // Accept a data URL too ("data:image/png;base64,…").
  const b64 = body.base64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
  if (!b64 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(b64)) throw validation('base64 is not valid base64')
  const content = Buffer.from(b64, 'base64')
  if (content.length === 0) throw validation('The file is empty')
  if (content.length > MAX_UPLOAD_BYTES) throw validation('The file is too large. The limit is 10 MB')
  if (!looksLike(body.contentType, content)) throw validation(`The file is not a valid ${body.contentType === 'application/pdf' ? 'PDF' : body.contentType.slice(6).toUpperCase()}`)

  // Opportunistic clean-up of documents that never made it into a claim or quote.
  await q.query(`DELETE FROM ecosure_uploads WHERE used_at IS NULL AND created_at < now() - make_interval(hours => $1)`, [UNUSED_TTL_HOURS])
  const id = newId()
  await q.query(
    `INSERT INTO ecosure_uploads (id, owner_id, file_name, content_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    // Sealed at rest (DATA_KEYS); the hash is of the original file.
    [id, me.id, fileName, body.contentType, content.length, createHash('sha256').update(content).digest('hex'), sealBytes(content)],
  )
  return { id, fileName, size: content.length }
}

/** Checks that every upload id belongs to `ownerId`; returns id → file name. Throws VALIDATION naming the label. */
export async function requireOwnUploads(q: Queryable, ownerId: string, docs: { label: string; uploadId: string }[]): Promise<Map<string, string>> {
  const ids = [...new Set(docs.map((d) => d.uploadId))]
  const rows = ids.length
    ? await q.query<{ id: string; file_name: string }>('SELECT id, file_name FROM ecosure_uploads WHERE id = ANY($1) AND owner_id = $2', [ids, ownerId])
    : []
  const found = new Map(rows.map((r) => [r.id, r.file_name]))
  for (const d of docs) if (!found.has(d.uploadId)) throw validation(`Upload the document "${d.label}" again`)
  return found
}

export async function markUsed(q: Queryable, ids: string[]) {
  if (ids.length) await q.query('UPDATE ecosure_uploads SET used_at = COALESCE(used_at, now()) WHERE id = ANY($1)', [ids])
}

/** File content for the back office. */
export async function readUpload(q: Queryable, id: string): Promise<{ fileName: string; contentType: string; content: Buffer } | null> {
  const [r] = await q.query<{ file_name: string; content_type: string; content: Uint8Array }>(
    'SELECT file_name, content_type, content FROM ecosure_uploads WHERE id = $1',
    [id],
  )
  return r ? { fileName: r.file_name, contentType: r.content_type, content: openBytes(r.content) } : null
}
