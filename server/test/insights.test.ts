import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { categorize, insightText, maseruMonth, monthRange, postMonthlyInsights } from '../src/services/insights'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
const ids: Record<string, string> = {}

const insights = async (month?: string) => (await t.call('GET', `/v1/insights${month ? `?month=${month}` : ''}`, undefined, lerato.token)).body
const line = (s: any, category: string) => s.categories.find((c: any) => c.category === category) ?? { amount: 0, lastMonth: 0, count: 0 }

/** A payment straight through the ledger, optionally moved back in time. */
async function pay(from: string, to: string, maloti: number, kind: string, at?: Date) {
  const r: any = await t.server.ctx.tx((q) => t.server.ctx.ledger.transfer(q, { kind: kind as any, fromUserId: from, toUserId: to, amountCents: Math.round(maloti * 100) }))
  if (at) await t.server.db.query('UPDATE transactions SET created_at = $2 WHERE id = $1', [r.tx.id, at])
}

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  for (const [k, v] of Object.entries({ lerato: N.lerato, mme: N.mme, taxi: N.taxi, cafe: N.cafe })) {
    const [u] = await t.server.db.query<{ id: string }>('SELECT id FROM users WHERE msisdn = $1', [v])
    ids[k] = u.id
  }
  for (const b of ['lec', 'school']) {
    const [u] = await t.server.db.query<{ id: string }>('SELECT id FROM users WHERE biller = $1', [b])
    ids[b] = u.id
  }
})
afterAll(() => t.close())

describe('spending insights', () => {
  it('Lesotho months: UTC+2 boundaries', () => {
    expect(maseruMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11')
    expect(maseruMonth(new Date('2026-01-15T00:00:00Z'), 1)).toBe('2025-12')
    expect(monthRange('2026-11')).toEqual({ from: new Date('2026-10-31T22:00:00Z'), to: new Date('2026-11-30T22:00:00Z') })
  })

  it('puts each payment in the right category', () => {
    const base = { cp_kind: null, cp_role: null, cp_biller: null, cp_code: null, society: false }
    expect(categorize({ ...base, kind: 'send', cp_kind: 'person', cp_role: 'customer' })).toBe('people')
    expect(categorize({ ...base, kind: 'tap', cp_kind: 'person', cp_role: 'merchant', cp_code: 'TAXI-0042' })).toBe('transport')
    expect(categorize({ ...base, kind: 'tap', cp_kind: 'person', cp_role: 'merchant', cp_code: '1042', cp_name: 'Taxi · Ntate Mokoena' })).toBe('transport')
    expect(categorize({ ...base, kind: 'qr', cp_kind: 'person', cp_role: 'merchant', cp_code: 'MRC-0001', cp_name: 'Ha Abia Cafe' })).toBe('shops')
    expect(categorize({ ...base, kind: 'bill', cp_kind: 'system', cp_biller: 'school' })).toBe('school')
    expect(categorize({ ...base, kind: 'request', cp_kind: 'system', cp_biller: 'lec' })).toBe('electricity')
    expect(categorize({ ...base, kind: 'send', cp_kind: 'system', society: true })).toBe('society')
    expect(categorize({ ...base, kind: 'atm' })).toBe('cash')
    expect(categorize({ ...base, kind: 'fee', cp_kind: 'system', cp_biller: 'fees' })).toBe('fees')
  })

  it("adds up this month's money out by category, beside last month", async () => {
    const before = await insights()
    expect(before.month).toBe(maseruMonth())
    const lastMonthAt = new Date(monthRange(maseruMonth(new Date(), 1)).from.getTime() + 5 * 86_400_000)
    await pay(ids.lerato, ids.taxi, 12, 'tap')
    await pay(ids.lerato, ids.taxi, 12, 'tap')
    await pay(ids.lerato, ids.taxi, 30, 'tap', lastMonthAt)
    await pay(ids.lerato, ids.school, 450, 'bill')
    await pay(ids.lerato, ids.mme, 100, 'send')
    await pay(ids.mme, ids.lerato, 40, 'send')

    const after = await insights()
    expect(line(after, 'transport').amount - line(before, 'transport').amount).toBeCloseTo(24, 2)
    expect(line(after, 'transport').count - line(before, 'transport').count).toBe(2)
    expect(line(after, 'transport').lastMonth - line(before, 'transport').lastMonth).toBeCloseTo(30, 2)
    expect(line(after, 'school').amount - line(before, 'school').amount).toBeCloseTo(450, 2)
    expect(line(after, 'people').amount - line(before, 'people').amount).toBeCloseTo(100, 2)
    expect(after.spent - before.spent).toBeCloseTo(574, 2)
    expect(after.received - before.received).toBeCloseTo(40, 2)
    expect(after.categories.map((c: any) => c.amount)).toEqual([...after.categories.map((c: any) => c.amount)].sort((a, b) => b - a))
    expect(after.topPayees.length).toBeLessThanOrEqual(3)
  })

  it('refuses a malformed month and needs a session', async () => {
    expect((await t.call('GET', '/v1/insights?month=2026-13', undefined, lerato.token)).status).toBe(400)
    expect((await t.call('GET', '/v1/insights')).status).toBe(401)
  })

  it('writes a short summary, and nothing for a month with no spending', () => {
    const text = insightText({
      month: '2026-10', spent: 1240, lastMonthSpent: 1000, received: 2000, topPayees: [],
      categories: [
        { category: 'transport', amount: 600, lastMonth: 500, count: 40 },
        { category: 'electricity', amount: 400, lastMonth: 400, count: 2 },
        { category: 'people', amount: 240, lastMonth: 100, count: 3 },
      ],
    })
    expect(text).toContain('Your October in EcoCash')
    expect(text).toContain('You spent M1,240.00 and received M2,000.00.')
    expect(text).toContain('taxis (M600.00)')
    expect(text).toContain('Family & friends: 140% more than September.')
    expect(insightText({ month: '2026-10', spent: 0, lastMonthSpent: 0, received: 50, categories: [], topPayees: [] })).toBeNull()
  })

  it("the assistant posts last month's summary once, after 08:00 on the 1st", async () => {
    // Something spent in the month before "now" below.
    const now = new Date(monthRange(maseruMonth(new Date(), -1)).from.getTime() + 10 * 3_600_000) // 1st of next month, 10:00 in Maseru
    const early = new Date(monthRange(maseruMonth(new Date(), -1)).from.getTime() + 5 * 3_600_000) // 05:00
    expect(await postMonthlyInsights(t.server.ctx, early)).toBe(0)
    expect(await postMonthlyInsights(t.server.ctx, now)).toBeGreaterThan(0)
    expect(await postMonthlyInsights(t.server.ctx, now)).toBe(0)

    const chat = await chatByTitle(t, lerato.token, 'EcoCash Assistant')
    const msgs = (await t.call('GET', `/v1/chats/${chat.id}/messages?limit=5`, undefined, lerato.token)).body
    const action = msgs.find((m: any) => m.kind === 'action')
    expect(action.action).toEqual({ type: 'open', screen: 'insights' })
    expect(msgs.some((m: any) => m.kind === 'text' && /in EcoCash 📊/.test(m.text))).toBe(true)
  })
})
