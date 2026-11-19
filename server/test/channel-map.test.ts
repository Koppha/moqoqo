import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runChurnScoring } from '../src/services/churn'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string
const ids: Record<string, string> = {}
const map = async () => (await t.call('GET', '/admin/v1/channel-map', undefined, admin)).body
const find = (m: any, id: string) => m.users.find((u: any) => u.user.id === id)

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
  for (const k of ['cafe', 'taxi', 'agent', 'lerato'] as const) {
    const [u] = await t.server.db.query<{ id: string }>('SELECT id FROM users WHERE msisdn = $1', [N[k]])
    ids[k] = u.id
  }
})
afterAll(() => t.close())

describe('channel map', () => {
  it('lists every agent and merchant, placed by their Find us place where they have one', async () => {
    const m = await map()
    expect(m.users.every((u: any) => u.user.role === 'agent' || u.user.role === 'merchant')).toBe(true)
    expect(find(m, ids.lerato)).toBeUndefined()
    // Seeded Find us places: Ha Abia Agent (by code AGENT-0101) and Ha Abia Cafe (by code 1001).
    expect(find(m, ids.agent).location).toMatchObject({ lat: -29.3369, lng: 27.4995, source: 'place' })
    expect(find(m, ids.cafe).location).toMatchObject({ source: 'place' })
    expect(find(m, ids.taxi).location).toBeNull()
    expect(m.located + m.unlocated).toBe(m.users.length)
  })

  it('staff place one by hand (audited), which wins over the Find us place; clearing goes back', async () => {
    const r = await t.call('PUT', `/admin/v1/channel-map/${ids.taxi}/location`, { lat: -29.3105, lng: 27.4782, address: 'Maseru taxi rank' }, admin)
    expect(r.status).toBe(200)
    expect(r.body.location).toEqual({ lat: -29.3105, lng: 27.4782, address: 'Maseru taxi rank', source: 'set' })

    await t.call('PUT', `/admin/v1/channel-map/${ids.cafe}/location`, { lat: -29.34, lng: 27.5 }, admin)
    expect(find(await map(), ids.cafe).location.source).toBe('set')
    expect((await t.call('DELETE', `/admin/v1/channel-map/${ids.cafe}/location`, undefined, admin)).status).toBe(204)
    expect(find(await map(), ids.cafe).location.source).toBe('place')
    expect(JSON.stringify((await t.call('GET', '/admin/v1/audit?pageSize=5', undefined, admin)).body)).toContain('channel.location')
  })

  it('refuses points outside Lesotho, customers, and writes by support staff', async () => {
    expect((await t.call('PUT', `/admin/v1/channel-map/${ids.taxi}/location`, { lat: 27.48, lng: -29.31 }, admin)).status).toBe(400)
    expect((await t.call('PUT', `/admin/v1/channel-map/${ids.lerato}/location`, { lat: -29.31, lng: 27.48 }, admin)).status).toBe(404)
    await t.createSupportAdmin('support@test.local', 'support-pass-123')
    const support = await t.adminLogin('support@test.local', 'support-pass-123')
    expect((await t.call('GET', '/admin/v1/channel-map', undefined, support)).status).toBe(200)
    expect((await t.call('PUT', `/admin/v1/channel-map/${ids.taxi}/location`, { lat: -29.31, lng: 27.48 }, support)).status).toBe(403)
  })

  it('carries the latest churn risk for colouring the pins', async () => {
    expect(find(await map(), ids.cafe).churn).toBeNull()
    await runChurnScoring(t.server.ctx)
    expect(find(await map(), ids.cafe).churn).toMatchObject({ band: expect.stringMatching(/^(high|medium|low|quiet)$/) })
  })
})
