import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DeviceInfo, NetworkCheck } from '../../shared/api'
import { N, startTestServer, type TestServer } from './helpers'

// SIM swap: a swap (simulated in the portal, or pushed by Econet) holds money leaving EcoCash and large payments,
// refuses setting up the wallet on a new phone, warns staff, and is lifted when staff check the owner in person.
let t: TestServer
let admin: string
let lerato: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer({}, { simSwapWebhookSecret: 'hook-secret' })
  admin = await t.adminLogin()
  lerato = await t.login(N.lerato)
})
afterAll(() => t.close())

const bank = (amount: number) =>
  t.call('POST', '/v1/bank-transfers', { bankCode: 'SLB', accountNumber: '12345678901', amount, pin: '1234', clientId: crypto.randomUUID() }, lerato.token)
const send = (amount: number) => t.call('POST', '/v1/payments/merchant', { merchantCode: '1001', amount, pin: '1234' }, lerato.token)
const status = () => t.call('GET', `/admin/v1/users/${lerato.user.id}/sim-swaps`, undefined, admin)

describe('SIM swap', () => {
  it('nothing is held without a swap', async () => {
    const s = await status()
    expect(s.body).toMatchObject({ lastSwapAt: null, held: false, simulated: true, events: [] })
    expect((await bank(20)).status).toBe(201)
  })

  it('a swap holds money leaving EcoCash and large payments, but not small ones, and tells staff', async () => {
    const sim = await t.call('POST', `/admin/v1/users/${lerato.user.id}/sim-swaps/simulate`, { hoursAgo: 2 }, admin)
    expect(sim.status).toBe(200)
    expect(sim.body).toMatchObject({ held: true, events: [{ source: 'simulated', clearedAt: null }] })

    const out = await bank(20)
    expect(out.status).toBe(403)
    expect(out.body.error.code).toBe('RISK_BLOCKED')
    expect((await send(600)).body.error.code).toBe('RISK_BLOCKED')
    expect((await send(10)).status).toBe(200)

    const alerts = await t.call('GET', '/admin/v1/risk/alerts?rule=sim_swap', undefined, admin)
    const mine = alerts.body.items.filter((a: any) => a.user.id === lerato.user.id && a.rule === 'sim_swap')
    expect(mine.map((a: any) => a.action).sort()).toEqual(['blocked', 'blocked', 'flagged'])
  })

  it('the fraud score counts it too', async () => {
    const d = await t.call('GET', '/admin/v1/ai/decisions?model=fraud_score', undefined, admin)
    const last = d.body.items.find((x: any) => x.user?.id === lerato.user.id && x.reasons.some((r: any) => r.feature === 'sim_swap'))
    expect(last).toBeTruthy()
  })

  it('staff clear it after checking the owner in person (support staff cannot)', async () => {
    await t.createSupportAdmin('support@test.local', 'support-pass-123')
    const support = await t.adminLogin('support@test.local', 'support-pass-123')
    expect((await t.call('POST', `/admin/v1/users/${lerato.user.id}/sim-swaps/clear`, { note: 'ID checked' }, support)).status).toBe(403)
    expect((await t.call('POST', `/admin/v1/users/${lerato.user.id}/sim-swaps/clear`, { note: 'x' }, admin)).status).toBe(400)
    const cleared = await t.call('POST', `/admin/v1/users/${lerato.user.id}/sim-swaps/clear`, { note: 'Saw her ID at Kingsway shop' }, admin)
    expect(cleared.body).toMatchObject({ held: false, events: [{ clearedBy: expect.any(String), note: 'Saw her ID at Kingsway shop' }] })
    expect(cleared.body.clearedAt).toBeTruthy()
    expect((await bank(20)).status).toBe(201)
  })

  it('an old swap holds nothing', async () => {
    await t.call('POST', `/admin/v1/users/${lerato.user.id}/sim-swaps/simulate`, { hoursAgo: 100 }, admin)
    expect((await status()).body.held).toBe(false)
    expect((await bank(20)).status).toBe(201)
  })

  it('Econet webhook: secret required, the same swap is recorded once', async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString()
    expect((await t.call('POST', '/v1/hooks/sim-swap', { msisdn: N.thabo, swappedAt: at })).status).toBe(404)
    const call = () => t.server.app.inject({ method: 'POST', url: '/v1/hooks/sim-swap', headers: { 'x-webhook-secret': 'hook-secret' }, payload: { msisdn: N.thabo, swappedAt: at } })
    const first = await call()
    expect(first.json()).toEqual({ recorded: true, known: true })
    expect((await call()).json()).toEqual({ recorded: false, known: true })
  })
})

