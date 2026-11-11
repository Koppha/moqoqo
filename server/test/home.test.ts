import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MockSms } from '../src/notify/gateways'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
const sms = new MockSms()
let admin: string
let lerato: { token: string; user: any }
let palesa: { token: string; user: any }
const offer = (over: Record<string, unknown> = {}) => ({
  title: { en: 'Free LEC Friday', st: '' }, body: { en: '5% back on tokens', st: '' }, cta: { en: 'Buy now', st: '' }, color: '#F59E0B',
  target: 'lec', placement: 'both', audience: 'all', startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: null, sort: 5, enabled: true, ...over,
})

beforeAll(async () => {
  t = await startTestServer({ sms })
  admin = await t.adminLogin()
  lerato = await t.login(N.lerato)
  palesa = await t.login(N.palesa)
})
afterAll(() => t.close())

describe('home and offers', () => {
  it('starts with the EcoSure funeral and short-term banners', async () => {
    const home = (await t.call('GET', '/v1/home', undefined, lerato.token)).body
    expect(home.offers.map((o: any) => o.target)).toEqual(['ecosure_funeral', 'ecosure_short_term'])
    expect(home.layout.sections.map((s: any) => s.key)).toEqual(['offers', 'services', 'requests', 'transactions'])
  })

  it('staff add offers for an audience and a time window', async () => {
    const all = await t.call('POST', '/admin/v1/offers', offer(), admin)
    expect(all.status).toBe(201)
    await t.call('POST', '/admin/v1/offers', offer({ title: { en: 'Upgrade your wallet', st: '' }, target: 'kyc', audience: 'tier1', placement: 'home', sort: 1 }), admin)
    await t.call('POST', '/admin/v1/offers', offer({ title: { en: 'Later', st: '' }, startsAt: new Date(Date.now() + 86_400_000).toISOString() }), admin)
    const forLerato = (await t.call('GET', '/v1/home', undefined, lerato.token)).body.offers.map((o: any) => o.title.en)
    const forPalesa = (await t.call('GET', '/v1/home', undefined, palesa.token)).body.offers.map((o: any) => o.title.en)
    expect(forLerato).toEqual(['Free LEC Friday', 'EcoSure funeral cover', 'Insure your car, phone and home'])
    expect(forPalesa[0]).toBe('Upgrade your wallet')
    expect(forLerato).not.toContain('Later')
    const news = (await t.call('GET', '/v1/news', undefined, palesa.token)).body.map((o: any) => o.title.en)
    expect(news).not.toContain('Upgrade your wallet') // home only
    expect((await t.call('POST', '/admin/v1/offers', offer({ target: 'url:http://insecure' }), admin)).status).toBe(400)
  })

  it('staff reorder and hide Home sections', async () => {
    const r = await t.call('PUT', '/admin/v1/home-layout', { sections: [{ key: 'transactions', visible: true }, { key: 'offers', visible: false }] }, admin)
    expect(r.body.sections).toEqual([
      { key: 'transactions', visible: true }, { key: 'offers', visible: false }, { key: 'services', visible: true }, { key: 'requests', visible: true },
    ])
  })

  it('in-app message to an audience lands in their EcoCash Super App chat', async () => {
    const r = await t.call('POST', '/admin/v1/broadcasts', { text: { en: 'System upgrade on Sunday 02:00', st: 'Ntlafatso ka Sontaha' }, audience: 'tier1', sms: true }, admin)
    expect(r.status).toBe(201)
    expect(r.body.recipients).toBeGreaterThan(0)
    const inbox = await chatByTitle(t, palesa.token, 'EcoCash Super App')
    expect(inbox.lastMessage.text).toContain('System upgrade on Sunday')
    expect(inbox.lastMessage.text).toContain('Ntlafatso')
    const lerChats = (await t.call('GET', '/v1/chats', undefined, lerato.token)).body
    expect(lerChats.some((c: any) => c.title === 'EcoCash Super App' && c.lastMessage?.text?.includes('System upgrade'))).toBe(false) // tier 2
    expect((await t.call('GET', '/admin/v1/broadcasts', undefined, admin)).body[0].audience).toBe('tier1')
  })
})
