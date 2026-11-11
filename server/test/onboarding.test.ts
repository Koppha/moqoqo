import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppKind, DeviceInfo, NetworkCheck } from '../../shared/api'
import { MockSms } from '../src/notify/gateways'
import { PROFILE_STARTS_PER_HOUR } from '../src/services/onboarding'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
const sms = new MockSms()
const econet: NetworkCheck = { type: 'cellular', sims: [{ mcc: '651', mnc: '02', carrier: 'Econet Telecom Lesotho' }] }
const phone = (id: string, model = 'Pixel 7'): DeviceInfo => ({ deviceId: id, platform: 'android', model, osVersion: '15', appVersion: '1.0.0' })
const login = (device: DeviceInfo, network: NetworkCheck = econet, msisdn = N.lerato, app: AppKind = 'customer') =>
  t.call('POST', '/v1/auth/login', { msisdn, pin: '1234', app, device, network })

/** Number + PIN → ID → confirm → OTP → signed in. */
async function signUp(device: DeviceInfo, idNumber = '9001010001', who = { dob: '1990-01-01', gender: 'female' }, msisdn = N.lerato, app: AppKind = 'customer') {
  const start = await login(device, econet, msisdn, app)
  expect(start.status).toBe(202)
  const id = start.body.onboarding.id
  const ha = await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber })
  expect(ha.status).toBe(200)
  const sent = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, ...who })
  expect(sent.status).toBe(200)
  const done = await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode })
  expect(done.status).toBe(200)
  return { id, ha: ha.body, sent: sent.body, token: done.body.token as string }
}

beforeAll(async () => {
  t = await startTestServer({ sms }, { deviceBinding: true, allowSimulatedNetwork: false })
})
afterAll(() => t.close())

describe('sign-up on a phone', () => {
  it('needs Econet mobile data', async () => {
    const wifi = await login(phone('phone-a1'), { type: 'wifi', sims: econet.sims })
    expect(wifi.body.error).toMatchObject({ code: 'NOT_ECONET' })
    const vodacom = await login(phone('phone-a1'), { type: 'cellular', sims: [{ mcc: '651', mnc: '01', carrier: 'Vodacom' }] })
    expect(vodacom.body.error.code).toBe('NOT_ECONET')
    const simulated = await login(phone('phone-a1'), { type: 'wifi', sims: [], simulated: true })
    expect(simulated.body.error.code).toBe('NOT_ECONET') // this server doesn't allow simulation
    const old = await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '1234', app: 'customer' })
    expect(old.status).toBe(400)
  })

  it('checks the PIN before anything else', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '9999', app: 'customer', device: phone('phone-a1'), network: econet })
    expect(r.body.error.code).toBe('WRONG_PIN')
  })

  it('Home Affairs name, matching details, OTP by SMS, then signed in on a bound phone', async () => {
    const { ha, sent, token } = await signUp(phone('phone-1', 'Pixel 7'))
    expect(ha.fullName).toBe('Lerato Mokhothu')
    expect(sent).toMatchObject({ sentTo: '+266 62•• ••21', resendAfter: 30 })
    expect(sms.sent.some((s) => s.to === N.lerato && s.text.includes(sent.devCode))).toBe(true)
    const devices = await t.call('GET', '/v1/me/devices', undefined, token)
    expect(devices.body).toEqual([expect.objectContaining({ model: 'Pixel 7', current: true, app: 'customer' })])

    // The same phone now signs in with number + PIN only.
    const again = await login(phone('phone-1'))
    expect(again.status).toBe(200)
    expect(again.body.token).toBeTruthy()
    const me = await t.call('GET', '/v1/me', undefined, again.body.token)
    expect(me.status).toBe(200)
  })

  it('refuses details that do not match, and gives up after 3 tries', async () => {
    const start = await login(phone('phone-x'))
    const id = start.body.onboarding.id
    await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9001010001' })
    for (let i = 0; i < 2; i++) {
      const r = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1991-01-01', gender: 'female' })
      expect(r.body.error.code).toBe('ID_MISMATCH')
    }
    await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1990-01-01', gender: 'male' })
    const after = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1990-01-01', gender: 'female' })
    expect(after.status).toBe(400) // expired
  })

  it("won't take someone else's ID once the wallet has one", async () => {
    const start = await login(phone('phone-y'))
    const r = await t.call('POST', `/v1/onboarding/${start.body.onboarding.id}/identity`, { idNumber: '8807220003' })
    expect(r.body.error.code).toBe('ID_MISMATCH')
    const unknown = await t.call('POST', `/v1/onboarding/${start.body.onboarding.id}/identity`, { idNumber: '12345678000' })
    expect(unknown.body.error.code).toBe('ID_MISMATCH')
  })

  it('a wrong OTP is refused', async () => {
    const start = await login(phone('phone-z'))
    const id = start.body.onboarding.id
    await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9001010001' })
    const sent = await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1990-01-01', gender: 'female' })
    const wrong = sent.body.devCode === '000000' ? '111111' : '000000'
    expect((await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: wrong })).status).toBe(400)
    expect((await t.call('POST', `/v1/onboarding/${id}/resend`)).status).toBe(400) // too soon
  })

  it('a new phone takes over: the old one is signed out and kept in the history', async () => {
    const first = await login(phone('phone-1'))
    const oldToken = first.body.token
    const { token } = await signUp(phone('phone-2', 'Galaxy A15'))
    expect((await t.call('GET', '/v1/me', undefined, oldToken)).status).toBe(401)
    const devices = (await t.call('GET', '/v1/me/devices', undefined, token)).body
    expect(devices.map((d: any) => [d.model, !!d.current, d.unboundReason ?? null])).toEqual([
      ['Galaxy A15', true, null],
      ['Pixel 7', false, 'replaced'],
    ])
    expect(sms.sent.some((s) => s.text.includes('Pixel 7 was signed out'))).toBe(true)
  })

  it('staff see the phones and can remove one', async () => {
    const admin = await t.adminLogin()
    const me = await t.call('GET', '/v1/me', undefined, (await login(phone('phone-2'))).body.token)
    const list = await t.call('GET', `/admin/v1/users/${me.body.id}/devices`, undefined, admin)
    const active = list.body.find((d: any) => !d.unboundAt)
    const after = await t.call('POST', `/admin/v1/users/${me.body.id}/devices/${active.id}/unbind`, undefined, admin)
    expect(after.body.find((d: any) => d.id === active.id).unboundReason).toBe('removed_by_staff')
    expect((await login(phone('phone-2'))).status).toBe(202) // must sign up again
  })

  it('the EcoSure app has its own binding: setting it up leaves EcoCash Super App signed in', async () => {
    const moqoqo = await signUp(phone('phone-3', 'Pixel 8'))
    // Android gives each app its own device id, so EcoSure on the same phone is a new device to the server.
    const ecosure = await createProfile(phone('phone-3-ecosure', 'Pixel 8'), '2580')
    expect((await t.call('GET', '/v1/me', undefined, moqoqo.token)).status).toBe(200)
    const devices = (await t.call('GET', '/v1/me/devices', undefined, ecosure.token)).body
    expect(devices.filter((d: any) => !d.unboundReason).map((d: any) => d.app).sort()).toEqual(['customer', 'ecosure'])
    expect(sms.sent.some((s) => s.text.startsWith('EcoSure: your code is'))).toBe(true)
    expect((await loginWith('2580', phone('phone-3-ecosure'), 'ecosure')).status).toBe(200)
  })
})

