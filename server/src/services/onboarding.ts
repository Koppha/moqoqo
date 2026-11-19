// Sign-up on a phone: EcoCash number + PIN, Home Affairs ID check, OTP by SMS, then the wallet is bound to the phone.
import { z } from 'zod'
import {
  APP_NAMES,
  deviceBlockReason,
  ECONET_SIM,
  ECOSURE_PROFILE_NETWORKS,
  phoneNetwork,
  OTP_LENGTH,
  OTP_RESEND_SECONDS,
  type AppKind,
  type BoundDevice,
  type DeviceInfo,
  type LoginResponse,
  type NetworkCheck,
  type EcoSureProfileStart,
  type OnboardingNext,
  type OnboardingOtpSent,
  type OnboardingStart,
  type SimCheck,
  SMS_CODE_PREFIX,
  TERMS_VERSION,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, notFound, validation } from '../errors'
import type { IdRecord } from '../gateways/homeaffairs'
import { hashToken, newId, newToken, randomDigits } from '../lib/crypto'
import { iso, isoOrNull } from '../lib/time'
import { checkSetupHold } from './simSwap'
import { summarize } from './deviceContext'
import { normalizeMsisdn } from '../lib/msisdn'
import { deviceSecurity } from './maintenance'
import { setEcoSurePin } from './pins'
import { toMe, type UserRow } from './users'
import { claimInvites } from './friends'

const ONBOARDING_MINUTES = 30
const OTP_TTL_SECONDS = 5 * 60
const MAX_CONFIRM_TRIES = 3
const MAX_OTP_TRIES = 5
/** EcoSure profile sign-ups a number may start per hour (each sends an SMS code). */
export const PROFILE_STARTS_PER_HOUR = 3

export const zDevice = z.object({
  deviceId: z.string().trim().min(4).max(100),
  platform: z.enum(['android', 'ios']),
  model: z.string().trim().min(1).max(80),
  osVersion: z.string().trim().max(40),
  appVersion: z.string().trim().max(40),
  integrity: z.object({ rooted: z.boolean(), developerMode: z.boolean(), emulator: z.boolean() }).optional(),
})

/**
 * Refuses a phone the portal's device security blocks (rooted or jailbroken, or in developer mode). The app checks
 * too and shows why; this is the check that counts, since an app can be altered. An app too old to report is refused
 * while a block is on.
 */
export async function checkDeviceAllowed(q: Queryable, device: DeviceInfo): Promise<void> {
  const reason = deviceBlockReason(await deviceSecurity(q), device.integrity)
  if (reason === 'rooted') throw new AppError('DEVICE_BLOCKED', 'This app does not run on rooted or jailbroken phones')
  if (reason === 'developer') throw new AppError('DEVICE_BLOCKED', 'Turn off developer options and USB debugging on this phone to use the app')
  if (reason === 'unknown') throw new AppError('DEVICE_BLOCKED', 'Update the app to sign in on this phone')
}
export const zNetwork = z.object({
  type: z.enum(['cellular', 'wifi', 'none', 'other']),
  sims: z.array(z.object({
    mcc: z.string().max(3).nullable(), mnc: z.string().max(3).nullable(), carrier: z.string().max(60).nullable(), number: z.string().max(20).nullable().optional(),
  })).max(4),
  simulated: z.boolean().optional(),
})

/** "+266 62•• ••21" */
export const maskMsisdn = (m: string) => `${m.slice(0, 4)} ${m.slice(4, 6)}•• ••${m.slice(-2)}`

/**
 * Setting up a phone needs an Econet SIM on Econet mobile data. The app reports what it sees; ETL's header
 * enrichment (the number added by Econet's network to requests over mobile data) will make this a network-side
 * check — until then this is what the server can check.
 */
export function checkEconet(ctx: Ctx, network: NetworkCheck, app: AppKind = 'customer'): void {
  const name = APP_NAMES[app]
  if (network.simulated) {
    if (ctx.config.allowSimulatedNetwork) return
    throw new AppError('NOT_ECONET', `Use an Econet SIM on Econet mobile data to set up ${name}`)
  }
  if (network.type !== 'cellular') throw new AppError('NOT_ECONET', `Turn off Wi-Fi and use Econet mobile data to set up ${name} on this phone`)
  // iPhones don't report SIMs; header enrichment will cover them.
  if (network.sims.length && !network.sims.some((s) => s.mcc === ECONET_SIM.mcc && s.mnc === ECONET_SIM.mnc)) {
    throw new AppError('NOT_ECONET', `Insert your Econet SIM to set up ${name} on this phone`)
  }
}

