import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let agent: { token: string; user: any }
let taxi: { token: string; user: any }
let palesa: { token: string; user: any }
let lerato: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  agent = await t.login(N.agent, 'business')
  taxi = await t.login(N.taxi, 'business')
  palesa = await t.login(N.palesa)
  lerato = await t.login(N.lerato)
})
afterAll(() => t.close())

describe('agents', () => {
  it('cash-in moves float to the customer and posts into their chat', async () => {
    const r = await t.call('POST', '/v1/agent/cash-in', { customerMsisdn: N.palesa, amount: 500, pin: '1234' }, agent.token)
    expect(r.status).toBe(200)
    expect(r.body.balance).toBe(19500)
    expect(r.body.transaction).toMatchObject({ kind: 'cashin', amount: -500, counterpartyName: 'Palesa Letsie' })
    expect(await balanceOf(t, palesa.token)).toBe(585)
    const chat = await chatByTitle(t, palesa.token, 'Ha Abia Agent')
    expect(chat.lastMessage).toMatchObject({ kind: 'money', amount: 500, senderId: agent.user.id })
    expect((await t.call('POST', '/v1/agent/cash-in', { customerMsisdn: N.palesa, amount: 500, pin: '0000' }, agent.token)).body.error.code).toBe('WRONG_PIN')
    expect((await t.call('POST', '/v1/agent/cash-in', { customerMsisdn: '+26662999999', amount: 5, pin: '1234' }, agent.token)).body.error.code).toBe('NOT_REGISTERED')
  })

  it('only agents can use agent routes', async () => {
    const r = await t.call('POST', '/v1/agent/cash-in', { customerMsisdn: N.palesa, amount: 5, pin: '1234' }, lerato.token)
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('FORBIDDEN')
    expect((await t.call('GET', '/v1/agent/summary', undefined, taxi.token)).body.error.code).toBe('FORBIDDEN')
  })

  it('cash-out: agent requests, customer approves with PIN, e-money goes to the agent', async () => {
    const req = await t.call('POST', '/v1/agent/cash-out', { customerMsisdn: N.palesa, amount: 200 }, agent.token)
    expect(req.status).toBe(201)
    expect(req.body.request).toMatchObject({ kind: 'cashout', amount: 200, status: 'pending', toUserId: agent.user.id })
    const chat = await chatByTitle(t, palesa.token, 'Ha Abia Agent')
    expect(chat.lastMessage.id).toBe(req.body.id)
    // The agent cannot approve it.
    expect((await t.call('POST', `/v1/requests/${req.body.id}/pay`, { pin: '1234' }, agent.token)).body.error.code).toBe('FORBIDDEN')
    // Palesa is KYC tier 1: cash-out needs tier 2.
    expect((await t.call('POST', `/v1/requests/${req.body.id}/pay`, { pin: '1234' }, palesa.token)).body.error.code).toBe('KYC_REQUIRED')
    await t.server.db.query('UPDATE users SET kyc_tier = 2 WHERE id = $1', [palesa.user.id])
    const paid = await t.call('POST', `/v1/requests/${req.body.id}/pay`, { pin: '1234' }, palesa.token)
    expect(paid.status).toBe(200)
    expect(paid.body.transaction).toMatchObject({ kind: 'cashout', amount: -200 })
    expect(paid.body.balance).toBe(385)
    expect(await balanceOf(t, agent.token)).toBe(19700)
  })

  it('summary counts today and computes placeholder commission', async () => {
    const s = await t.call('GET', '/v1/agent/summary', undefined, agent.token)
    expect(s.status).toBe(200)
    expect(s.body).toMatchObject({ float: 19700, cashInToday: { count: 1, total: 500 }, cashOutToday: { count: 1, total: 200 } })
    expect(s.body.commissionToday).toBe(4.5) // 0.5% of 500 + 1% of 200
    expect(s.body.recent[0].kind).toBe('cashout')
  })

  it('registers a KYC tier 1 customer who can then log in', async () => {
    const r = await t.call('POST', '/v1/agent/register', { msisdn: '+26662444555', name: 'Neo Mohapi', pin: '4321' }, agent.token)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ msisdn: '+26662444555', name: 'Neo Mohapi', role: 'customer' })
    const login = await t.login('+26662444555', 'customer', '4321')
    expect(login.user.kycTier).toBe(1)
    expect(login.user.balance).toBe(0)
    expect((await t.call('POST', '/v1/agent/register', { msisdn: '+26662444555', name: 'Again', pin: '4321' }, agent.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', '/v1/agent/register', { msisdn: '12345', name: 'Bad', pin: '4321' }, agent.token)).body.error.code).toBe('VALIDATION')
  })
})

describe('merchants', () => {
  it('charge → customer pays → sale shows in summary', async () => {
    const req = await t.call('POST', '/v1/merchant/charge', { customerMsisdn: N.lerato, amount: 15, note: 'Maseru → Roma' }, taxi.token)
    expect(req.status).toBe(201)
    expect(req.body.request).toMatchObject({ kind: 'merchant', amount: 15, note: 'Maseru → Roma', toUserId: taxi.user.id })
    let s = await t.call('GET', '/v1/merchant/summary', undefined, taxi.token)
    expect(s.body.pending.map((m: any) => m.id)).toContain(req.body.id)

    const chat = await chatByTitle(t, lerato.token, 'Taxi · Ntate Mokoena')
    expect(chat.lastMessage.id).toBe(req.body.id)
    const paid = await t.call('POST', `/v1/requests/${req.body.id}/pay`, { pin: '1234' }, lerato.token)
    expect(paid.body.transaction).toMatchObject({ kind: 'merchant', amount: -15, counterpartyName: 'Taxi · Ntate Mokoena' })
    expect(await balanceOf(t, taxi.token)).toBe(427)

    s = await t.call('GET', '/v1/merchant/summary', undefined, taxi.token)
    expect(s.body.pending).toHaveLength(0)
    expect(s.body.salesToday).toEqual({ count: 1, total: 15 })
    expect(s.body.recent[0]).toMatchObject({ kind: 'merchant', amount: 15 })
  })

  it('only merchants can charge', async () => {
    expect((await t.call('POST', '/v1/merchant/charge', { customerMsisdn: N.lerato, amount: 5 }, agent.token)).body.error.code).toBe('FORBIDDEN')
  })
})

describe('tap to pay', () => {
  it('no PIN at or under the limit; posts a receipt into the merchant chat', async () => {
    const r = await t.call('POST', '/v1/payments/tap', { merchantCode: '1042', amount: 200 }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.transaction).toMatchObject({ kind: 'tap', amount: -200 })
    expect(r.body.message).toMatchObject({ kind: 'receipt', amount: 200, senderId: lerato.user.id })
    const chat = await chatByTitle(t, taxi.token, 'Lerato Mokhothu')
    expect(chat.lastMessage.id).toBe(r.body.message.id)
  })

  it('requires a valid PIN above the limit', async () => {
    const noPin = await t.call('POST', '/v1/payments/tap', { merchantCode: '1001', amount: 200.01 }, lerato.token)
    expect(noPin.body.error.code).toBe('VALIDATION')
    expect(noPin.body.error.message).toMatch(/PIN/)
    expect((await t.call('POST', '/v1/payments/tap', { merchantCode: '1001', amount: 250, pin: '0000' }, lerato.token)).body.error.code).toBe('WRONG_PIN')
    const ok = await t.call('POST', '/v1/payments/tap', { merchantCode: ' 1001 ', amount: 250, pin: '1234' }, lerato.token)
    expect(ok.status).toBe(200)
    expect(ok.body.transaction.counterpartyName).toBe('Ha Abia Cafe')
    expect((await t.call('POST', '/v1/payments/tap', { merchantCode: 'NOPE-1', amount: 5 }, lerato.token)).body.error.code).toBe('NOT_FOUND')
  })
})
