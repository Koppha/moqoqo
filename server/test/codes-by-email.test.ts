import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DeviceInfo, NetworkCheck } from '../../shared/api'
import { MockEmail, MockSms } from '../src/notify/gateways'
import { N, startTestServer, type TestServer } from './helpers'

// Travelling abroad: a person turns on "send my codes by email" (confirmed email + PIN, until a date). Setting up a
// phone then works off Econet's network and the 6-digit code is emailed instead of sent by SMS. Off by default.

const sms = new MockSms()
const email = new MockEmail()
let t: TestServer
let me: { token: string; user: any }

const phone = (id: string): DeviceInfo => ({ deviceId: id, platform: 'android', model: 'Pixel 9', osVersion: '15', appVersion: '1.0.0', integrity: { rooted: false, developerMode: false, emulator: false } })
const abroad: NetworkCheck = { type: 'wifi', sims: [{ mcc: '655', mnc: '01', carrier: 'Vodacom', number: '+27821234567' }] }
const login = (deviceId: string, network: NetworkCheck = abroad) =>
  t.call('POST', '/v1/auth/login', { msisdn: N.palesa, pin: '1234', app: 'customer', device: phone(deviceId), network })
const lastCode = (text: string) => /\b(\d{6})\b/.exec(text)![1]

beforeAll(async () => {
  t = await startTestServer({ sms, email }, { deviceBinding: true })
  // Palesa's first phone, set up the normal way (Econet SIM on Econet data, code by SMS).
  const start = await login('palesa-home-phone', { type: 'cellular', sims: [{ mcc: '651', mnc: '02', carrier: 'Econet Telecom Lesotho', number: N.palesa }] })
  const id = start.body.onboarding.id
  await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9511300004' })
  const sent = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1995-11-30', gender: 'female' })
  const done = await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode, acceptTerms: true })
  me = { token: done.body.token, user: done.body.user }
})
afterAll(() => t.close())

describe('codes by email while travelling', () => {
  it('is off by default, and abroad a phone cannot be set up', async () => {
    const s = await t.call('GET', '/v1/me/notifications', undefined, me.token)
    expect(s.body.codesByEmailUntil).toBeNull()
    const r = await login('palesa-travel-phone')
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('NOT_ECONET')
  })

  it('needs a confirmed email and the PIN to turn on', async () => {
    expect((await t.call('PUT', '/v1/me/codes-by-email', { on: true, pin: '1234' }, me.token)).status).toBe(400)
    await t.call('POST', '/v1/me/email', { email: 'palesa@example.com' }, me.token)
    await t.call('POST', '/v1/me/email/verify', { code: lastCode(email.sent.at(-1)!.text) }, me.token)
    expect((await t.call('PUT', '/v1/me/codes-by-email', { on: true, pin: '9999' }, me.token)).status).not.toBe(200)
    expect((await t.call('PUT', '/v1/me/codes-by-email', { on: true, days: 200, pin: '1234' }, me.token)).status).toBe(400)
    const on = await t.call('PUT', '/v1/me/codes-by-email', { on: true, days: 14, pin: '1234' }, me.token)
    expect(on.status).toBe(200)
    const until = Date.parse(on.body.codesByEmailUntil)
    expect(until - Date.now()).toBeGreaterThan(13.9 * 864e5)
    expect(until - Date.now()).toBeLessThan(14.1 * 864e5)
  })

  it('abroad, the code goes by email (not SMS) and the phone is set up; the SIM check says travelling', async () => {
    const smsBefore = sms.sent.length
    const start = await login('palesa-travel-phone')
    expect(start.status).toBe(202)
    const id = start.body.onboarding.id
    await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9511300004' })
    const sent = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1995-11-30', gender: 'female' })
    expect(sent.body).toMatchObject({ channel: 'email', sentTo: expect.stringMatching(/^pa.*@example\.com$/) })
    expect(sms.sent.length).toBe(smsBefore)
    const mail = email.sent.at(-1)!
    expect(mail.to).toBe('palesa@example.com')
    const done = await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: lastCode(mail.text), acceptTerms: true })
    expect(done.status).toBe(200)
    const devices = await t.call('GET', '/v1/me/devices', undefined, done.body.token)
    expect(devices.body[0]).toMatchObject({ model: 'Pixel 9', simCheck: 'travel' })
    me = { token: done.body.token, user: done.body.user }
  })

  it('changing the email turns it off; turning off is logged', async () => {
    await t.call('POST', '/v1/me/email', { email: 'other@example.com' }, me.token)
    const changed = await t.call('POST', '/v1/me/email/verify', { code: lastCode(email.sent.at(-1)!.text) }, me.token)
    expect(changed.body).toMatchObject({ email: 'other@example.com', codesByEmailUntil: null })
    const off = await t.call('PUT', '/v1/me/codes-by-email', { on: false }, me.token)
    expect(off.body.codesByEmailUntil).toBeNull()
    const adm = await t.adminLogin()
    const log = await t.call('GET', `/admin/v1/users/${me.user.id}/auth-events`, undefined, adm)
    expect(log.body.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['codes_email_on', 'codes_email_off']))
  })
})