/**
 * First sign-in on a phone: is the wallet's SIM in it? Econet's verified number for the connection is the proof (when
 * connected); otherwise the numbers the phone's SIMs report (Android, when the SIM stores it). A clearly different
 * number is refused when the portal requires a match (App settings), else recorded as a mismatch.
 */
export async function checkSimInPhone(ctx: Ctx, msisdn: string, network: NetworkCheck, verifiedNumber: string | null): Promise<SimCheck> {
  if (network.simulated && ctx.config.allowSimulatedNetwork) return 'simulated'
  const policy = await deviceSecurity(ctx.db)
  const other = (): SimCheck => {
    if (!policy.requireSimMatch) return 'mismatch'
    throw new AppError('SIM_NOT_IN_PHONE', `The SIM card in this phone isn't the one for ${maskMsisdn(msisdn)}. Put that SIM in this phone to set up EcoCash`)
  }
  if (verifiedNumber) return verifiedNumber === msisdn ? 'network' : other()
  const numbers = network.sims.flatMap((s) => {
    if (!s.number) return []
    try {
      return [normalizeMsisdn(s.number)]
    } catch {
      return []
    }
  })
  if (numbers.length) return numbers.includes(msisdn) ? 'sim' : other()
  return network.sims.some((s) => s.mcc === ECONET_SIM.mcc && s.mnc === ECONET_SIM.mnc) ? 'econet_sim' : 'unknown'
}

interface OnboardingRow {
  id: string
  user_id: string
  app: AppKind
  /** login: a new phone after number + PIN. profile: creating (or resetting) an EcoSure profile and its PIN. */
  purpose: 'login' | 'profile'
  device: DeviceInfo
  network: NetworkCheck
  step: 'identity' | 'confirm' | 'otp' | 'pin' | 'done' | 'failed'
  id_number: string | null
  record: IdRecord | null
  confirm_tries: number
  otp_hash: string | null
  otp_sent_at: Date | null
  otp_expires_at: Date | null
  otp_tries: number
  expires_at: Date
  sim_check: SimCheck | null
}

/**
 * Travelling abroad (Me › Notifications › codes by email, on with the PIN, until a date): the phone is set up off
 * Econet's network (roaming or Wi-Fi) and the code goes to the confirmed email instead of by SMS. The ID check, the
 * SIM-swap hold and the new-phone cash-out rule still apply.
 */
export async function codesByEmail(q: Queryable, userId: string): Promise<string | null> {
  const [u] = await q.query<{ email: string | null }>(
    'SELECT email FROM users WHERE id = $1 AND codes_by_email_until > now() AND email_verified_at IS NOT NULL',
    [userId],
  )
  return u?.email ?? null
}

