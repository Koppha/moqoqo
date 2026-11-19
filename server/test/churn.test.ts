import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChurnActivity } from '../../shared/api'
import { maseruDay, runChurnScoring, scoreChurn } from '../src/services/churn'
import { N, startTestServer, type TestServer } from './helpers'

const P = { highAt: 60, mediumAt: 35, quietDays: 30, lowFloat: 300 }
const steady: ChurnActivity = {
  daysSinceLast: 0, txPerWeekNow: 20, txPerWeekBefore: 20, valuePerWeekNow: 2000, valuePerWeekBefore: 2000,
  customersPerWeekNow: 12, customersPerWeekBefore: 12, activeDays28: 24, balance: 5000, tenureDays: 400,
}

describe('churn score', () => {
  it('a steady business is low risk with no reasons', () => {
    expect(scoreChurn(steady, 'merchant', P)).toEqual({ score: 0, band: 'low', reasons: [] })
  })

  it('a sharp slowdown is high risk, with the biggest reasons first', () => {
    const s = scoreChurn({ ...steady, daysSinceLast: 9, txPerWeekNow: 4, valuePerWeekNow: 600, customersPerWeekNow: 3, activeDays28: 4 }, 'merchant', P)
    expect(s.band).toBe('high')
    expect(s.score).toBe(25 + 30 + 10 + 15 + 10)
    expect(s.reasons.map((r) => r.feature)).toEqual(['activity_drop', 'inactive', 'customers_drop', 'value_drop', 'few_active_days'])
    expect(s.reasons[0].detail).toBe('4.0 transactions a week, down 80% from 20.0')
  })

  it('an agent out of float is flagged; a merchant with the same balance is not', () => {
    expect(scoreChurn({ ...steady, balance: 120 }, 'agent', P).reasons).toEqual([{ feature: 'low_float', points: 15, detail: 'Float M120, below M300' }])
    expect(scoreChurn({ ...steady, balance: 120 }, 'merchant', P).score).toBe(0)
  })

  it('no transaction for the quiet period counts as gone quiet', () => {
    expect(scoreChurn({ ...steady, daysSinceLast: 31 }, 'agent', P)).toMatchObject({ score: 100, band: 'quiet' })
    expect(scoreChurn({ ...steady, daysSinceLast: null, tenureDays: 45 }, 'merchant', P).reasons[0].detail).toBe('No transaction yet')
  })

  it("is not fooled by a business that was always small, or one that's brand new", () => {
    const small = scoreChurn({ ...steady, txPerWeekNow: 1, txPerWeekBefore: 2, valuePerWeekNow: 40, valuePerWeekBefore: 80, customersPerWeekNow: 1, customersPerWeekBefore: 1, activeDays28: 8 }, 'merchant', P)
    expect(small.band).toBe('low')
    expect(scoreChurn({ ...steady, daysSinceLast: 20, tenureDays: 10 }, 'merchant', P)).toMatchObject({ score: 0, band: 'low', reasons: [{ feature: 'new_account' }] })
  })

  it('follows the thresholds staff set', () => {
    const a = { ...steady, daysSinceLast: 8 } // 25 points
    expect(scoreChurn(a, 'merchant', P).band).toBe('low')
    expect(scoreChurn(a, 'merchant', { ...P, mediumAt: 20 }).band).toBe('medium')
    expect(scoreChurn(a, 'merchant', { ...P, highAt: 25 }).band).toBe('high')
  })
})

