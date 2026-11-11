import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
let chatId: string

const send = (amount = 1) =>
  t.call('POST', '/v1/payments/send', { chatId, toUserId: mme.user.id, amount, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, lerato.token)

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
  chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
})
afterAll(() => t.close())

describe('risk rules', () => {
  it('blocks too many payments too fast, and records it for staff', async () => {
    const rules = (await t.call('GET', '/admin/v1/risk/rules', undefined, admin)).body
    const set = await t.call('PUT', '/admin/v1/risk/rules', rules.map((r: any) => (r.key === 'velocity' ? { ...r, params: { count: 3, minutes: 10 } } : r)), admin)
    expect(set.body.find((r: any) => r.key === 'velocity').params.count).toBe(3)
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200)
    const blocked = await send()
    expect(blocked.body.error.code).toBe('RISK_BLOCKED')
    await new Promise((r) => setTimeout(r, 50))
    const alerts = (await t.call('GET', '/admin/v1/risk/alerts?status=open', undefined, admin)).body.items
    expect(alerts[0]).toMatchObject({ rule: 'velocity', action: 'blocked', severity: 'high', user: { msisdn: N.lerato } })
    // Switch it off again for the rest.
    await t.call('PUT', '/admin/v1/risk/rules', rules.map((r: any) => (r.key === 'velocity' ? { ...r, enabled: false } : r)), admin)
    expect((await send()).status).toBe(200)
  })

  it('flags an unusually large payment but lets it through', async () => {
    await t.server.db.query('UPDATE users SET balance_cents = 1000000 WHERE id = $1', [lerato.user.id])
    const r = await send(2500)
    expect(r.status).toBe(200)
    const alerts = (await t.call('GET', '/admin/v1/risk/alerts?status=open', undefined, admin)).body.items
    expect(alerts.some((a: any) => a.rule === 'unusual_amount' && a.action === 'flagged' && a.amount === 2500)).toBe(true)
  })

  it('staff mark fraud and can suspend the wallet', async () => {
    const alerts = (await t.call('GET', '/admin/v1/risk/alerts?status=open', undefined, admin)).body.items
    const a = alerts.find((x: any) => x.rule === 'unusual_amount')
    const done = await t.call('POST', `/admin/v1/risk/alerts/${a.id}/review`, { status: 'fraud', suspend: true }, admin)
    expect(done.body.status).toBe('fraud')
    expect((await t.call('GET', '/v1/me', undefined, lerato.token)).status).toBe(401)
    await t.server.db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [lerato.user.id])
  })
})

describe('analytics', () => {
  it('summarises users, money, services and risk for the period', async () => {
    const a = (await t.call('GET', '/admin/v1/analytics?days=7', undefined, admin)).body
    expect(a.users.total).toBeGreaterThan(5)
    expect(a.perDay).toHaveLength(8)
    expect(a.perDay.at(-1).transactions).toBeGreaterThan(0)
    expect(a.perDay.at(-1).activeUsers).toBeGreaterThan(0)
    expect(a.byKind.find((k: any) => k.kind === 'send').count).toBeGreaterThan(3)
    expect(a.risk.blocked).toBe(1)
    expect(a.notifications.map((n: any) => n.channel)).toEqual(['push', 'sms', 'email'])
  })
})

describe('performance', () => {
  it('compares the period with the one before, measures flows and API speed', async () => {
    await t.call('GET', '/v1/app-config')
    await t.call('GET', '/v1/me')
    await t.server.apiMetrics.flush()
    await t.call('GET', '/v1/app-config')
    await t.server.apiMetrics.flush()
    const p = (await t.call('GET', '/admin/v1/performance?days=7', undefined, admin)).body
    expect(p.kpis.payments.current).toBeGreaterThan(3)
    expect(p.kpis.volume.current).toBeGreaterThan(0)
    const send = p.products.find((r: any) => r.kind === 'send')
    expect(send.count.current).toBeGreaterThan(3)
    expect(send.users).toBeGreaterThan(0)
    expect(p.products.every((r: any) => r.kind !== 'fee')).toBe(true)
    expect(p.products.reduce((s: number, r: any) => s + r.share, 0)).toBeCloseTo(1)
    const risk = p.flows.find((f: any) => f.key === 'risk')
    expect(risk.total - risk.done).toBe(1)
    expect(p.flows.map((f: any) => f.key)).toContain('atm')
    // Added up across flushes: two app-config calls, and the unsigned /v1/me refused.
    const area = (name: string) => p.api.areas.find((a: any) => a.area === name)
    expect(area('app-config').requests).toBe(2)
    expect(area('me').clientErrors).toBeGreaterThanOrEqual(1)
    expect(p.api.p95Ms).toBeGreaterThan(0)
    expect(p.api.perDay).toHaveLength(8)
    expect((await t.call('GET', '/admin/v1/performance', undefined)).status).toBe(401)
  })
})

describe('latency percentiles', () => {
  it('interpolates within the bucket', async () => {
    const { percentile } = await import('../src/services/metrics')
    expect(percentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.5)).toBeNull()
    expect(percentile([10, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.5)).toBe(5)
    expect(percentile([0, 0, 0, 4, 0, 0, 0, 0, 0, 0], 1)).toBe(100)
  })
})

describe('filter chip counts', () => {
  it('counts each filter value with the other filters applied', async () => {
    const users = (await t.call('GET', '/admin/v1/users?role=agent', undefined, admin)).body
    expect(users.counts['role:agent']).toBe(users.total)
    expect(users.counts['role:all']).toBeGreaterThan(users.total)
    expect(users.counts['status:all']).toBe(users.total)

    const tx = (await t.call('GET', '/admin/v1/transactions?kind=send&days=7', undefined, admin)).body
    expect(tx.counts['kind:send']).toBe(tx.total)
    expect(tx.counts['kind:all']).toBeGreaterThan(tx.total)

    const alerts = (await t.call('GET', '/admin/v1/risk/alerts?severity=high', undefined, admin)).body
    expect(alerts.items.every((a: any) => a.severity === 'high')).toBe(true)
    expect(alerts.counts['severity:high']).toBe(alerts.total)
    expect(alerts.counts['action:blocked']).toBeGreaterThanOrEqual(1)
  })
})