/** The standalone EcoSure app: code first, then ID, then the person's own EcoSure PIN. */
async function createProfile(device: DeviceInfo, pin: string, msisdn = N.lerato) {
  const start = await t.call('POST', '/v1/ecosure/profile', { msisdn, device, network: econet })
  expect(start.status).toBe(201)
  const id = start.body.onboarding.id
  expect((await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: start.body.sent.devCode })).body).toEqual({ next: 'identity' })
  expect((await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9001010001' })).status).toBe(200)
  expect((await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1990-01-01', gender: 'female' })).body).toEqual({ next: 'pin' })
  const done = await t.call('POST', `/v1/onboarding/${id}/pin`, { pin })
  expect(done.status).toBe(200)
  return { id, token: done.body.token as string }
}
const loginWith = (pin: string, device: DeviceInfo, app: AppKind) =>
  t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin, app, device, network: econet })

describe('EcoSure profile: their own PIN, never the EcoCash PIN', () => {
  it('signing in to EcoSure needs a profile first; the EcoCash PIN does not work there', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: N.mme, pin: '1234', app: 'ecosure', device: phone('mme-es'), network: econet })
    expect(r.body.error.code).toBe('PROFILE_NEEDED')
  })

  it('creates the profile: code, ID, own PIN; then the EcoSure PIN signs in, and only to EcoSure', async () => {
    const before = sms.sent.length
    const start = await t.call('POST', '/v1/ecosure/profile', { msisdn: '62000021', device: phone('es-4'), network: econet })
    expect(start.body.sent).toMatchObject({ sentTo: '+266 62•• ••21' })
    expect(sms.sent.length).toBe(before + 1) // the code goes out first
    const id = start.body.onboarding.id
    // No ID lookup before the code: only the phone's owner can see a Home Affairs name.
    expect((await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9001010001' })).body.error.code).toBe('CONFLICT')
    await t.call('POST', `/v1/onboarding/${id}/verify`, { otp: start.body.sent.devCode })
    await t.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9001010001' })
    await t.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1990-01-01', gender: 'female' })
    expect((await t.call('POST', `/v1/onboarding/${id}/pin`, { pin: '1111' })).body.error.code).toBe('VALIDATION') // too easy
    const done = await t.call('POST', `/v1/onboarding/${id}/pin`, { pin: '7319' })
    expect(done.body.token).toBeTruthy()

    expect((await loginWith('7319', phone('es-4'), 'ecosure')).status).toBe(200)
    expect((await loginWith('1234', phone('es-4'), 'ecosure')).body.error.code).toBe('WRONG_PIN') // the EcoCash PIN
    // Unlocking the EcoSure app checks the EcoSure PIN.
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '7319' }, done.body.token)).status).toBe(204)
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '1234' }, done.body.token)).body.error.code).toBe('WRONG_PIN')
  })

  it('doing it again resets a forgotten PIN', async () => {
    await createProfile(phone('es-5'), '8642')
    expect((await loginWith('7319', phone('es-5'), 'ecosure')).body.error.code).toBe('WRONG_PIN')
    expect((await loginWith('8642', phone('es-5'), 'ecosure')).status).toBe(200)
  })

  it('Econet numbers only for now, with an EcoCash account; a few tries an hour', async () => {
    const start = (msisdn: string) => t.call('POST', '/v1/ecosure/profile', { msisdn, device: phone('es-x'), network: econet })
    expect((await start('58123456')).body.error.code).toBe('NOT_ECONET') // Vodacom
    expect((await start('62999999')).body.error.code).toBe('NOT_REGISTERED')
    expect((await t.call('POST', '/v1/ecosure/profile', { msisdn: N.thabo, device: phone('es-x'), network: { type: 'wifi', sims: [] } })).body.error.code).toBe('NOT_ECONET')
    for (let i = 0; i < PROFILE_STARTS_PER_HOUR; i++) expect((await start(N.thabo)).status).toBe(201)
    expect((await start(N.thabo)).body.error.code).toBe('LIMIT_EXCEEDED')
  })
})

