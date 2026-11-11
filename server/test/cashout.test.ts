import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

const DEMO_TAG = '04A2246A8B6D80' // Lerato's sticker

let t: TestServer
let agent: { token: string; user: any }
let cafe: { token: string; user: any }
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  agent = await t.login(N.agent, 'business')
  cafe = await t.login(N.cafe, 'business')
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
})
afterAll(() => t.close())

const cashout = (amount: number) => t.call('POST', '/v1/agent/cashouts', { amount }, agent.token)

describe('agent cash-out at the counter', () => {
  it('customer pays the QR or code: settled as a cash-out to the agent, counted in the summary', async () => {
    const c = await cashout(200)
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ purpose: 'cashout', amount: 200, status: 'open', merchant: { code: 'AGENT-0101' } })

    const before = { lerato: await balanceOf(t, lerato.token), agent: await balanceOf(t, agent.token) }
    const paid = await t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'qr' }, lerato.token)
    expect(paid.status).toBe(200)
    expect(paid.body.transaction).toMatchObject({ kind: 'cashout', amount: -200 })
    expect(await balanceOf(t, lerato.token)).toBe(before.lerato - 200)
    expect(await balanceOf(t, agent.token)).toBe(before.agent + 200)
    expect((await chatByTitle(t, lerato.token, 'Ha Abia Agent')).lastMessage).toMatchObject({ kind: 'receipt', amount: 200, note: 'Cash-out · AGENT-0101 · Ha Abia Agent' })

    const after = await t.call('GET', `/v1/merchant/intents/${c.body.id}`, undefined, agent.token)
    expect(after.body).toMatchObject({ status: 'paid', purpose: 'cashout', paidBy: { id: lerato.user.id } })
    const summary = await t.call('GET', '/v1/agent/summary', undefined, agent.token)
    expect(summary.body.cashOutToday).toEqual({ count: 1, total: 200 })
    expect(summary.body.commissionToday).toBe(2) // 1% placeholder rate
  })

  it('the agent code finds the newest open request', async () => {
    const c = await cashout(50)
    const found = await t.call('GET', '/v1/intents/lookup?business=agent-0101', undefined, thabo.token)
    expect(found.body).toMatchObject({ id: c.body.id, purpose: 'cashout' })
    await t.call('POST', `/v1/merchant/intents/${c.body.id}/cancel`, undefined, agent.token)
    expect((await t.call('GET', '/v1/intents/lookup?business=AGENT-0101', undefined, thabo.token)).body.error.code).toBe('NOT_FOUND')
  })

  it('tap and payment code need the PIN even for small cash-outs', async () => {
    const c = await cashout(20)
    expect((await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: DEMO_TAG }, agent.token)).body.error.code).toBe('VALIDATION')
    const tapped = await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: DEMO_TAG, pin: '1234' }, agent.token)
    expect(tapped.body).toMatchObject({ status: 'paid', method: 'tap', transaction: { kind: 'cashout' } })

    await t.call('POST', '/v1/paycode/enable', { pin: '1234' }, thabo.token)
    const code = (await t.call('POST', '/v1/paycode', undefined, thabo.token)).body.code
    const d = await cashout(30)
    expect((await t.call('POST', `/v1/merchant/intents/${d.body.id}/paycode`, { code }, agent.token)).body.error.code).toBe('VALIDATION')
    const scanned = await t.call('POST', `/v1/merchant/intents/${d.body.id}/paycode`, { code, pin: '1234' }, agent.token)
    expect(scanned.body).toMatchObject({ status: 'paid', method: 'paycode', paidBy: { id: thabo.user.id } })
  })

  it('only agents create cash-outs; merchants still create sales', async () => {
    expect((await t.call('POST', '/v1/agent/cashouts', { amount: 5 }, cafe.token)).body.error.code).toBe('FORBIDDEN')
    expect((await t.call('POST', '/v1/agent/cashouts', { amount: 5 }, lerato.token)).body.error.code).toBe('FORBIDDEN')
    expect((await t.call('POST', '/v1/merchant/intents', { amount: 5 }, cafe.token)).body.purpose).toBe('sale')
  })
})
