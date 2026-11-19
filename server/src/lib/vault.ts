// Encryption at rest for sensitive fields (CBL/LCA DFS guidelines 3.2.6g–i): AES-256-GCM with keys from DATA_KEYS
// ("kid:base64-32-bytes,kid:…", the first is current). Every sealed value names its key, so keys rotate: add a new key
// first, run `npm run rotate-data-key` to re-seal everything with it, then drop the old one. In production the keys
// belong in a key vault or HSM that hands them to the server at start (ETL infrastructure); never in the code or git.
// Without DATA_KEYS (development, tests) values are stored as they are, and anything not sealed reads as it is,
// so turning encryption on needs no migration of old rows (the rotate script seals them).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

interface Key { id: string; key: Buffer }
let keys: Key[] = []

/** Parses DATA_KEYS; throws on a malformed key so a bad deploy fails at start, not on the first read. */
export function configureVault(spec: string | undefined | null) {
  keys = (spec ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
    const [id, b64] = part.split(':')
    const key = Buffer.from(b64 ?? '', 'base64')
    if (!id || !/^[A-Za-z0-9_-]{1,16}$/.test(id) || key.length !== 32) throw new Error('DATA_KEYS: each key is "id:base64 of 32 bytes"')
    return { id, key }
  })
  if (new Set(keys.map((k) => k.id)).size !== keys.length) throw new Error('DATA_KEYS: key ids must differ')
}
export const vaultOn = () => keys.length > 0
export const currentKeyId = () => keys[0]?.id ?? null
const keyById = (id: string) => {
  const k = keys.find((x) => x.id === id)
  if (!k) throw new Error(`Encrypted with key "${id}", which is not in DATA_KEYS`)
  return k.key
}

const TEXT_PREFIX = 'enc:v1:'
const MAGIC = Buffer.from('ECV1')

function seal(plain: Buffer): { id: string; iv: Buffer; tag: Buffer; ct: Buffer } {
  const { id, key } = keys[0]
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain), c.final()])
  return { id, iv, tag: c.getAuthTag(), ct }
}
function open(id: string, iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', keyById(id), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

/** "enc:v1:<kid>:<iv>:<tag>:<ciphertext>" (base64url parts), or the text as it is when encryption is off. */
export function sealText(plain: string): string {
  if (!vaultOn()) return plain
  const s = seal(Buffer.from(plain, 'utf8'))
  return `${TEXT_PREFIX}${s.id}:${s.iv.toString('base64url')}:${s.tag.toString('base64url')}:${s.ct.toString('base64url')}`
}
export const isSealedText = (v: unknown): v is string => typeof v === 'string' && v.startsWith(TEXT_PREFIX)
export function openText(v: string): string {
  if (!isSealedText(v)) return v
  const [id, iv, tag, ct] = v.slice(TEXT_PREFIX.length).split(':')
  return open(id, Buffer.from(iv, 'base64url'), Buffer.from(tag, 'base64url'), Buffer.from(ct, 'base64url')).toString('utf8')
}

/** "ECV1" + key id length + key id + iv + tag + ciphertext, or the bytes as they are when encryption is off. */
export function sealBytes(plain: Buffer): Buffer {
  if (!vaultOn()) return plain
  const s = seal(plain)
  const id = Buffer.from(s.id)
  return Buffer.concat([MAGIC, Buffer.from([id.length]), id, s.iv, s.tag, s.ct])
}
export const isSealedBytes = (b: Uint8Array) => b.length > 5 && Buffer.from(b.subarray(0, 4)).equals(MAGIC)
export function openBytes(raw: Uint8Array): Buffer {
  const b = Buffer.from(raw)
  if (!isSealedBytes(b)) return b
  const n = b[4]
  const id = b.subarray(5, 5 + n).toString()
  const at = 5 + n
  return open(id, b.subarray(at, at + 12), b.subarray(at + 12, at + 28), b.subarray(at + 28))
}

/** The key a sealed value uses, or null when it is not sealed. */
export function keyIdOf(v: string | Uint8Array): string | null {
  if (typeof v === 'string') return isSealedText(v) ? v.slice(TEXT_PREFIX.length).split(':')[0] : null
  if (!isSealedBytes(v)) return null
  return Buffer.from(v.subarray(5, 5 + v[4])).toString()
}

/** JSON values (jsonb columns): sealed as a JSON string, opened back to the value. */
export const sealJson = (value: unknown): unknown => (vaultOn() ? sealText(JSON.stringify(value)) : value)
export const openJson = <T>(value: unknown): T => (isSealedText(value) ? (JSON.parse(openText(value)) as T) : (value as T))
