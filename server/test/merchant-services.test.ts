import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

// A merchant (Ha Abia Cafe, 1001) uses its takings like a customer wallet: airtime and bundles, paying another
// merchant, cash out at an agent, and the bank. Plus its business profile and map listing.
let t: TestServer
let cafe: { token: string; user: any }
let agent: { token: string; user: any }
let lerato: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  cafe = await t.login(N.cafe, 'business')
  agent = await t.login(N.agent, 'business')
  lerato = await t.login(N.lerato)
})
afterAll(() => t.close())

const service = (id: string, values: Record<string, string>) =>
  t.call('POST', `/v1/services/${id}/submit`, { values, pin: '1234', clientId: crypto.randomUUID() }, cafe.token)

describe('merchant money', () => {
  it('buys airtime and bundles for its own number and for someone else', async () => {
    const before = await balanceOf(t, cafe.token)
    const own = await service('svc-airtime', { number: '62888001', amount: '20' })
    expect(own.body.transaction).toMatchObject({ amount: -20, description: 'Airtime · 62888001' })
    const other = await service('svc-bundles', { number: '62000021', bundle: 'W1GB' })
    expect(other.body.transaction).toMatchObject({ amount: -30, description: 'Bundles · 62000021' })
    expect(await balanceOf(t, cafe.token)).toBe(before - 50)
  })

  it('pays another merchant by code, never itself', async () => {
    const paid = await t.call('POST', '/v1/payments/merchant', { merchantCode: '1002', amount: 15, pin: '1234' }, cafe.token)
    expect(paid.status).toBe(200)
    expect(paid.body.transaction).toMatchObject({ kind: 'qr', amount: -15 })
    const self = await t.call('POST', '/v1/payments/merchant', { merchantCode: '1001', amount: 15, pin: '1234' }, cafe.token)
    expect(self.status).toBe(400)
  })

  it('cashes out its takings at an agent', async () => {
    const intent = await t.call('POST', '/v1/agent/cashouts', { amount: 100 }, agent.token)
    expect(intent.status).toBe(201)
    const paid = await t.call('POST', `/v1/intents/${intent.body.id}/pay`, { pin: '1234', method: 'code' }, cafe.token)
    expect(paid.status).toBe(200)
    expect(paid.body.transaction).toMatchObject({ kind: 'cashout', amount: -100 })
  })

  it('sends takings to a bank account', async () => {
    const r = await t.call('POST', '/v1/bank-transfers', { bankCode: 'SLB', accountNumber: '12345678901', amount: 100, pin: '1234', clientId: crypto.randomUUID() }, cafe.token)
    expect(r.status).toBe(201)
    expect(r.body.transfer).toMatchObject({ amount: 100 })
  })
})

describe('business profile', () => {
  it('shows the account and its map listing; only businesses have one', async () => {
    const r = await t.call('GET', '/v1/business/profile', undefined, cafe.token)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ name: 'Ha Abia Cafe', role: 'merchant', code: '1001', msisdn: N.cafe, kycTier: 2, status: 'active' })
    expect(r.body.listing).toMatchObject({ kind: 'merchant', code: '1001', address: 'Ha Abia shops, Maseru', enabled: true })
    expect((await t.call('GET', '/v1/business/profile', undefined, lerato.token)).status).toBe(403)
  })

  it('edits its own listing (name and code stay EcoCash’s) and can hide it from the map', async () => {
    const r = await t.call('PUT', '/v1/business/profile', { address: 'Shop 4, Ha Abia shops, Maseru', hours: 'Every day 06:00–22:00', phone: '62888001', listed: false }, cafe.token)
    expect(r.status).toBe(200)
    expect(r.body.listing).toMatchObject({ name: 'Ha Abia Cafe', code: '1001', address: 'Shop 4, Ha Abia shops, Maseru', hours: 'Every day 06:00–22:00', phone: N.cafe, enabled: false })
    const map = await t.call('GET', '/v1/places')
    expect(map.body.find((p: any) => p.code === '1001')).toBeUndefined()
    expect((await t.call('PUT', '/v1/business/profile', { address: 'x', listed: true }, cafe.token)).status).toBe(400)
  })

  it('a business without a listing needs the shop’s location to add one', async () => {
    const noLoc = await t.call('PUT', '/v1/business/profile', { address: 'Main Road, Ha Abia, Maseru', listed: true }, agent.token)
    // The demo agent already has a listing; remove it to start fresh.
    expect(noLoc.status).toBe(200)
    await t.server.db.query(`DELETE FROM places WHERE code = 'AGENT-0101'`)
    const missing = await t.call('PUT', '/v1/business/profile', { address: 'Main Road, Ha Abia, Maseru', listed: true }, agent.token)
    expect(missing.status).toBe(400)
    const outside = await t.call('PUT', '/v1/business/profile', { address: 'Main Road, Ha Abia, Maseru', listed: true, lat: 51.5, lng: -0.1 }, agent.token)
    expect(outside.status).toBe(400)
    const added = await t.call('PUT', '/v1/business/profile', { address: 'Main Road, Ha Abia, Maseru', listed: true, lat: -29.3369, lng: 27.4995 }, agent.token)
    expect(added.body.listing).toMatchObject({ kind: 'agent', code: 'AGENT-0101', name: 'Ha Abia Agent', enabled: true })
  })
})
