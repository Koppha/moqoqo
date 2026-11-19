import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DeviceContext } from '../../shared/api'
import { assess, learn, parseContext } from '../src/services/deviceContext'
import { N, startTestServer, type TestServer } from './helpers'

// Binding on more than one property (DFS guidelines 3.2.3a/b): a copied device ID on another model is set up again;
// a bound phone that suddenly looks or sits elsewhere is logged, its owner alerted, and its payments score higher.
const header = (c: DeviceContext) => Buffer.from(JSON.stringify(c)).toString('base64url')
const usual: DeviceContext = { net: 'cellular', carrier: 'Econet', screen: '1080x2340', os: 'android 15', model: 'Galaxy A55', tz: 'Africa/Maseru', loc: [-29.3, 27.5] }

describe('scoring a context', () => {
  it('learns first, then scores what differs', () => {
    let p = {}
    for (let i = 0; i < 3; i++) {
      expect(assess(p, usual, '41.203.1.1').points).toBe(0)
      p = learn(p, usual, '41.203.1.1').next
    }
    expect(assess(p, usual, '41.203.9.9').points).toBe(0)
    const elsewhere = assess(p, { ...usual, screen: '1440x3200', tz: 'Africa/Lagos', loc: [6.5, 3.4] }, '102.89.1.1')
    expect(elsewhere.points).toBe(40) // capped
    expect(elsewhere.reasons.join(' ')).toMatch(/screen 1440x3200.*time zone Africa\/Lagos.*km/)
  })

  it('ignores a malformed header', () => {
    expect(parseContext('not-base64-json')).toBeNull()
    expect(parseContext(header({ ...usual, screen: 'big' }))).toBeNull()
    expect(parseContext(header(usual))).toMatchObject({ model: 'Galaxy A55', loc: [-29.3, 27.5] })
  })
})

describe('bound phones in use', () => {
  let t: TestServer
  let token: string
  let admin: string
  const integrity = { rooted: false, developerMode: false, emulator: false }
  const device = (model = 'Galaxy A55') => ({ deviceId: 'ctx-phone-1', platform: 'android', model, osVersion: '15', appVersion: '1.0.0', integrity })
  const network = { type: 'cellular', sims: [{ mcc: '651', mnc: '02', carrier: 'Econet' }] }
  const login = (model?: string) => t.call('POST', '/v1/auth/login', { msisdn: N.palesa, pin: '1234', app: 'customer', device: device(model), network })
  const withContext = (c: DeviceContext, url: string, method = 'GET', payload?: unknown) =>
    t.server.app.inject({ method: method as 'GET', url, payload: payload as any, headers: { authorization: `Bearer ${token}`, 'x-device-context': header(c) } })
  const events = async () => {
    const id = (await t.call('GET', `/admin/v1/users?query=${encodeURIComponent(N.palesa)}`, undefined, admin)).body.items[0].id
    return ((await t.call('GET', `/admin/v1/users/${id}/auth-events`, undefined, admin)).body as any[]).map((e) => e.kind)
  }

  beforeAll(async () => {
    t = await startTestServer({}, { deviceBinding: true })
    admin = await t.adminLogin()
    const start = await login()
    const id = start.body.onboarding.id
    await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9511300004' })
    const sent = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1995-11-30', gender: 'female' })
    token = (await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode, acceptTerms: true })).body.token
    await t.server.db.query('UPDATE users SET kyc_tier = 2, balance_cents = 100000 WHERE msisdn = $1', [N.palesa])
  })
  afterAll(() => t.close())

  it('the same device ID on another model is not the bound phone: set it up again', async () => {
    expect((await login()).status).toBe(200)
    const copied = await login('Pixel 9')
    expect(copied.status).toBe(202)
    expect(await events()).toContain('device_mismatch')
  })

  it('a bound phone that suddenly looks elsewhere is flagged, and a payment right after scores higher', async () => {
    for (let i = 0; i < 3; i++) expect((await withContext(usual, '/v1/me')).statusCode).toBe(200)
    expect(await events()).not.toContain('unusual_context')
    const odd: DeviceContext = { ...usual, screen: '1440x3200', tz: 'Africa/Lagos', loc: [6.5, 3.4] }
    expect((await withContext(odd, '/v1/me')).statusCode).toBe(200)
    expect(await events()).toContain('unusual_context')
    const paid = await withContext(odd, '/v1/payments/merchant', 'POST', { merchantCode: '1001', amount: 20, pin: '1234' })
    expect(paid.statusCode).toBe(200)
    const d = await t.call('GET', '/admin/v1/ai/decisions?model=fraud_score', undefined, admin)
    const mine = d.body.items.find((x: any) => x.reasons.some((r: any) => r.feature === 'unusual_context'))
    expect(mine).toBeTruthy()
  })

  it('staff see what the phone usually looks like', async () => {
    const id = (await t.call('GET', `/admin/v1/users?query=${encodeURIComponent(N.palesa)}`, undefined, admin)).body.items[0].id
    const phones = await t.call('GET', `/admin/v1/users/${id}/devices`, undefined, admin)
    expect(phones.body[0].profile).toMatchObject({ screens: expect.arrayContaining(['1080x2340']), timeZones: expect.arrayContaining(['Africa/Maseru']) })
  })
})