/** "le••••@gmail.com" */
const maskEmail = (e: string) => {
  const [name, domain] = e.split('@')
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`
}

export async function startOnboarding(ctx: Ctx, user: UserRow, app: AppKind, device: DeviceInfo, network: NetworkCheck, verifiedNumber: string | null = null): Promise<OnboardingStart> {
  const travelling = !!(await codesByEmail(ctx.db, user.id))
  if (!travelling) checkEconet(ctx, network, app)
  const simCheck: SimCheck = travelling ? 'travel' : await checkSimInPhone(ctx, user.msisdn ?? '', network, verifiedNumber)
  // A new phone right after a SIM swap is how SIM-swap fraud takes a wallet over: refused until staff check the owner.
  await checkSetupHold(ctx, user)
  const id = newId()
  const [row] = await ctx.db.query<{ expires_at: Date }>(
    `INSERT INTO onboarding (id, user_id, app, device, network, sim_check, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) RETURNING expires_at`,
    [id, user.id, app, JSON.stringify(device), JSON.stringify(network), simCheck, ONBOARDING_MINUTES],
  )
  return { id, msisdn: maskMsisdn(user.msisdn ?? ''), expiresAt: iso(row.expires_at) }
}

/**
 * The standalone EcoSure app: create an EcoSure profile (or reset its PIN). No PIN to give yet, so the SMS code comes
 * first: only the phone's owner gets to the ID check. Then ID, then their own EcoSure PIN.
 * For now the number must be an Econet number with an EcoCash account (profiles for other numbers come later).
 */
export async function startProfile(ctx: Ctx, msisdnRaw: string, device: DeviceInfo, network: NetworkCheck): Promise<EcoSureProfileStart> {
  const msisdn = normalizeMsisdn(msisdnRaw)
  const net = phoneNetwork(msisdn)
  if (!net || !ECOSURE_PROFILE_NETWORKS.includes(net)) throw new AppError('NOT_ECONET', 'EcoSure profiles are for Econet numbers for now')
  checkEconet(ctx, network, 'ecosure')
  const [user] = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (!user) throw new AppError('NOT_REGISTERED', `${msisdn} has no EcoCash account yet. EcoSure profiles for other numbers are coming soon`)
  if (user.status === 'suspended') throw new AppError('SUSPENDED', 'This account is suspended. Please contact EcoCash')
  await checkDeviceAllowed(ctx.db, device)
  await checkSetupHold(ctx, user)
  const simCheck = await checkSimInPhone(ctx, msisdn, network, null)
  const [{ n }] = await ctx.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM onboarding WHERE user_id = $1 AND purpose = 'profile' AND created_at > now() - interval '1 hour'`,
    [user.id],
  )
  if (n >= PROFILE_STARTS_PER_HOUR) throw new AppError('LIMIT_EXCEEDED', 'Too many tries for this number. Try again in an hour')
  const id = newId()
  const [row] = await ctx.db.query<OnboardingRow>(
    `INSERT INTO onboarding (id, user_id, app, purpose, device, network, sim_check, step, expires_at)
     VALUES ($1, $2, 'ecosure', 'profile', $3, $4, $5, 'otp', now() + make_interval(mins => $6)) RETURNING *`,
    [id, user.id, JSON.stringify(device), JSON.stringify(network), simCheck, ONBOARDING_MINUTES],
  )
  const sent = await sendOtp(ctx, row)
  return { onboarding: { id, msisdn: maskMsisdn(msisdn), expiresAt: iso(row.expires_at) }, sent }
}

async function requireOnboarding(q: Queryable, id: string, step: OnboardingRow['step'] | OnboardingRow['step'][]): Promise<OnboardingRow> {
  const [o] = await q.query<OnboardingRow & { expired: boolean }>('SELECT *, expires_at < now() AS expired FROM onboarding WHERE id = $1', [id])
  if (!o) throw notFound('Start again: enter your number and PIN')
  if (o.expired || o.step === 'failed') throw new AppError('VALIDATION', 'This sign-up has expired. Start again: enter your number and PIN')
  const steps = Array.isArray(step) ? step : [step]
  if (!steps.includes(o.step)) throw new AppError('CONFLICT', 'Do the steps in order: start again if needed')
  return o
}

const normaliseId = (raw: string) => raw.replace(/[\s-]/g, '').toUpperCase()

/** Step 2: Home Affairs looks up the ID; the person sees the name on record. */
export async function identity(ctx: Ctx, id: string, idNumberRaw: string): Promise<{ fullName: string }> {
  const o = await requireOnboarding(ctx.db, id, ['identity', 'confirm'])
  const idNumber = normaliseId(idNumberRaw)
  if (!/^[0-9A-Z]{6,20}$/.test(idNumber)) throw validation('Enter the ID number as it is on your ID')
  const [user] = await ctx.db.query<UserRow & { id_number: string | null }>('SELECT * FROM users WHERE id = $1', [o.user_id])
  if (user.id_number && user.id_number !== idNumber) throw new AppError('ID_MISMATCH', 'This ID is not the one registered for this EcoCash number')
  const [other] = await ctx.db.query<{ id: string }>('SELECT id FROM users WHERE id_number = $1 AND id <> $2', [idNumber, o.user_id])
  if (other) throw new AppError('ID_MISMATCH', 'This ID is already used by another EcoCash wallet. Visit an EcoCash shop')
  const record = await ctx.homeAffairs.lookup(idNumber)
  if (!record) throw new AppError('ID_MISMATCH', 'Home Affairs has no record of this ID number. Check it and try again')
  await ctx.db.query(`UPDATE onboarding SET id_number = $2, record = $3, step = 'confirm' WHERE id = $1`, [id, idNumber, JSON.stringify(record)])
  return { fullName: record.fullName }
}

