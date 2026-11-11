import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

// Demo data (ensureDemoBusinessOwners): Lerato's ID is verified and recorded as the owner of Lerato's Salon. The taxi
// belongs to Ntate Mokoena, someone else.
const SALON = '+26662888021'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let admin: string

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('EcoCash Business as a mini app', () => {
  it('only the owner adds a business: their verified ID must match its owner ID, and they need its PIN', async () => {
    // Knowing someone else's business PIN is not enough.
    const other = await t.call('POST', '/v1/businesses/link', { msisdn: N.taxi, pin: '1234' }, lerato.token)
    expect(other.status).toBe(403)
    expect(other.body.error.message).toMatch(/registered to someone else/)
    // No verified ID yet.
    expect((await t.call('POST', '/v1/businesses/link', { msisdn: SALON, pin: '1234' }, thabo.token)).body.error.message).toMatch(/Verify your ID/)
    expect((await t.call('POST', '/v1/businesses/link', { msisdn: SALON, pin: '9999' }, lerato.token)).body.error.code).toBe('WRONG_PIN')
    expect((await t.call('POST', '/v1/businesses/link', { msisdn: N.thabo, pin: '1234' }, lerato.token)).body.error.code).toBe('VALIDATION')
    const r = await t.call('POST', '/v1/businesses/link', { msisdn: SALON, pin: '1234' }, lerato.token)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ role: 'merchant', code: '1002', msisdn: SALON, name: 'Lerato’s Salon' })
    expect((await t.call('POST', '/v1/businesses/link', { msisdn: SALON, pin: '1234' }, lerato.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('GET', '/v1/businesses', undefined, lerato.token)).body).toHaveLength(1)
    expect((await t.call('GET', '/v1/businesses', undefined, thabo.token)).body).toHaveLength(0)
  })

  it('opens the business without signing in again; only the person who linked it can', async () => {
    const [biz] = (await t.call('GET', '/v1/businesses', undefined, lerato.token)).body
    expect((await t.call('POST', `/v1/businesses/${biz.id}/open`, {}, thabo.token)).status).toBe(404)
    const r = await t.call('POST', `/v1/businesses/${biz.id}/open`, {}, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.user).toMatchObject({ id: biz.id, role: 'merchant' })
    expect((await t.call('GET', '/v1/me', undefined, r.body.token)).body.id).toBe(biz.id)
    // Not from inside a business session.
    expect((await t.call('GET', '/v1/businesses', undefined, r.body.token)).body).toHaveLength(0)
    expect((await t.call('POST', '/v1/businesses/link', { msisdn: N.agent, pin: '1234' }, r.body.token)).status).toBe(403)
  })

  it('a new owner recorded in the portal ends the old owner’s access', async () => {
    const [biz] = (await t.call('GET', '/v1/businesses', undefined, lerato.token)).body
    const opened = (await t.call('POST', `/v1/businesses/${biz.id}/open`, {}, lerato.token)).body
    const p = await t.call('PATCH', `/admin/v1/users/${biz.id}`, { ownerIdNumber: '6602020202' }, admin)
    expect(p.body.ownerIdNumber).toBe('6602020202')
    expect((await t.call('GET', '/v1/me', undefined, opened.token)).status).toBe(401)
    expect((await t.call('GET', '/v1/businesses', undefined, lerato.token)).body).toHaveLength(0)
    expect((await t.call('PATCH', `/admin/v1/users/${biz.id}`, { ownerIdNumber: '9001 0100-01' }, admin)).body.ownerIdNumber).toBe('9001010001')
  })

  it('unlinking ends the business sessions opened from EcoCash Super App', async () => {
    const biz = (await t.call('POST', '/v1/businesses/link', { msisdn: SALON, pin: '1234' }, lerato.token)).body
    const opened = (await t.call('POST', `/v1/businesses/${biz.id}/open`, {}, lerato.token)).body
    expect((await t.call('DELETE', `/v1/businesses/${biz.id}`, undefined, lerato.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/me', undefined, opened.token)).status).toBe(401)
    expect((await t.call('GET', '/v1/businesses', undefined, lerato.token)).body).toHaveLength(0)
    // The business's own sign-in still works.
    expect((await t.login(SALON, 'business')).user.role).toBe('merchant')
  })
})

describe('the standalone Mekhatlo app', () => {
  it('signs in with the EcoCash number and PIN; business numbers are turned away', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '1234', app: 'society' })
    expect(r.status).toBe(200)
    expect((await t.call('GET', '/v1/societies', undefined, r.body.token)).status).toBe(200)
    expect((await t.call('POST', '/v1/auth/login', { msisdn: N.taxi, pin: '1234', app: 'society' })).body.error.code).toBe('WRONG_APP')
    expect((await t.call('POST', '/v1/devices', { expoPushToken: 'ExponentPushToken[mekhatlo-test-1]', platform: 'android', app: 'society' }, r.body.token)).status).toBe(204)
  })
})
