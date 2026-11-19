import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
})
afterAll(() => t.close())

const auditActions = async () => (await t.call('GET', '/admin/v1/audit?pageSize=100', undefined, admin)).body.items as any[]

describe('admin auth', () => {
  it('logs in, rejects wrong passwords and wallet tokens', async () => {
    expect((await t.call('POST', '/admin/v1/login', { email: ADMIN.email, password: 'nope' })).body.error.code).toBe('UNAUTHORIZED')
    const me = await t.call('GET', '/admin/v1/me', undefined, admin)
    expect(me.body).toMatchObject({ email: ADMIN.email, role: 'admin' })
    const wallet = await t.login(N.lerato)
    expect((await t.call('GET', '/admin/v1/me', undefined, wallet.token)).status).toBe(401)
    expect((await t.call('GET', '/v1/me', undefined, admin)).status).toBe(401)
  })

  it('support accounts are read-only', async () => {
    await t.createSupportAdmin('support@test.local', 'support-pass-1')
    const support = await t.adminLogin('support@test.local', 'support-pass-1')
    expect((await t.call('GET', '/admin/v1/users', undefined, support)).status).toBe(200)
    expect((await t.call('GET', '/admin/v1/stats', undefined, support)).status).toBe(200)
    const write = await t.call('POST', '/admin/v1/users', { msisdn: '+26662111222', name: 'X', role: 'customer', pin: '1234' }, support)
    expect(write.status).toBe(403)
    expect(write.body.error.code).toBe('FORBIDDEN')
    expect((await t.call('PUT', '/admin/v1/app-config', { announcement: null, minVersion: { customer: null, business: null } }, support)).body.error.code).toBe('FORBIDDEN')
    expect((await t.call('POST', '/admin/v1/maintenance', { startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 6e5).toISOString(), message: { en: 'x', st: 'y' } }, support)).status).toBe(403)
  })
})

describe('admin users', () => {
  it('lists users with query, role and status filters and pagination', async () => {
    const all = await t.call('GET', '/admin/v1/users', undefined, admin)
    expect(all.body).toMatchObject({ total: 8, page: 1, pageSize: 25 })
    expect(all.body.items.every((u: any) => u.status === 'active' && 'lastSeenAt' in u)).toBe(true)
    expect((await t.call('GET', '/admin/v1/users?role=merchant', undefined, admin)).body.total).toBe(3)
    const q = await t.call('GET', '/admin/v1/users?query=lerato', undefined, admin)
    // Lerato and her business (Lerato’s Salon, demo data).
    expect(q.body.items.map((u: any) => u.msisdn).sort()).toEqual([N.lerato, '+26662888021'])
    expect((await t.call('GET', `/admin/v1/users?query=${encodeURIComponent('62555')}`, undefined, admin)).body.items[0].name).toBe('Thabo')
    const p2 = await t.call('GET', '/admin/v1/users?pageSize=5&page=2', undefined, admin)
    expect(p2.body.items).toHaveLength(3)
  })

  it('creates users with generated codes; they can log in', async () => {
    const agent = await t.call('POST', '/admin/v1/users', { msisdn: '62777002', name: 'Roma Agent', role: 'agent', pin: '5815' }, admin)
    expect(agent.status).toBe(201)
    expect(agent.body).toMatchObject({ msisdn: '+26662777002', role: 'agent', code: 'AGENT-0102', balance: 0, status: 'active' })
    const merchant = await t.call('POST', '/admin/v1/users', { msisdn: '+26662888002', name: 'Thato', role: 'merchant', pin: '5815', businessName: 'Roma Spaza' }, admin)
    expect(merchant.body).toMatchObject({ code: '1043', businessName: 'Roma Spaza' })
    expect((await t.call('POST', '/admin/v1/users', { msisdn: '+26662888002', name: 'Dup', role: 'customer', pin: '5815' }, admin)).body.error.code).toBe('CONFLICT')
    expect((await t.login('+26662777002', 'business', '5815')).user.code).toBe('AGENT-0102')

    // Float top-up for the new agent.
    const f = await t.call('POST', `/admin/v1/users/${agent.body.id}/float`, { amount: 5000, note: 'FNB deposit 8812' }, admin)
    expect(f.body.balance).toBe(5000)
    expect((await t.call('POST', `/admin/v1/users/${merchant.body.id}/float`, { amount: 5, note: 'x' }, admin)).body.error.code).toBe('VALIDATION')
    const txs = await t.call('GET', '/admin/v1/transactions?kind=float', undefined, admin)
    expect(txs.body.items[0]).toMatchObject({ kind: 'float', amount: 5000, from: null, to: { id: agent.body.id } })
  })

  it('suspend → login refused; reactivate; reset PIN', async () => {
    const { user } = await t.login(N.thabo)
    const s = await t.call('PATCH', `/admin/v1/users/${user.id}`, { status: 'suspended' }, admin)
    expect(s.body.status).toBe('suspended')
    expect((await t.call('GET', '/admin/v1/users?status=suspended', undefined, admin)).body.total).toBe(1)
    const refused = await t.call('POST', '/v1/auth/login', { msisdn: N.thabo, pin: '1234', app: 'customer' })
    expect(refused.status).toBe(403)
    expect(refused.body.error.code).toBe('SUSPENDED')
    await t.call('PATCH', `/admin/v1/users/${user.id}`, { status: 'active', name: 'Thabo Mokhothu' }, admin)

    const before = await t.login(N.thabo)
    expect((await t.call('POST', `/admin/v1/users/${user.id}/reset-pin`, { pin: '2468' }, admin)).status).toBe(204)
    expect((await t.call('GET', '/v1/me', undefined, before.token)).status).toBe(401) // signed out everywhere
    expect((await t.call('POST', '/v1/auth/login', { msisdn: N.thabo, pin: '1234', app: 'customer' })).body.error.code).toBe('WRONG_PIN')
    expect((await t.login(N.thabo, 'customer', '2468')).user.name).toBe('Thabo Mokhothu')
  })

  it('every write is audited', async () => {
    const actions = (await auditActions()).map((a) => a.action)
    for (const a of ['user.create', 'user.float', 'user.suspend', 'user.reactivate', 'user.update', 'user.reset-pin']) expect(actions).toContain(a)
    const entry = (await auditActions()).find((a) => a.action === 'user.suspend')
    expect(entry).toMatchObject({ adminEmail: ADMIN.email })
    expect(entry.target).toMatch(/^user:/)
  })

  it('stats and transactions', async () => {
    const s = await t.call('GET', '/admin/v1/stats', undefined, admin)
    expect(s.body.users).toEqual({ customer: 4, agent: 2, merchant: 4 })
    expect(s.body.suspended).toBe(0)
    expect(s.body.today.newUsers).toBe(2)
    const tx = await t.call('GET', `/admin/v1/transactions?query=${encodeURIComponent('Lerato')}`, undefined, admin)
    expect(tx.body.total).toBeGreaterThan(0)
    expect(tx.body.items[0].reference).toMatch(/^MP\d{10}$/)
  })
})

