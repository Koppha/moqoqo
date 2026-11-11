import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockEmail, MockSms } from '../src/notify/gateways'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
const sms = new MockSms()
const email = new MockEmail()
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
let chatId: string
let admin: string

const settle = () => t.server.ctx.notifier.idle()
const smsTo = (msisdn: string) => sms.sent.filter((s) => s.to === msisdn)
const send = async (amount: number, token = lerato.token, toUserId = mme.user.id) => {
  const r = await t.call('POST', '/v1/payments/send', { chatId, toUserId, amount, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, token)
  expect(r.status).toBe(200)
  await settle()
  return r.body
}
const prefs = (body: unknown, token = mme.token) => t.call('PUT', '/v1/me/notifications', body, token)

beforeAll(async () => {
  t = await startTestServer({ sms, email })
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
  chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
  admin = await t.adminLogin()
  await settle()
})
afterAll(() => t.close())
beforeEach(() => {
  sms.sent.length = 0
  email.sent.length = 0
})

describe('notification choices', () => {
  it('starts from the defaults: news off, money SMS on', async () => {
    const r = await t.call('GET', '/v1/me/notifications', undefined, mme.token)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ email: null, emailVerified: false, pushDevice: false })
    expect(r.body.prefs.push).toEqual({ money: true, requests: true, ecosure: true, chats: true, news: false })
    expect(r.body.prefs.sms).toEqual({ money: true, requests: false, ecosure: true, news: false })
    expect(r.body.prefs.email.chats).toBeUndefined()
  })

  it('changes only the switches given; security cannot be switched off', async () => {
    const r = await prefs({ prefs: { sms: { requests: true } } })
    expect(r.body.prefs.sms.requests).toBe(true)
    expect(r.body.prefs.sms.money).toBe(true)
    expect((await prefs({ prefs: { sms: { security: false } } })).status).toBe(400)
    expect((await prefs({ prefs: { sms: { chats: true } } })).status).toBe(400)
    await prefs({ prefs: { sms: { requests: false } } })
  })
})

describe('money in & out', () => {
  it('texts both sides with the reference and new balance', async () => {
    const res = await send(25)
    const mine = smsTo(N.lerato)
    const theirs = smsTo(N.mme)
    expect(mine).toHaveLength(1)
    expect(mine[0].text).toContain('Sent to Mme: -M25.00')
    expect(mine[0].text).toContain(`Ref ${res.transaction.reference}`)
    expect(theirs[0].text).toContain('From Lerato Mokhothu: +M25.00')
    // The receiver's push comes from the chat message (recorded as a mock while push is off).
    const rows = await t.server.db.query<{ channel: string; category: string; status: string }>(
      `SELECT channel, category, status FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [mme.user.id],
    )
    expect(rows).toContainEqual({ channel: 'push', category: 'money', status: 'mock' })
    expect(rows).toContainEqual({ channel: 'sms', category: 'money', status: 'mock' })
  })

  it('respects a switched-off channel', async () => {
    await prefs({ prefs: { sms: { money: false } } })
    await send(5)
    expect(smsTo(N.mme)).toHaveLength(0)
    expect(smsTo(N.lerato)).toHaveLength(1)
    await prefs({ prefs: { sms: { money: true } } })
  })
})

describe('email', () => {
  it('needs a confirmed address before any email goes out', async () => {
    await prefs({ prefs: { email: { money: true } } })
    await send(1)
    expect(email.sent).toHaveLength(0)

    const set = await t.call('POST', '/v1/me/email', { email: 'Mme@Example.com' }, mme.token)
    expect(set.status).toBe(200)
    expect(set.body).toMatchObject({ email: null, emailVerified: false })
    const code = /\b(\d{6})\b/.exec(email.sent[0].text)![1]
    expect(email.sent[0].to).toBe('mme@example.com')

    const wrong = code === '000000' ? '111111' : '000000'
    expect((await t.call('POST', '/v1/me/email/verify', { code: wrong }, mme.token)).status).toBe(400)
    const ok = await t.call('POST', '/v1/me/email/verify', { code }, mme.token)
    expect(ok.body).toMatchObject({ email: 'mme@example.com', emailVerified: true })
    await settle()
    expect(smsTo(N.mme).some((s) => s.text.includes('will now email mme@example.com'))).toBe(true)

    email.sent.length = 0
    await send(2)
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]).toMatchObject({ to: 'mme@example.com', subject: 'Money in' })
  })

  it('removes the address', async () => {
    const r = await t.call('DELETE', '/v1/me/email', undefined, mme.token)
    expect(r.body).toMatchObject({ email: null, emailVerified: false })
  })
})

describe('security alerts', () => {
  it('always go out, whatever the switches say', async () => {
    await prefs({ prefs: { sms: { money: false, requests: false, ecosure: false, news: false }, push: { money: false, requests: false, ecosure: false, chats: false, news: false } } })
    await t.login(N.mme)
    await settle()
    expect(smsTo(N.mme).some((s) => s.text.includes('signed in'))).toBe(true)
  })

  it('tells the owner when their PIN gets locked', async () => {
    const palesa = N.palesa
    for (let i = 0; i < 5; i++) await t.call('POST', '/v1/auth/login', { msisdn: palesa, pin: '9999', app: 'customer' })
    await settle()
    expect(smsTo(palesa).some((s) => s.text.includes('locked'))).toBe(true)
  })
})

describe('assistant welcome', () => {
  it('does not notify anyone', async () => {
    const rows = await t.server.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE title = 'EcoCash Assistant'`)
    expect(rows[0].n).toBe(0)
  })
})

describe('requests', () => {
  it('push by default, SMS only when switched on', async () => {
    await prefs({ prefs: { sms: { requests: true }, push: { requests: true } } }, lerato.token)
    const r = await t.call('POST', '/v1/requests', { chatId, clientId: crypto.randomUUID(), amount: 30, kind: 'money' }, mme.token)
    expect(r.status).toBe(201)
    await settle()
    expect(smsTo(N.lerato).some((s) => s.text.includes('Requests M30.00'))).toBe(true)
  })
})

describe('portal', () => {
  it('lists what was sent and which providers are mocks', async () => {
    const list = await t.call('GET', '/admin/v1/notifications?channel=sms&pageSize=5', undefined, admin)
    expect(list.status).toBe(200)
    expect(list.body.total).toBeGreaterThan(0)
    expect(list.body.items[0]).toMatchObject({ channel: 'sms', status: 'mock' })
    const providers = await t.call('GET', '/admin/v1/notifications/providers', undefined, admin)
    expect(providers.body).toEqual({ push: false, sms: false, email: false, assistant: false })
  })

  it('sends news only to people who opted in', async () => {
    await prefs({ prefs: { sms: { news: true } } }, lerato.token)
    const r = await t.call('POST', '/admin/v1/notifications/news', { title: 'Free LEC Friday', body: 'Buy an LEC token on Friday and get 5% back.' }, admin)
    expect(r.status).toBe(200)
    expect(r.body.recipients).toBe(1)
    await settle()
    expect(sms.sent.filter((s) => s.text.includes('Free LEC') || s.text.includes('5% back')).map((s) => s.to)).toEqual([N.lerato])
  })
})