describe('retention in the portal', () => {
  let t: TestServer
  let admin: string
  const ids: Record<string, string> = {}
  // 200 days ahead, so the demo seed's own transactions are all older than the 8 weeks scored.
  const now = new Date(Date.now() + 200 * 86_400_000)
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)

  // Past activity written straight into the ledger table: a burst of real payments would (rightly) trip the fraud rules.
  let seq = 0
  async function pay(from: string, to: string, maloti: number, kind: string, at: Date) {
    seq++
    await t.server.db.query(
      'INSERT INTO transactions (id, reference, kind, amount_cents, from_user_id, to_user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [`churn-test-${seq}`, `CHURNTEST${seq}`, kind, Math.round(maloti * 100), from, to, at],
    )
  }

  beforeAll(async () => {
    t = await startTestServer()
    admin = await t.adminLogin()
    for (const [k, v] of Object.entries(N)) {
      const [u] = await t.server.db.query<{ id: string }>('SELECT id FROM users WHERE msisdn = $1', [v])
      ids[k] = u.id
    }
    await t.server.db.query(`UPDATE users SET created_at = $1 WHERE role IN ('agent', 'merchant')`, [daysAgo(365)])
    // Cafe: busy for six weeks, then nothing for the last 20 days.
    for (let d = 20; d < 56; d += 2) await pay(ids.lerato, ids.cafe, 60, 'qr', daysAgo(d))
    // Taxi: steady fares throughout, from several customers.
    for (let d = 0; d < 56; d += 1) await pay(d % 2 ? ids.lerato : ids.thabo, ids.taxi, 12, 'tap', daysAgo(d))
    // Agent: nothing in the 8 weeks at all (the seed's activity is long before).
  })
  afterAll(() => t.close())

  it('scores every active agent and merchant and lists the riskiest first', async () => {
    expect(await runChurnScoring(t.server.ctx, now)).toBeGreaterThanOrEqual(3)
    const r = await t.call('GET', '/admin/v1/churn?pageSize=100', undefined, admin)
    expect(r.status).toBe(200)
    const by = (id: string) => r.body.items.find((x: any) => x.user.id === id)
    expect(by(ids.cafe)).toMatchObject({ band: 'high', followup: { status: 'new' } })
    expect(by(ids.cafe).reasons[0].feature).toBe('inactive')
    expect(by(ids.taxi)).toMatchObject({ band: 'low' })
    expect(by(ids.agent)).toMatchObject({ band: 'quiet', score: 100 })
    const order = { high: 0, medium: 1, quiet: 2, low: 3 } as Record<string, number>
    const bands = r.body.items.map((x: any) => order[x.band])
    expect(bands).toEqual([...bands].sort((a: number, b: number) => a - b))
    expect(r.body.summary.byBand.merchant.high).toBeGreaterThanOrEqual(1)
    expect(r.body.summary.weeklyValueAtRisk).toBeGreaterThan(0)
    expect(r.body.counts['band:high']).toBeGreaterThanOrEqual(1)
  })

  it('filters by role, band and search', async () => {
    const agents = (await t.call('GET', '/admin/v1/churn?role=agent', undefined, admin)).body
    expect(agents.items.every((x: any) => x.user.role === 'agent')).toBe(true)
    const cafe = (await t.call('GET', '/admin/v1/churn?band=high&q=cafe', undefined, admin)).body
    expect(cafe.items.map((x: any) => x.user.id)).toEqual([ids.cafe])
  })

  it('staff record a follow-up (audited); support staff can only read', async () => {
    const r = await t.call('PUT', `/admin/v1/churn/${ids.cafe}/followup`, { status: 'contacted', note: 'Called: card machine broken, sending a technician' }, admin)
    expect(r.status).toBe(200)
    expect(r.body.followup).toMatchObject({ status: 'contacted', by: 'admin@test.local' })
    const list = (await t.call('GET', '/admin/v1/churn?followup=contacted', undefined, admin)).body
    expect(list.items.map((x: any) => x.user.id)).toEqual([ids.cafe])
    const audit = (await t.call('GET', '/admin/v1/audit?pageSize=5', undefined, admin)).body
    expect(JSON.stringify(audit)).toContain('churn.followup')

    await t.createSupportAdmin('support@test.local', 'support-pass-123')
    const support = await t.adminLogin('support@test.local', 'support-pass-123')
    expect((await t.call('GET', '/admin/v1/churn', undefined, support)).status).toBe(200)
    expect((await t.call('PUT', `/admin/v1/churn/${ids.cafe}/followup`, { status: 'lost', note: '' }, support)).status).toBe(403)
  })

  it('shows the history and the track record of earlier scores', async () => {
    // A month earlier the cafe was scored high and the agent low; both are quiet or high now.
    const then = maseruDay(daysAgo(31))
    for (const [id, band] of [[ids.cafe, 'high'], [ids.agent, 'low']] as const) {
      await t.server.db.query(`INSERT INTO churn_scores (user_id, day, score, band) VALUES ($1, $2, $3, $4)`, [id, then, band === 'high' ? 70 : 10, band])
    }
    const s = (await t.call('GET', '/admin/v1/churn', undefined, admin)).body.summary.backtest
    expect(s.scoredOn).toBe(then)
    expect(s.low).toEqual({ scored: 1, wentQuiet: 1 })
    expect(s.high).toEqual({ scored: 1, wentQuiet: 0 })

    const d = (await t.call('GET', `/admin/v1/churn/${ids.cafe}`, undefined, admin)).body
    expect(d.history.map((h: any) => h.band)).toEqual(['high', 'high'])
  })

  it('is listed in AI governance, tunable, and stops when switched off', async () => {
    const models = (await t.call('GET', '/admin/v1/ai/models', undefined, admin)).body
    const churn = models.find((x: any) => x.key === 'churn_risk')
    expect(churn).toMatchObject({ mode: 'active', params: { highAt: 60, mediumAt: 35 } })
    expect(churn.stats.decisions).toBeGreaterThanOrEqual(3)
    expect((await t.call('PUT', '/admin/v1/ai/models/churn_risk', { mode: 'off', params: {}, note: 'Pausing for review' }, admin)).status).toBe(200)
    expect(await runChurnScoring(t.server.ctx, now)).toBe(0)
  })
})