/** Step 3: the person confirms the name and types date of birth and gender; they must match. Then the OTP. */
export async function confirm(ctx: Ctx, id: string, body: { nameConfirmed: boolean; dob: string; gender: 'female' | 'male' }): Promise<OnboardingOtpSent | OnboardingNext> {
  const o = await requireOnboarding(ctx.db, id, 'confirm')
  if (!body.nameConfirmed) throw new AppError('ID_MISMATCH', "If this isn't your name, check the ID number or visit an EcoCash shop")
  const r = o.record!
  if (body.dob !== r.dob || body.gender !== r.gender) {
    const tries = o.confirm_tries + 1
    await ctx.db.query(`UPDATE onboarding SET confirm_tries = $2::int, step = CASE WHEN $2::int >= $3::int THEN 'failed' ELSE step END WHERE id = $1`, [id, tries, MAX_CONFIRM_TRIES])
    if (tries >= MAX_CONFIRM_TRIES) throw new AppError('ID_MISMATCH', "The details don't match Home Affairs. Visit an EcoCash shop with your ID")
    throw new AppError('ID_MISMATCH', `The date of birth or gender doesn't match your ID. ${MAX_CONFIRM_TRIES - tries} ${MAX_CONFIRM_TRIES - tries === 1 ? 'try' : 'tries'} left`)
  }
  // An EcoSure profile already proved the phone with the code: the new PIN is next.
  if (o.purpose === 'profile') {
    await ctx.db.query(`UPDATE onboarding SET step = 'pin' WHERE id = $1`, [id])
    return { next: 'pin' }
  }
  return sendOtp(ctx, o)
}

export async function resend(ctx: Ctx, id: string): Promise<OnboardingOtpSent> {
  const o = await requireOnboarding(ctx.db, id, 'otp')
  if (o.otp_sent_at && Date.now() - new Date(o.otp_sent_at).getTime() < OTP_RESEND_SECONDS * 1000) {
    throw validation(`Wait ${OTP_RESEND_SECONDS} seconds before asking for a new code`)
  }
  return sendOtp(ctx, o)
}

async function sendOtp(ctx: Ctx, o: OnboardingRow): Promise<OnboardingOtpSent> {
  const code = randomDigits(OTP_LENGTH)
  await ctx.db.query(
    `UPDATE onboarding SET step = 'otp', otp_hash = $2, otp_sent_at = now(), otp_expires_at = now() + make_interval(secs => $3), otp_tries = 0 WHERE id = $1`,
    [o.id, hashToken(`${o.id}:${code}`), OTP_TTL_SECONDS],
  )
  const [u] = await ctx.db.query<{ msisdn: string }>('SELECT msisdn FROM users WHERE id = $1', [o.user_id])
  const email = o.purpose === 'login' ? await codesByEmail(ctx.db, o.user_id) : null
  if (email) {
    const subject = `Your ${APP_NAMES[o.app]} code`
    const body = `Your ${APP_NAMES[o.app]} code is ${code}. It sets up ${APP_NAMES[o.app]} on ${o.device.model} and expires in ${OTP_TTL_SECONDS / 60} minutes. You get codes by email because you said you are travelling. Never share it, not even with EcoCash staff. If you didn't ask for it, call EcoCash customer care.`
    try {
      await ctx.notifier.email.send(email, subject, body)
    } catch (err) {
      ctx.log.warn({ err: (err as Error).message }, 'otp email failed')
      throw new AppError('UNKNOWN', "We couldn't send the email. Try again in a moment")
    }
    const mockEmail = !ctx.notifier.email.real
    await ctx.db.query(
      `INSERT INTO notifications (id, user_id, channel, category, recipient, title, body, status) VALUES ($1, $2, 'email', 'security', $3, $4, $5, $6)`,
      [newId(), o.user_id, email, subject, mockEmail ? body : body.replace(code, '••••••'), mockEmail ? 'mock' : 'sent'],
    )
    const viaEmail: OnboardingOtpSent = { sentTo: maskEmail(email), channel: 'email', resendAfter: OTP_RESEND_SECONDS }
    if (mockEmail) viaEmail.devCode = code
    return viaEmail
  }
  // "<#>" first and the app's hash on the last line let Android hand the code to the app without SMS access
  // (SMS Retriever, DFS guidelines 3.2.5b-iv). Without a hash configured the SMS is the same, minus that line.
  const hash = ctx.config.smsAppHashes[o.app]
  const text = `${SMS_CODE_PREFIX} ${APP_NAMES[o.app]}: your code is ${code}. It sets up ${APP_NAMES[o.app]} on ${o.device.model}. Never share it, not even with EcoCash staff.${hash ? `\n${hash}` : ''}`
  try {
    await ctx.notifier.sms.send(u.msisdn, text)
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message }, 'otp sms failed')
    throw new AppError('UNKNOWN', "We couldn't send the SMS. Try again in a moment")
  }
  const mock = !ctx.notifier.sms.real
  await ctx.db.query(
    `INSERT INTO notifications (id, user_id, channel, category, recipient, title, body, status) VALUES ($1, $2, 'sms', 'security', $3, 'Sign-up code', $4, $5)`,
    [newId(), o.user_id, u.msisdn, mock ? text : text.replace(code, '••••••'), mock ? 'mock' : 'sent'],
  )
  const sent: OnboardingOtpSent = { sentTo: maskMsisdn(u.msisdn), channel: 'sms', resendAfter: OTP_RESEND_SECONDS }
  if (mock) sent.devCode = code
  return sent
}

