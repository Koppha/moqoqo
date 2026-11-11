import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'

const KEYLEN = 32

function scryptAsync(secret: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, KEYLEN, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

/** scrypt with a per-user random salt. Used for PINs and admin passwords. */
export async function hashSecret(secret: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex')
  return { hash: (await scryptAsync(secret, salt)).toString('hex'), salt }
}

export async function verifySecret(secret: string, hash: string, salt: string): Promise<boolean> {
  const actual = await scryptAsync(secret, salt)
  const expected = Buffer.from(hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

/** Opaque bearer token handed to the client; only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const newId = () => randomUUID()

/** Ledger reference: MP + 10 digits. */
export function newReference(): string {
  let digits = ''
  for (let i = 0; i < 10; i++) digits += randomInt(10)
  return `MP${digits}`
}

export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('')
export const randomPassword = () => randomBytes(12).toString('base64url')