describe('SIM swap and new phones', () => {
  let b: TestServer
  const econet: NetworkCheck = { type: 'cellular', sims: [{ mcc: '651', mnc: '02', carrier: 'Econet Telecom Lesotho' }] }
  const phone = (id: string): DeviceInfo => ({ deviceId: id, platform: 'android', model: 'Pixel 7', osVersion: '15', appVersion: '1.0.0', integrity: { rooted: false, developerMode: false, emulator: false } })
  beforeAll(async () => { b = await startTestServer({}, { deviceBinding: true }) })
  afterAll(() => b.close())

  it('refuses setting up the wallet on a new phone after a swap, until staff clear it', async () => {
    const adm = await b.adminLogin()
    const login = () => b.call('POST', '/v1/auth/login', { msisdn: N.palesa, pin: '1234', app: 'customer', device: phone('fraudster-phone'), network: econet })
    expect((await login()).status).toBe(202)
    const users = await b.call('GET', `/admin/v1/users?query=${encodeURIComponent(N.palesa)}`, undefined, adm)
    const id = (users.body.items ?? users.body)[0].id
    await b.call('POST', `/admin/v1/users/${id}/sim-swaps/simulate`, { hoursAgo: 1 }, adm)
    const held = await login()
    expect(held.status).toBe(403)
    expect(held.body.error.code).toBe('SIM_SWAP_HOLD')
    expect((await b.call('GET', `/admin/v1/users/${id}/sim-swaps`, undefined, adm)).body.setupBlockedUntil).toBeTruthy()
    await b.call('POST', `/admin/v1/users/${id}/sim-swaps/clear`, { note: 'Owner came to the shop with ID' }, adm)
    expect((await login()).status).toBe(202)
  })
})

describe("first sign-in: is the wallet's SIM in this phone?", () => {
  let c: TestServer
  const sim = (number?: string | null) => ({ mcc: '651', mnc: '02', carrier: 'Econet Telecom Lesotho', number })
  const phone = (id: string): DeviceInfo => ({ deviceId: id, platform: 'android', model: 'Galaxy A55', osVersion: '15', appVersion: '1.0.0', integrity: { rooted: false, developerMode: false, emulator: false } })
  const login = (deviceId: string, sims: ReturnType<typeof sim>[], msisdn = N.palesa) =>
    c.call('POST', '/v1/auth/login', { msisdn, pin: '1234', app: 'customer', device: phone(deviceId), network: { type: 'cellular', sims } })
  beforeAll(async () => { c = await startTestServer({}, { deviceBinding: true }) })
  afterAll(() => c.close())

  it("refuses a phone whose SIM shows another number (any slot may match)", async () => {
    const wrong = await login('phone-p1', [sim('58123456'), sim('62999999')])
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('SIM_NOT_IN_PHONE')
    expect((await login('phone-p1', [sim('58123456'), sim(N.palesa.replace('+266', ''))])).status).toBe(202)
    expect((await login('phone-p1', [sim(null)])).status).toBe(202)
  })

  it('records how the SIM was matched on the bound phone', async () => {
    const start = await login('phone-p2', [sim(N.palesa)])
    const id = start.body.onboarding.id
    await c.call('POST', `/v1/onboarding/${id}/identity`, { idNumber: '9511300004' })
    const sent = await c.call('POST', `/v1/onboarding/${id}/confirm`, { nameConfirmed: true, dob: '1995-11-30', gender: 'female' })
    const done = await c.call('POST', `/v1/onboarding/${id}/verify`, { otp: sent.body.devCode, acceptTerms: true })
    expect(done.status).toBe(200)
    const devices = await c.call('GET', '/v1/me/devices', undefined, done.body.token)
    expect(devices.body[0]).toMatchObject({ model: 'Galaxy A55', simCheck: 'sim' })
  })

  it('staff can let a mismatch through (recorded as such)', async () => {
    const adm = await c.adminLogin()
    const cfg = await c.call('GET', '/admin/v1/app-config', undefined, adm)
    const put = await c.call('PUT', '/admin/v1/app-config', { announcement: cfg.body.announcement, minVersion: cfg.body.minVersion, deviceSecurity: { ...cfg.body.deviceSecurity, requireSimMatch: false } }, adm)
    expect(put.status).toBe(200)
    expect((await login('phone-p3', [sim('62999999')], N.thabo)).status).toBe(202)
  })
})