/**
 * Step 4: the OTP. Binds the wallet to this phone (the previous phone is signed out) and signs in. Creating an EcoSure
 * profile, the code is the first step: the ID check is next.
 */
export async function verify(ctx: Ctx, id: string, otp: string, acceptTerms = false): Promise<LoginResponse | OnboardingNext> {
  const o = await requireOnboarding(ctx.db, id, 'otp')
  // Explicit consent before the app is registered on this phone (DFS guidelines 3.2.5): checked before the code is used.
  if (o.purpose === 'login' && !acceptTerms) throw new AppError('TERMS_REQUIRED', 'Accept the terms of use and privacy notice to continue')
  if (!o.otp_expires_at || new Date(o.otp_expires_at).getTime() < Date.now()) throw validation('The code has expired. Ask for a new one')
  if (o.otp_tries >= MAX_OTP_TRIES) throw validation('Too many wrong codes. Ask for a new one')
  if (o.otp_hash !== hashToken(`${o.id}:${otp.trim()}`)) {
    await ctx.db.query('UPDATE onboarding SET otp_tries = otp_tries + 1 WHERE id = $1', [id])
    throw validation('That code is not right. Check it and try again')
  }
  if (o.purpose === 'profile') {
    await ctx.db.query(`UPDATE onboarding SET step = 'identity' WHERE id = $1 AND step = 'otp'`, [id])
    return { next: 'identity' }
  }
  return finish(ctx, o, true)
}

/** Creating an EcoSure profile, last step: the person's own EcoSure PIN. Then this phone is bound and they're in. */
export async function setPin(ctx: Ctx, id: string, pin: string): Promise<LoginResponse> {
  const o = await requireOnboarding(ctx.db, id, 'pin')
  await setEcoSurePin(ctx.db, o.user_id, pin)
  return finish(ctx, o)
}

