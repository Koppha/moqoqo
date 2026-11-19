import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

// CBL/LCA DFS Security Guidelines controls: session expiry (3.2.8a), configurable lockout (3.2.5b-v), staff lockout,
// easy PINs refused everywhere (3.2.5b-ii), fingerprint for payments (3.2.5b-iii), lost phones and removing phones
// (3.2.3b-ii, 3.2.8d), the sign-in log (3.2.5b-vi), rate limiting and security headers.
let t: TestServer
let admin: string

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
})
afterAll(() => t.close())

const settings = async (patch: Record<string, unknown>) => {
  const cur = (await t.call('GET', '/admin/v1/app-config', undefined, admin)).body
  return t.call('PUT', '/admin/v1/app-config', { announcement: cur.announcement, minVersion: cur.minVersion, deviceSecurity: { ...cur.deviceSecurity, ...patch } }, admin)
}
const userId = async (msisdn: string) => (await t.call('GET', `/admin/v1/users?query=${encodeURIComponent(msisdn)}`, undefined, admin)).body.items[0].id
const events = async (msisdn: string) => (await t.call('GET', `/admin/v1/users/${await userId(msisdn)}/auth-events`, undefined, admin)).body as any[]

describe('sessions', () => {
  it('sign out after the minutes without use set in the portal, and log it', async () => {
    const s = await t.login(N.thabo)
    expect((await t.call('GET', '/v1/me', undefined, s.token)).status).toBe(200)
    await t.server.db.query(`UPDATE sessions SET last_used_at = now() - interval '16 minutes' WHERE user_id = $1`, [s.user.id])
    const r = await t.call('GET', '/v1/me', undefined, s.token)
    expect(r.status).toBe(401)
    expect(r.body.error.message).toContain('15 minutes')
    expect((await events(N.thabo)).map((e) => e.kind)).toContain('idle_signout')
  })

  it('end after the maximum days even when in use', async () => {
    const s = await t.login(N.thabo)
    await t.server.db.query(`UPDATE sessions SET created_at = now() - interval '31 days' WHERE user_id = $1`, [s.user.id])
    expect((await t.call('GET', '/v1/me', undefined, s.token)).status).toBe(401)
  })

  it('the limits are portal settings, within the guidelines (at most 15 minutes)', async () => {
    expect((await settings({ idleMinutes: 30 })).status).toBe(400)
    expect((await settings({ idleMinutes: 5 })).body.deviceSecurity.idleMinutes).toBe(5)
    await settings({ idleMinutes: 15 })
  })

  it('staff sessions expire too', async () => {
    const token = await t.adminLogin()
    await t.server.db.query(`UPDATE admin_sessions SET last_used_at = now() - interval '20 minutes' WHERE token_hash = (SELECT token_hash FROM admin_sessions ORDER BY created_at DESC LIMIT 1)`)
    expect((await t.call('GET', '/admin/v1/me', undefined, token)).status).toBe(401)
  })
})

describe('PINs and passwords', () => {
  it('the wrong-PIN limit and lock time come from the portal', async () => {
    await settings({ maxPinAttempts: 3, pinLockMinutes: 30 })
    const s = await t.login(N.mme)
    const wrong = () => t.call('POST', '/v1/auth/verify-pin', { pin: '0000' }, s.token)
    expect((await wrong()).body.error.message).toContain('2 tries left')
    await wrong()
    const locked = await wrong()
    expect(locked.body.error.code).toBe('PIN_LOCKED')
    expect(locked.body.error.message).toMatch(/30 minutes/)
    expect((await events(N.mme)).map((e) => e.kind)).toEqual(expect.arrayContaining(['pin_wrong', 'pin_locked']))
    await t.server.db.query('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = $1', [s.user.id])
    await settings({ maxPinAttempts: 5, pinLockMinutes: 15 })
  })

  it('staff accounts lock after too many wrong passwords', async () => {
    await t.createSupportAdmin('lock@test.local', 'right-password-1')
    for (let i = 0; i < 5; i++) await t.call('POST', '/admin/v1/login', { email: 'lock@test.local', password: 'wrong' })
    const r = await t.call('POST', '/admin/v1/login', { email: 'lock@test.local', password: 'right-password-1' })
    expect(r.body.error.code).toBe('PIN_LOCKED')
  })

  it('easy PINs are refused when staff reset one', async () => {
    const id = await userId(N.palesa)
    expect((await t.call('POST', `/admin/v1/users/${id}/reset-pin`, { pin: '1111' }, admin)).status).toBe(400)
    expect((await t.call('POST', `/admin/v1/users/${id}/reset-pin`, { pin: '4826' }, admin)).status).toBe(204)
    await t.server.db.query(`UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE msisdn = $2), pin_salt = (SELECT pin_salt FROM users WHERE msisdn = $2) WHERE id = $1`, [id, N.thabo])
  })
})

describe('fingerprint for payments', () => {
  it('a token from the PIN pays like the PIN, and stops when turned off', async () => {
    const s = await t.login(N.lerato)
    expect((await t.call('POST', '/v1/me/pay-biometric', { pin: '0000' }, s.token)).body.error.code).toBe('WRONG_PIN')
    const on = await t.call('POST', '/v1/me/pay-biometric', { pin: '1234' }, s.token)
    expect(on.body.token).toMatch(/^B\./)
    const pay = (pin: string) => t.call('POST', '/v1/payments/merchant', { merchantCode: '1001', amount: 5, pin }, s.token)
    expect((await pay(on.body.token)).status).toBe(200)
    expect((await pay('B.' + 'x'.repeat(43))).body.error.code).toBe('WRONG_PIN')
    await t.call('DELETE', '/v1/me/pay-biometric', undefined, s.token)
    expect((await pay(on.body.token)).body.error.code).toBe('WRONG_PIN')
    await t.server.db.query('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = $1', [s.user.id])
  })
})