describe('device security (portal: Settings › Device security)', () => {
  const clean = { rooted: false, developerMode: false, emulator: false }
  const setPolicy = async (blockRooted: boolean, blockDeveloperMode: boolean, token?: string) => {
    const admin = token ?? (await t.adminLogin())
    const current = (await t.call('GET', '/admin/v1/app-config', undefined, admin)).body
    return t.call('PUT', '/admin/v1/app-config', { announcement: current.announcement, minVersion: current.minVersion, deviceSecurity: { blockRooted, blockDeveloperMode } }, admin)
  }
  const signIn = (integrity?: object) =>
    t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '1234', app: 'customer', device: { ...phone('phone-3', 'Pixel 8'), ...(integrity ? { integrity } : {}) }, network: econet })

  it('is off until an admin turns it on, and the apps are told', async () => {
    expect((await t.call('GET', '/v1/app-config')).body.deviceSecurity).toEqual({ blockRooted: false, blockDeveloperMode: false })
    expect((await signIn({ ...clean, rooted: true, developerMode: true })).status).toBe(200)
    expect((await setPolicy(true, true)).body.deviceSecurity).toEqual({ blockRooted: true, blockDeveloperMode: true })
    expect((await t.call('GET', '/v1/app-config')).body.deviceSecurity).toEqual({ blockRooted: true, blockDeveloperMode: true })
  })

  it('refuses rooted phones, developer mode and apps too old to report', async () => {
    expect((await signIn({ ...clean, rooted: true })).body.error).toMatchObject({ code: 'DEVICE_BLOCKED', message: expect.stringContaining('rooted') })
    expect((await signIn({ ...clean, developerMode: true })).body.error).toMatchObject({ code: 'DEVICE_BLOCKED', message: expect.stringContaining('developer options') })
    expect((await signIn()).body.error).toMatchObject({ code: 'DEVICE_BLOCKED', message: expect.stringContaining('Update the app') })
    expect((await signIn(clean)).status).toBe(200)
    const profile = await t.call('POST', '/v1/ecosure/profile', { msisdn: N.mme, device: { ...phone('es-dev'), integrity: { ...clean, developerMode: true } }, network: econet })
    expect(profile.body.error.code).toBe('DEVICE_BLOCKED')
  })

  it('each block is its own switch; support staff cannot change them', async () => {
    await setPolicy(true, false)
    expect((await signIn({ ...clean, developerMode: true })).status).toBe(200)
    expect((await signIn({ ...clean, rooted: true })).body.error.code).toBe('DEVICE_BLOCKED')
    const admin = await t.adminLogin()
    await t.createSupportAdmin('viewer@test.local', 'viewer-pass-123')
    const support = await t.adminLogin('viewer@test.local', 'viewer-pass-123')
    expect((await setPolicy(false, false, support)).body.error.code).toBe('FORBIDDEN')
    await setPolicy(false, false, admin)
    expect((await signIn({ ...clean, rooted: true })).status).toBe(200)
  })
})