/** Binds the account to this phone for the app (the previous phone is signed out) and signs in. */
async function finish(ctx: Ctx, o: OnboardingRow, acceptedTerms = false): Promise<LoginResponse> {
  const id = o.id
  const token = newToken()
  const { user, previous } = await ctx.db.tx(async (q) => {
    if (acceptedTerms) await q.query('UPDATE users SET terms_accepted_at = now(), terms_version = $2 WHERE id = $1', [o.user_id, TERMS_VERSION])
    const done = await q.query(`UPDATE onboarding SET step = 'done' WHERE id = $1 AND step = $2 RETURNING id`, [id, o.step])
    if (!done.length) throw new AppError('CONFLICT', 'This sign-up was already finished')
    const previous = await q.query<{ id: string; model: string }>(
      `UPDATE bound_devices SET unbound_at = now(), unbound_reason = 'replaced' WHERE user_id = $1 AND app = $2 AND unbound_at IS NULL RETURNING id, model`,
      [o.user_id, o.app],
    )
    // Their sessions go with them (ON DELETE CASCADE only covers deleted rows), and so do sessions from before binding.
    await q.query(
      `DELETE FROM sessions WHERE user_id = $1 AND app = $2 AND (bound_device_id IS NULL OR bound_device_id = ANY($3))`,
      [o.user_id, o.app, previous.map((p) => p.id)],
    )
    const deviceRow = newId()
    const d = o.device
    await q.query(
      `INSERT INTO bound_devices (id, user_id, app, device_id, platform, model, os_version, app_version, sim_check, sims, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [deviceRow, o.user_id, o.app, d.deviceId, d.platform, d.model, d.osVersion, d.appVersion, o.sim_check, JSON.stringify(o.network?.sims ?? [])],
    )
    const r = o.record!
    await q.query(
      `UPDATE users SET id_number = COALESCE(id_number, $2), dob = COALESCE(dob, $3), gender = COALESCE(gender, $4),
         id_verified_at = COALESCE(id_verified_at, now()), last_seen_at = now() WHERE id = $1`,
      [o.user_id, o.id_number, r.dob, r.gender],
    )
    await q.query('INSERT INTO sessions (token_hash, user_id, app, bound_device_id) VALUES ($1, $2, $3, $4)', [hashToken(token), o.user_id, o.app, deviceRow])
    const [user] = await q.query<UserRow>('SELECT * FROM users WHERE id = $1', [o.user_id])
    return { user, previous }
  })
  ctx.hub.disconnectUser(user.id, 4401, 'UNAUTHORIZED') // the old phone's live connection
  // Invites sent to this number become friend requests waiting for them.
  await claimInvites(ctx, user).catch((err) => ctx.log.warn({ err: (err as Error).message }, 'claim invites failed'))
  void ctx.notifier.send({
    userIds: [user.id],
    category: 'security',
    title: `${APP_NAMES[o.app]} set up on a new phone`,
    body: `${APP_NAMES[o.app]} is now set up on ${o.device.model}.${previous.length ? ` ${previous[0].model} was signed out.` : ''} If this wasn't you, call EcoCash customer care now.`,
    channels: ['sms', 'email'],
  })
  return { token, user: toMe(user) }
}

// ---------- bound phones ----------

interface DeviceRow {
  id: string
  app: AppKind
  device_id: string
  platform: 'android' | 'ios'
  model: string
  os_version: string
  app_version: string
  bound_at: Date
  last_seen_at: Date | null
  unbound_at: Date | null
  unbound_reason: BoundDevice['unboundReason'] | null
  sim_check: SimCheck | null
  profile: Record<string, unknown> | null
}

export async function listDevices(q: Queryable, userId: string, currentRowId?: string | null, forStaff = false): Promise<BoundDevice[]> {
  const rows = await q.query<DeviceRow>('SELECT * FROM bound_devices WHERE user_id = $1 ORDER BY (unbound_at IS NULL) DESC, bound_at DESC LIMIT 50', [userId])
  return rows.map((r) => {
    const d: BoundDevice = {
      id: r.id, model: r.model, platform: r.platform, osVersion: r.os_version, appVersion: r.app_version, app: r.app,
      boundAt: iso(r.bound_at), lastSeenAt: isoOrNull(r.last_seen_at),
    }
    if (r.unbound_at) d.unboundAt = iso(r.unbound_at)
    if (r.unbound_reason) d.unboundReason = r.unbound_reason
    if (r.sim_check) d.simCheck = r.sim_check
    if (forStaff) d.profile = summarize(r.profile)
    if (currentRowId && r.id === currentRowId) d.current = true
    return d
  })
}

/** The active bound phone for this wallet and app, if it's this one. */
export async function boundDevice(q: Queryable, userId: string, app: AppKind, deviceId: string): Promise<string | null> {
  const [r] = await q.query<{ id: string }>('SELECT id FROM bound_devices WHERE user_id = $1 AND app = $2 AND device_id = $3 AND unbound_at IS NULL', [userId, app, deviceId])
  return r?.id ?? null
}

/** Staff remove a phone: it is signed out and must be set up again. */
export async function unbind(ctx: Ctx, userId: string, rowId: string): Promise<void> {
  const done = await ctx.db.tx(async (q) => {
    const r = await q.query(
      `UPDATE bound_devices SET unbound_at = now(), unbound_reason = 'removed_by_staff' WHERE id = $1 AND user_id = $2 AND unbound_at IS NULL RETURNING id`,
      [rowId, userId],
    )
    if (r.length) await q.query('DELETE FROM sessions WHERE bound_device_id = $1', [rowId])
    if (r.length) await q.query('UPDATE pay_biometric_keys SET revoked_at = now() WHERE bound_device_id = $1 AND revoked_at IS NULL', [rowId])
    return r.length > 0
  })
  if (!done) throw notFound('This phone is not bound to the wallet')
  ctx.hub.disconnectUser(userId, 4401, 'UNAUTHORIZED')
}
