import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string
let lerato: { token: string; user: any }

const kingsway = { kind: 'agent', name: 'Test Agent Kingsway', address: 'Kingsway, Maseru', lat: -29.316, lng: 27.486, hours: '08:00–17:00', enabled: true }

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
  lerato = await t.login(N.lerato)
})
afterAll(() => t.close())

describe('places (agents, merchants, ATMs)', () => {
  it('the apps see the starter places with no sign-in', async () => {
    const r = await t.call('GET', '/v1/places')
    expect(r.status).toBe(200)
    expect(r.body.map((p: any) => p.kind)).toEqual(expect.arrayContaining(['agent', 'merchant', 'atm']))
    expect(r.body.find((p: any) => p.code === 'AGENT-0101')).toMatchObject({ name: 'Ha Abia Agent', lat: -29.3369 })
  })

  it('staff add, edit, hide and remove a place; customers cannot', async () => {
    expect((await t.call('POST', '/admin/v1/places', kingsway, lerato.token)).status).toBe(401)
    const made = await t.call('POST', '/admin/v1/places', kingsway, admin)
    expect(made.status).toBe(201)
    expect((await t.call('GET', '/v1/places')).body.map((p: any) => p.id)).toContain(made.body.id)

    const hidden = await t.call('PUT', `/admin/v1/places/${made.body.id}`, { ...kingsway, name: 'Kingsway Agent', enabled: false }, admin)
    expect(hidden.body).toMatchObject({ name: 'Kingsway Agent', enabled: false })
    expect((await t.call('GET', '/v1/places')).body.map((p: any) => p.id)).not.toContain(made.body.id)
    expect((await t.call('GET', '/admin/v1/places', undefined, admin)).body.map((p: any) => p.id)).toContain(made.body.id)

    expect((await t.call('DELETE', `/admin/v1/places/${made.body.id}`, undefined, admin)).status).toBe(204)
    expect((await t.call('DELETE', `/admin/v1/places/${made.body.id}`, undefined, admin)).status).toBe(404)
    const audit = (await t.call('GET', '/admin/v1/audit', undefined, admin)).body
    expect(JSON.stringify(audit)).toContain('place.delete')
  })

  it('refuses a location outside Lesotho (latitude and longitude swapped)', async () => {
    const r = await t.call('POST', '/admin/v1/places', { ...kingsway, lat: 27.486, lng: -29.316 }, admin)
    expect(r.status).toBe(400)
    expect(r.body.error.message).toMatch(/outside Lesotho/)
  })
})

describe('feedback and contact us', () => {
  it('a customer leaves feedback; staff read it', async () => {
    expect((await t.call('POST', '/v1/feedback', { rating: 5, text: 'Love split bill', app: 'customer', appVersion: '1.0.0' }, lerato.token)).status).toBe(201)
    expect((await t.call('POST', '/v1/feedback', { rating: 6, app: 'customer' }, lerato.token)).status).toBe(400)
    const list = (await t.call('GET', '/admin/v1/feedback', undefined, admin)).body
    expect(list[0]).toMatchObject({ rating: 5, text: 'Love split bill', app: 'customer', user: { msisdn: N.lerato } })
  })

  it('contact details come in the app config and are edited in the portal', async () => {
    expect((await t.call('GET', '/v1/app-config')).body.contact).toMatchObject({ phone: '199' })
    const saved = await t.call('PUT', '/admin/v1/contact-settings', { phone: '+266 2221 2000', whatsapp: '+26662000000', email: 'care@etl.co.ls', website: 'https://etl.co.ls', shareLink: 'https://etl.co.ls/app' }, admin)
    expect(saved.status).toBe(200)
    expect((await t.call('GET', '/v1/app-config')).body.contact).toMatchObject({ whatsapp: '+26662000000', shareLink: 'https://etl.co.ls/app' })
    expect((await t.call('PUT', '/admin/v1/contact-settings', { ...saved.body, shareLink: 'etl.co.ls' }, admin)).status).toBe(400)
  })
})
