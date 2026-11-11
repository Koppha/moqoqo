import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { png, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string
const upload = (kind: string, base64: string, contentType = 'image/png') => t.call('POST', '/admin/v1/assets', { kind, contentType, base64 }, admin)

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('branding', () => {
  it('a new logo reaches the apps through app-config', async () => {
    const logo = await upload('logo', png(300, 120))
    expect(logo.status).toBe(201)
    expect(logo.body).toMatchObject({ kind: 'logo', width: 300, height: 120, path: `/v1/assets/${logo.body.id}` })
    expect((await t.call('GET', '/v1/app-config')).body.branding).toEqual({ logo: null, miniAppIcons: {} })
    const set = await t.call('PUT', '/admin/v1/branding', { logoId: logo.body.id, appIconId: null }, admin)
    expect(set.body.logo.id).toBe(logo.body.id)
    expect((await t.call('GET', '/v1/app-config')).body.branding).toEqual({ logo: logo.body.path, miniAppIcons: {} })
    const file = await t.server.app.inject({ method: 'GET', url: logo.body.path })
    expect(file.headers['content-type']).toBe('image/png')
    expect(file.headers['cache-control']).toContain('immutable')
  })

  it('the home-screen icon must be a square PNG of 512 px or more', async () => {
    expect((await upload('app_icon', png(300, 300))).status).toBe(400)
    expect((await upload('app_icon', png(600, 512))).status).toBe(400)
    const ok = await upload('app_icon', png(512, 512))
    expect(ok.status).toBe(201)
    const set = await t.call('PUT', '/admin/v1/branding', { logoId: null, appIconId: ok.body.id }, admin)
    expect(set.body.appIcon).toMatchObject({ width: 512 })
    // A logo isn't accepted as the icon.
    const logo = await upload('logo', png(100, 100))
    expect((await t.call('PUT', '/admin/v1/branding', { logoId: null, appIconId: logo.body.id }, admin)).status).toBe(400)
  })

  it('a mini app icon reaches the apps and survives logo changes; null goes back to the built-in one', async () => {
    const icon = await upload('app_icon', png(1024, 1024))
    const set = await t.call('PUT', '/admin/v1/branding/mini-apps/ecosure', { assetId: icon.body.id }, admin)
    expect(set.status).toBe(200)
    expect(set.body.miniAppIcons.ecosure).toMatchObject({ id: icon.body.id, width: 1024 })
    expect((await t.call('GET', '/v1/app-config')).body.branding.miniAppIcons).toEqual({ ecosure: icon.body.path })
    // Saving the logo and home-screen icon keeps the mini app icons.
    await t.call('PUT', '/admin/v1/branding', { logoId: null, appIconId: null }, admin)
    expect((await t.call('GET', '/admin/v1/branding', undefined, admin)).body.miniAppIcons.ecosure.id).toBe(icon.body.id)
    // Only app icons (square PNG, 512 px or more), and only known mini apps.
    const logo = await upload('logo', png(100, 100))
    expect((await t.call('PUT', '/admin/v1/branding/mini-apps/ecosure', { assetId: logo.body.id }, admin)).status).toBe(400)
    expect((await t.call('PUT', '/admin/v1/branding/mini-apps/nope', { assetId: icon.body.id }, admin)).status).toBe(400)
    const back = await t.call('PUT', '/admin/v1/branding/mini-apps/ecosure', { assetId: null }, admin)
    expect(back.body.miniAppIcons).toEqual({})
    expect((await t.call('GET', '/v1/app-config')).body.branding.miniAppIcons).toEqual({})
  })

  it('refuses files that are not what they claim', async () => {
    expect((await upload('logo', Buffer.from('hello world, not a picture').toString('base64'))).status).toBe(400)
    expect((await upload('logo', png(100, 100), 'image/jpeg')).status).toBe(400)
  })

  it('services can show an uploaded picture', async () => {
    const pic = await upload('service_icon', png(128, 128))
    const services = (await t.call('GET', '/admin/v1/services', undefined, admin)).body
    const { id, ...mpesa } = services.find((s: any) => s.code === 'MPESA')
    const saved = await t.call('PUT', `/admin/v1/services/${id}`, { ...mpesa, image: pic.body.path }, admin)
    expect(saved.body.image).toBe(pic.body.path)
    const logo = await upload('logo', png(100, 100))
    expect((await t.call('PUT', `/admin/v1/services/${id}`, { ...mpesa, image: logo.body.path }, admin)).status).toBe(400)
  })

  it('support staff cannot upload', async () => {
    await t.createSupportAdmin('s@test.local', 'support-pass-1')
    const support = await t.adminLogin('s@test.local', 'support-pass-1')
    expect((await t.call('POST', '/admin/v1/assets', { kind: 'logo', contentType: 'image/png', base64: png(100, 100) }, support)).status).toBe(403)
    expect((await t.call('PUT', '/admin/v1/branding/mini-apps/ecosure', { assetId: null }, support)).status).toBe(403)
  })
})

describe('QR print-outs', () => {
  it('staff print a branded poster for a merchant; the merchant prints their own', async () => {
    const users = (await t.call('GET', '/admin/v1/users?query=Cafe', undefined, admin)).body.items
    const cafe = users.find((u: any) => u.code === '1001')
    const res = await t.server.app.inject({ method: 'GET', url: `/admin/v1/users/${cafe.id}/poster?size=a4`, headers: { authorization: `Bearer ${admin}` } })
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Pay here with EcoCash')
    expect(res.body).toContain('1001')
    expect(res.body).toContain('<svg')
    expect(res.body).toContain('size: 210mm 297mm')

    const merchant = await t.login('+26662888001', 'business')
    const own = await t.server.app.inject({ method: 'GET', url: '/v1/me/poster', headers: { authorization: `Bearer ${merchant.token}` } })
    expect(own.body).toContain('Ha Abia Cafe')
    const agent = await t.login('+26662777001', 'business')
    const agentPoster = await t.server.app.inject({ method: 'GET', url: '/v1/me/poster?size=a6', headers: { authorization: `Bearer ${agent.token}` } })
    expect(agentPoster.body).toContain('Cash out here')
    const customer = await t.login('+26662000021')
    expect((await t.call('GET', '/v1/me/poster', undefined, customer.token)).status).toBe(400)
  })
})
