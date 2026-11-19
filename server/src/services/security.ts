// Security controls from the CBL/LCA DFS Security Guidelines (Nov 2025 draft): the sign-in event log (3.2.5b-vi),
// fingerprint for payments on the phone's keystore (3.2.5b-iii), customers removing or reporting a phone
// (3.2.3b-ii, 3.2.8d). Session expiry lives in http.ts, PIN lockout in pins.ts, settings in App settings.
import { PAY_BIOMETRIC_PREFIX, type BoundDevice } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, notFound, validation } from '../errors'
import { hashToken, newId, newToken } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { logAuthEvent } from './authLog'
import { listDevices } from './onboarding'
import { checkPin } from './pins'
import type { UserRow } from './users'

// ---------- fingerprint for payments ----------

/** Turn it on for this phone, after the wallet PIN. Any earlier token for this phone is revoked. */
export async function enablePayBiometric(ctx: Ctx, user: UserRow, deviceRowId: string | null, pin: string, ip: string): Promise<{ token: string }> {
  await checkPin(ctx.db, user, pin)
  const token = PAY_BIOMETRIC_PREFIX + newToken()
  await ctx.db.tx(async (q) => {
    await q.query(
      `UPDATE pay_biometric_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND bound_device_id IS NOT DISTINCT FROM $2`,
      [user.id, deviceRowId],
    )
    await q.query('INSERT INTO pay_biometric_keys (id, user_id, bound_device_id, token_hash) VALUES ($1, $2, $3, $4)', [newId(), user.id, deviceRowId, hashToken(token)])
    await logAuthEvent(q, { userId: user.id, kind: 'pay_biometric_on', ip })
  })
  return { token }
}

export async function disablePayBiometric(ctx: Ctx, user: UserRow, deviceRowId: string | null, ip: string) {
  await ctx.db.query(
    `UPDATE pay_biometric_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND bound_device_id IS NOT DISTINCT FROM $2`,
    [user.id, deviceRowId],
  )
  await logAuthEvent(ctx.db, { userId: user.id, kind: 'pay_biometric_off', ip })
}

// ---------- removing and reporting phones ----------

async function signOutDevices(ctx: Ctx, q: Queryable, userId: string, deviceRowIds: string[]) {
  if (!deviceRowIds.length) return
  await q.query('DELETE FROM sessions WHERE user_id = $1 AND bound_device_id = ANY($2)', [userId, deviceRowIds])
  await q.query('UPDATE pay_biometric_keys SET revoked_at = now() WHERE bound_device_id = ANY($1) AND revoked_at IS NULL', [deviceRowIds])
}

/** Me › Phones: the customer signs another of their phones out (not the one in their hand). */
export async function removeOwnDevice(ctx: Ctx, user: UserRow, currentDeviceRowId: string | null, deviceRowId: string, ip: string): Promise<BoundDevice[]> {
  if (deviceRowId === currentDeviceRowId) throw validation('Use Log out to sign this phone out')
  await ctx.db.tx(async (q) => {
    const [d] = await q.query<{ id: string; model: string }>(
      `UPDATE bound_devices SET unbound_at = now(), unbound_reason = 'removed_by_user' WHERE id = $1 AND user_id = $2 AND unbound_at IS NULL RETURNING id, model`,
      [deviceRowId, user.id],
    )
    if (!d) throw notFound('Phone not found')
    await signOutDevices(ctx, q, user.id, [d.id])
    await logAuthEvent(q, { userId: user.id, kind: 'device_removed', ip, detail: d.model })
  })
  // Its live connection closes; this phone reconnects on its own (its session is still valid).
  ctx.hub.disconnectUser(user.id, 4401, 'UNAUTHORIZED')
  return listDevices(ctx.db, user.id, currentDeviceRowId)
}

/**
 * The login screen's "Lost your phone?": number and wallet PIN (the PIN lockout applies) sign every phone out of this
 * wallet at once. Setting up again needs a phone with the wallet's SIM, the ID check and an SMS code.
 */
export async function reportLostPhone(ctx: Ctx, body: { msisdn: string; pin: string }, ip: string): Promise<{ signedOut: number }> {
  const msisdn = normalizeMsisdn(body.msisdn)
  const [user] = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (!user) throw new AppError('NOT_REGISTERED', 'No EcoCash wallet with that number')
  await checkPin(ctx.db, user, body.pin)
  const devices = await ctx.db.tx(async (q) => {
    const rows = await q.query<{ id: string }>(
      `UPDATE bound_devices SET unbound_at = now(), unbound_reason = 'reported_lost' WHERE user_id = $1 AND unbound_at IS NULL RETURNING id`,
      [user.id],
    )
    await q.query('DELETE FROM sessions WHERE user_id = $1', [user.id])
    await q.query('UPDATE pay_biometric_keys SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id])
    await logAuthEvent(q, { userId: user.id, kind: 'reported_lost', ip, detail: `${rows.length} phone(s) signed out` })
    return rows
  })
  ctx.hub.disconnectUser(user.id, 4401, 'UNAUTHORIZED')
  void ctx.notifier.send({
    userIds: [user.id],
    category: 'security',
    title: 'Phone reported lost',
    body: 'Your EcoCash wallet was signed out of every phone because a phone was reported lost. To use the app again, set it up on a phone with your SIM.',
  })
  return { signedOut: devices.length }
}
