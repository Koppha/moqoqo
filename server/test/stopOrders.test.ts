import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nextStopOrderDate } from '../../shared/api'
import { runDueStopOrders } from '../src/services/stopOrders'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let palesa: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  palesa = await t.login(N.palesa)
})
afterAll(() => t.close())

/** Noon in Maseru on a date. */
const at = (ymd: string) => new Date(`${ymd}T10:00:00Z`)
const run = (ymd: string) => runDueStopOrders(t.server.ctx, at(ymd))

describe('schedule dates', () => {
  it('monthly on a day, the last day, and weekly', () => {
    expect(nextStopOrderDate('monthly', 15, '2026-11-07')).toBe('2026-11-15')
    expect(nextStopOrderDate('monthly', 5, '2026-11-07')).toBe('2026-12-05')
    expect(nextStopOrderDate('monthly', 7, '2026-11-07')).toBe('2026-11-07')
    expect(nextStopOrderDate('monthly', 0, '2026-02-03')).toBe('2026-02-28')
    expect(nextStopOrderDate('weekly', 1, '2026-11-07')).toBe('2026-11-09') // Saturday → Monday
  })
})

describe('saved bills and people', () => {
  it('saves up to 5 accounts per biller, renames on a repeat, and lists them with the biller', async () => {
    for (let i = 1; i <= 5; i++) {
      expect((await t.call('POST', '/v1/saved-bills', { target: 'lec', account: `0412773190${i}`, nickname: `Meter ${i}` }, lerato.token)).status).toBe(201)
    }
    const sixth = await t.call('POST', '/v1/saved-bills', { target: 'lec', account: '04127731909', nickname: 'Too many' }, lerato.token)
    expect(sixth.body.error.code).toBe('LIMIT_EXCEEDED')
    const renamed = await t.call('POST', '/v1/saved-bills', { target: 'lec', account: '04127731901', nickname: 'Home' }, lerato.token)
    expect(renamed.body).toMatchObject({ nickname: 'Home', billerName: { en: 'LEC' } })
    // Another biller has its own 5.
    const dstv = await t.call('POST', '/v1/saved-bills', { target: 'service:bill-dstv', account: '4123456789', nickname: 'Lounge' }, lerato.token)
    expect(dstv.body).toMatchObject({ billerName: { en: 'DStv' }, account: '4123456789' })
    expect((await t.call('GET', '/v1/saved-bills', undefined, lerato.token)).body).toHaveLength(6)
  })

  it('saves people by number', async () => {
    const r = await t.call('POST', '/v1/saved-recipients', { msisdn: '62555010', nickname: 'Brother' }, lerato.token)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ nickname: 'Brother', user: { msisdn: N.thabo } })
    expect((await t.call('POST', '/v1/saved-recipients', { msisdn: N.lerato }, lerato.token)).status).toBe(400)
  })
})

describe('stop orders', () => {
  it('pays a saved bill on its day without the PIN, then moves to the next month', async () => {
    const bills = (await t.call('GET', '/v1/saved-bills', undefined, lerato.token)).body
    const dstv = bills.find((b: any) => b.target === 'service:bill-dstv')
    const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10)
    const day = Math.min(28, Number(today.slice(8)))
    expect((await t.call('POST', '/v1/stop-orders', { kind: 'bill', savedBillId: dstv.id, amount: 300, frequency: 'monthly', day, pin: '0000' }, lerato.token)).body.error.code).toBe('WRONG_PIN')
    const made = await t.call('POST', '/v1/stop-orders', { kind: 'bill', savedBillId: dstv.id, amount: 300, frequency: 'monthly', day, pin: '1234' }, lerato.token)
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ label: 'DStv · Lounge', amount: 300, status: 'active' })

    const before = await balanceOf(t, lerato.token)
    const tally = await run(made.body.nextRun)
    expect(tally.paid).toBeGreaterThanOrEqual(1)
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 300, 2)
    const after = (await t.call('GET', '/v1/stop-orders', undefined, lerato.token)).body.find((o: any) => o.id === made.body.id)
    expect(after.nextRun > made.body.nextRun).toBe(true)
    expect(after.last).toMatchObject({ status: 'paid' })
    // Running again the same day pays nothing more.
    await run(made.body.nextRun)
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 300, 2)
    // Can't remove a saved bill a stop order pays.
    expect((await t.call('DELETE', `/v1/saved-bills/${dstv.id}`, undefined, lerato.token)).body.error.code).toBe('CONFLICT')
  })

  it('short of money: tries again the next day, then marks it missed and carries on', async () => {
    const rec = await t.call('POST', '/v1/saved-recipients', { msisdn: N.lerato, nickname: 'Lerato' }, palesa.token)
    const made = await t.call('POST', '/v1/stop-orders', { kind: 'send', recipientId: rec.body.id, amount: 300, frequency: 'weekly', day: 3, pin: '1234' }, palesa.token)
    expect(made.status).toBe(201)
    const due = made.body.nextRun
    await run(due)
    let o = (await t.call('GET', '/v1/stop-orders', undefined, palesa.token)).body[0]
    expect(o.last, JSON.stringify(o.last)).toMatchObject({ status: 'retrying' })
    const nextDay = new Date(`${due}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    await run(nextDay.toISOString().slice(0, 10))
    o = (await t.call('GET', '/v1/stop-orders', undefined, palesa.token)).body[0]
    expect(o.last.status).toBe('failed')
    expect(o.status).toBe('active')
    expect(o.nextRun).toBe(nextStopOrderDate('weekly', 3, nextDay.toISOString().slice(0, 10)))
    const runs = (await t.call('GET', `/v1/stop-orders/${o.id}/runs`, undefined, palesa.token)).body
    expect(runs.map((r: any) => r.status)).toEqual(['failed', 'retrying'])
  })

  it('ends after the number of payments, and can be paused, resumed and cancelled', async () => {
    const lec = (await t.call('GET', '/v1/saved-bills', undefined, lerato.token)).body.find((b: any) => b.nickname === 'Home')
    const made = await t.call('POST', '/v1/stop-orders', { kind: 'bill', savedBillId: lec.id, amount: 20, frequency: 'weekly', day: 1, payments: 1, pin: '1234' }, lerato.token)
    await run(made.body.nextRun)
    const done = (await t.call('GET', '/v1/stop-orders', undefined, lerato.token)).body.find((o: any) => o.id === made.body.id)
    expect(done).toMatchObject({ status: 'ended', remaining: 0 })
    expect((await t.call('PUT', `/v1/stop-orders/${made.body.id}`, { status: 'active' }, lerato.token)).body.error.code).toBe('CONFLICT')

    const again = await t.call('POST', '/v1/stop-orders', { kind: 'bill', savedBillId: lec.id, amount: 20, frequency: 'monthly', day: 0, pin: '1234' }, lerato.token)
    expect((await t.call('PUT', `/v1/stop-orders/${again.body.id}`, { status: 'paused' }, lerato.token)).body.status).toBe('paused')
    const before = await balanceOf(t, lerato.token)
    await run(again.body.nextRun)
    expect(await balanceOf(t, lerato.token)).toBe(before) // paused: not paid
    expect((await t.call('PUT', `/v1/stop-orders/${again.body.id}`, { status: 'active' }, lerato.token)).body.status).toBe('active')
    expect((await t.call('DELETE', `/v1/stop-orders/${again.body.id}`, undefined, lerato.token)).status).toBe(204)
  })
})