describe('lost and removed phones', () => {
  it('"Lost your phone?" signs every phone out with the number and PIN', async () => {
    const s = await t.login(N.mme)
    expect((await t.call('POST', '/v1/auth/report-lost', { msisdn: N.mme, pin: '0000' })).body.error.code).toBe('WRONG_PIN')
    const r = await t.call('POST', '/v1/auth/report-lost', { msisdn: N.mme, pin: '1234' })
    expect(r.status).toBe(200)
    expect((await t.call('GET', '/v1/me', undefined, s.token)).status).toBe(401)
    expect((await events(N.mme)).map((e) => e.kind)).toContain('reported_lost')
  })
})

describe('server protection', () => {
  it('sends security headers and never caches API answers', async () => {
    const r = await t.server.app.inject({ method: 'GET', url: '/v1/app-config' })
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(r.headers['cache-control']).toBe('no-store')
  })

  it('limits sign-in attempts per connection', async () => {
    const l = await startTestServer({}, { rateLimit: true })
    let last = 0
    for (let i = 0; i < 21; i++) last = (await l.call('POST', '/v1/auth/login', { msisdn: N.thabo, pin: '9999', app: 'customer' })).status
    expect(last).toBe(429)
    await l.close()
  })
})

describe('terms at phone setup', () => {
  it('are required and recorded', async () => {
    const b = await startTestServer({}, { deviceBinding: true })
    const device = { deviceId: 'terms-phone', platform: 'android', model: 'Pixel 8', osVersion: '15', appVersion: '1.0.0', integrity: { rooted: false, developerMode: false, emulator: false } }
    const network = { type: 'cellular', sims: [{ mcc: '651', mnc: '02', carrier: 'Econet' }] }
    const start = await b.call('POST', '/v1/auth/login', { msisdn: N.palesa, pin: '1234', app: 'customer', device, network })
    const id = start.body.onboarding.id
    await b.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9511300004' })
    const sent = await b.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1995-11-30', gender: 'female' })
    expect((await b.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode })).body.error.code).toBe('TERMS_REQUIRED')
    expect((await b.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode, acceptTerms: true })).status).toBe(200)
    const [u] = await b.server.db.query<{ terms_version: string }>('SELECT terms_version FROM users WHERE msisdn = $1', [N.palesa])
    expect(u.terms_version).toBeTruthy()
    await b.close()
  })
})

void crypto

describe('monitoring and analysing sign-in attempts', () => {
  it('refused sign-ins are logged with their address; one address trying many wallets raises alerts', async () => {
    const wallets = [N.lerato, N.mme, N.thabo, N.palesa, N.cafe]
    for (const m of wallets) await t.call('POST', '/v1/auth/login', { msisdn: m, pin: '0909', app: m === N.cafe ? 'business' : 'customer' })
    expect((await events(N.lerato)).map((e) => e.kind)).toContain('login_failed')
    const raised = await t.server.surveillance.sweep()
    expect(raised).toBeGreaterThanOrEqual(5)
    const alerts = await t.call('GET', '/admin/v1/risk/alerts?rule=auth_anomaly', undefined, admin)
    expect(alerts.body.items.filter((a: any) => a.rule === 'auth_anomaly').length).toBeGreaterThanOrEqual(5)
    expect(await t.server.surveillance.sweep()).toBe(0) // once a day per wallet
    for (const m of wallets) await t.server.db.query('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE msisdn = $1', [m])
  })

  it('staff see totals, the top addresses and wallets, and recent events', async () => {
    const m = await t.call('GET', '/admin/v1/auth-monitor?days=7', undefined, admin)
    expect(m.status).toBe(200)
    expect(m.body.totals.login_failed).toBeGreaterThanOrEqual(5)
    expect(m.body.topAddresses[0]).toMatchObject({ wallets: expect.any(Number), failures: expect.any(Number) })
    expect(m.body.recent.length).toBeGreaterThan(0)
  })
})

describe('networks and SMS codes', () => {
  const ctxHeader = (c: object) => Buffer.from(JSON.stringify(c)).toString('base64url')
  it('a bound phone on a Wi-Fi network it never used is told to ask the person', async () => {
    const b = await startTestServer({}, { deviceBinding: true })
    const integrity = { rooted: false, developerMode: false, emulator: false }
    const device = { deviceId: 'net-phone-1', platform: 'android', model: 'Galaxy A55', osVersion: '15', appVersion: '1.0.0', integrity }
    const start = await b.call('POST', '/v1/auth/login', { msisdn: N.palesa, pin: '1234', app: 'customer', device, network: { type: 'cellular', sims: [{ mcc: '651', mnc: '02', carrier: 'Econet' }] } })
    const id = start.body.onboarding.id
    await b.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9511300004' })
    const sent = await b.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1995-11-30', gender: 'female' })
    expect(sent.body.devCode).toBeTruthy()
    const token = (await b.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode, acceptTerms: true })).body.token
    const usual = { net: 'cellular', screen: '1080x2340', os: 'android 15', model: 'Galaxy A55', tz: 'Africa/Maseru' }
    const get = (c: object, ip: string) => b.server.app.inject({ method: 'GET', url: '/v1/me', remoteAddress: ip, headers: { authorization: `Bearer ${token}`, 'x-device-context': ctxHeader(c) } })
    for (let i = 0; i < 3; i++) expect((await get(usual, '41.203.1.1')).headers['x-network-new']).toBeUndefined()
    const cafe = await get({ ...usual, net: 'wifi', wifi: 'open' }, '196.11.2.3')
    expect(cafe.headers['x-network-new']).toBe('1')
    await b.close()
  })
})