describe('maintenance and app config', () => {
  it('scheduled windows are announced, cancellable and do not block', async () => {
    const startsAt = new Date(Date.now() + 2 * 3600_000).toISOString()
    const endsAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const w = await t.call('POST', '/admin/v1/maintenance', { startsAt, endsAt, message: { en: 'Upgrade', st: 'Ntlafatso' } }, admin)
    expect(w.status).toBe(201)
    expect(w.body).toMatchObject({ status: 'scheduled', createdBy: ADMIN.email })
    const cfg = await t.call('GET', '/v1/app-config')
    expect(cfg.body.maintenance).toMatchObject({ id: w.body.id, active: false })
    const { token } = await t.login(N.lerato)
    expect((await t.call('GET', '/v1/me', undefined, token)).status).toBe(200)
    const c = await t.call('POST', `/admin/v1/maintenance/${w.body.id}/cancel`, undefined, admin)
    expect(c.body.status).toBe('cancelled')
    expect((await t.call('GET', '/v1/app-config')).body.maintenance).toBeNull()
    expect((await t.call('POST', `/admin/v1/maintenance/${w.body.id}/cancel`, undefined, admin)).body.error.code).toBe('CONFLICT')
  })

  it('an active window answers 503 MAINTENANCE on /v1 but not app-config or /admin', async () => {
    const { token } = await t.login(N.lerato)
    const w = await t.call(
      'POST',
      '/admin/v1/maintenance',
      { startsAt: new Date(Date.now() - 5000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), message: { en: 'Back soon', st: 'Re tla khutla' } },
      admin,
    )
    expect(w.body.status).toBe('active')

    const blocked = await t.call('GET', '/v1/chats', undefined, token)
    expect(blocked.status).toBe(503)
    expect(blocked.body.error).toMatchObject({ code: 'MAINTENANCE', message: 'Back soon', maintenance: { id: w.body.id, active: true } })
    expect((await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '1234', app: 'customer' })).status).toBe(503)

    const cfg = await t.call('GET', '/v1/app-config')
    expect(cfg.status).toBe(200)
    expect(cfg.body.maintenance).toMatchObject({ id: w.body.id, active: true, message: { en: 'Back soon', st: 'Re tla khutla' } })
    expect((await t.call('GET', '/admin/v1/stats', undefined, admin)).body.maintenance.active).toBe(true)

    const patched = await t.call('PATCH', `/admin/v1/maintenance/${w.body.id}`, { message: { en: 'Almost done', st: 'Hoo e batla e fela' } }, admin)
    expect(patched.body.message.en).toBe('Almost done')
    const ended = await t.call('POST', `/admin/v1/maintenance/${w.body.id}/end`, undefined, admin)
    expect(ended.body.status).toBe('ended')
    expect((await t.call('GET', '/v1/chats', undefined, token)).status).toBe(200)
    const list = await t.call('GET', '/admin/v1/maintenance', undefined, admin)
    expect(list.body.map((x: any) => x.status)).toEqual(['ended', 'cancelled'])
    const actions = (await auditActions()).map((a) => a.action)
    for (const a of ['maintenance.create', 'maintenance.update', 'maintenance.end', 'maintenance.cancel']) expect(actions).toContain(a)
  })

  it('announcement and minVersion', async () => {
    const body = { announcement: { en: 'New fees from 1 Nov', st: 'Litefello tse ncha' }, minVersion: { customer: '1.2.0', business: null } }
    const r = await t.call('PUT', '/admin/v1/app-config', body, admin)
    expect(r.body).toMatchObject(body)
    expect((await t.call('GET', '/v1/app-config')).body).toMatchObject(body)
    expect((await t.call('PUT', '/admin/v1/app-config', { announcement: null, minVersion: { customer: 'v1', business: null } }, admin)).body.error.code).toBe('VALIDATION')
    expect((await auditActions()).map((a) => a.action)).toContain('app-config.update')
  })
})
