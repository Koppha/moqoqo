import type { Queryable } from '../db/index'
import { AppError, validation } from '../errors'
import { hashSecret, verifySecret } from '../lib/crypto'
import type { UserRow } from './users'

export const MAX_PIN_ATTEMPTS = 5
export const PIN_LOCK_MINUTES = 15

/**
 * Which PIN: the EcoCash wallet PIN (EcoCash Super App, EcoCash Business, and every payment), the EcoSure PIN the person
 * created for the standalone EcoSure app (signing in to EcoSure only), or the app PIN that opens EcoCash Super App when
 * the person set one (Me › Change PIN; payments still take the wallet PIN). Each has its own lockout.
 */
export type PinKind = 'wallet' | 'ecosure' | 'app'
const COLUMNS = {
  app: { hash: 'app_pin_hash', salt: 'app_pin_salt', failed: 'app_failed_pins', locked: 'app_locked_until' },
  wallet: { hash: 'pin_hash', salt: 'pin_salt', failed: 'failed_pins', locked: 'locked_until' },
  ecosure: { hash: 'ecosure_pin_hash', salt: 'ecosure_pin_salt', failed: 'ecosure_failed_pins', locked: 'ecosure_locked_until' },
} as const

export function parsePin(pin: unknown, field = 'pin'): string {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw validation(`${field} must be 4 digits`)
  return pin
}

/** A new PIN must not be easy to guess (1111, 1234, 9876). */
export function checkStrongPin(pin: string) {
  if (/^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    throw validation('That PIN is too easy to guess. Avoid 1111 or 1234')
  }
}

/**
 * Verifies a PIN with lockout: 5 wrong PINs in a row lock that PIN for 15 minutes; a correct PIN resets the counter.
 * Must run OUTSIDE money transactions so a failed attempt is never rolled back.
 */
export async function checkPin(db: Queryable, user: UserRow, pin: unknown, kind: PinKind = 'wallet'): Promise<void> {
  const value = parsePin(pin)
  const c = COLUMNS[kind]
  const [state] = await db.query<{ failed: number; locked_until: Date | null; locked: boolean; hash: string | null; salt: string | null }>(
    `SELECT ${c.failed} AS failed, ${c.locked} AS locked_until, (${c.locked} IS NOT NULL AND ${c.locked} > now()) AS locked,
       ${c.hash} AS hash, ${c.salt} AS salt FROM users WHERE id = $1`,
    [user.id],
  )
  if (state?.locked) throw lockedError(state.locked_until!)
  if (!state?.hash || !state.salt) {
    if (kind === 'ecosure') throw new AppError('PROFILE_NEEDED', 'Create your EcoSure profile first')
    throw new AppError('WRONG_PIN', 'This account cannot use a PIN')
  }

  if (await verifySecret(value, state.hash, state.salt)) {
    if (state.failed > 0 || state.locked_until) {
      await db.query(`UPDATE users SET ${c.failed} = 0, ${c.locked} = NULL WHERE id = $1`, [user.id])
    }
    return
  }
  const [after] = await db.query<{ failed: number; locked_until: Date | null }>(
    `UPDATE users SET
       ${c.failed} = CASE WHEN ${c.failed} + 1 >= $2 THEN 0 ELSE ${c.failed} + 1 END,
       ${c.locked} = CASE WHEN ${c.failed} + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
     WHERE id = $1 RETURNING ${c.failed} AS failed, ${c.locked} AS locked_until`,
    [user.id, MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES],
  )
  if (after?.locked_until) throw lockedError(after.locked_until, user.id)
  const left = MAX_PIN_ATTEMPTS - (after?.failed ?? 0)
  throw new AppError('WRONG_PIN', `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left`)
}

/** Sets (or resets) the EcoSure PIN, clearing its lockout. */
export async function setEcoSurePin(db: Queryable, userId: string, pin: unknown): Promise<void> {
  const value = parsePin(pin)
  if (/^(\d)\1{3}$/.test(value) || ['1234', '4321', '0123', '9876'].includes(value)) {
    throw validation('Choose a PIN that is harder to guess (not 1111 or 1234)')
  }
  const { hash, salt } = await hashSecret(value)
  await db.query('UPDATE users SET ecosure_pin_hash = $2, ecosure_pin_salt = $3, ecosure_failed_pins = 0, ecosure_locked_until = NULL WHERE id = $1', [userId, hash, salt])
}

function lockedError(until: Date, justLockedUserId?: string): AppError {
  const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000))
  return new AppError('PIN_LOCKED', `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}`, undefined, justLockedUserId)
}
