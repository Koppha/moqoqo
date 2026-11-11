import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createExpoPush } from '../src/notify/expoPush'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

// A fake Expo push service: answers each send with tickets and each receipt request with receipts.
type Call = { url: string; headers: Record<string, string>; body: any }
let calls: Call[] = []
let sendReply: (messages: any[]) => { status: number; json: unknown } = (m) => ({ status: 200, json: { data: m.map((_, i) => ({ status: 'ok', id: `t${i}-${Date.now()}` })) } })
let receiptReply: (ids: string[]) => { status: number; json: unknown } = () => ({ status: 200, json: { data: {} } })
const fakeFetch = (async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body))
  calls.push({ url, headers: init.headers as Record<string, string>, body })
  const r = url.endsWith('/send') ? sendReply(body) : receiptReply(body.ids)
  return new Response(JSON.stringify(r.json), { status: r.status })
}) as unknown as typeof fetch

let t: TestServer
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
const register = (token: string, expoPushToken: string) => t.call('POST', '/v1/devices', { expoPushToken, platform: 'android', app: 'customer' }, token)
const devices = async (userId: string) =>
  (await t.server.db.query<{ expo_push_token: string }>('SELECT expo_push_token FROM devices WHERE user_id = $1 ORDER BY 1', [userId])).map((d) => d.expo_push_token)

beforeAll(async () => {
  t = await startTestServer({ pushFetch: fakeFetch }, { pushEnabled: true, expoAccessToken: 'expo-secret' })
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
})
afterAll(() => t.close())
beforeEach(() => {
  calls = []
})

describe('Expo push', () => {
  it('sends to each phone with the access token, and keeps tickets for their receipts', async () => {
    await register(mme.token, 'ExponentPushToken[mme-phone-1]')
    await register(mme.token, 'ExponentPushToken[mme-phone-2]')
    const chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
    await t.call('POST', '/v1/payments/send', { chatId, toUserId: mme.user.id, amount: 5, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, lerato.token)
    await t.server.ctx.notifier.idle()
    const sent = calls.filter((c) => c.url.endsWith('/send'))
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[0].headers.authorization).toBe('Bearer expo-secret')
    const toMme = sent.flatMap((c) => c.body).filter((m: any) => m.to.includes('mme-phone'))
    expect(toMme.map((m: any) => m.to).sort()).toEqual(['ExponentPushToken[mme-phone-1]', 'ExponentPushToken[mme-phone-2]'])
    expect(toMme[0]).toMatchObject({ channelId: 'default', priority: 'high', sound: 'default' })
    const [{ n }] = await t.server.db.query<{ n: number }>('SELECT count(*)::int AS n FROM push_tickets WHERE user_id = $1', [mme.user.id])
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('forgets a phone Expo says is no longer registered, from the ticket or the receipt', async () => {
    const push = createExpoPush({ db: t.server.db, log: t.server.app.log, accessToken: null, fetch: fakeFetch, sleep: async () => {} })
    await register(lerato.token, 'ExponentPushToken[lerato-old]')
    await register(lerato.token, 'ExponentPushToken[lerato-new]')
    sendReply = (m) => ({
      status: 200,
      json: { data: m.map((x: any) => (x.to.includes('old') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'ticket-new' })) },
    })
    const r = await push.send([{ user_id: lerato.user.id, expo_push_token: 'ExponentPushToken[lerato-old]' }, { user_id: lerato.user.id, expo_push_token: 'ExponentPushToken[lerato-new]' }], { title: 'Hi', body: 'There', data: {} })
    expect(r.get(lerato.user.id)).toEqual({ ok: true })
    expect(await devices(lerato.user.id)).toEqual(['ExponentPushToken[lerato-new]'])

    // 15 minutes later the receipt says the new one is dead too.
    await t.server.db.query(`UPDATE push_tickets SET created_at = now() - interval '20 minutes' WHERE ticket_id = 'ticket-new'`)
    receiptReply = (ids) => ({ status: 200, json: { data: Object.fromEntries(ids.map((id) => [id, id === 'ticket-new' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }])) } })
    const checked = await push.checkReceipts()
    expect(checked.removed).toBe(1)
    expect(await devices(lerato.user.id)).toEqual([])
    expect((await t.server.db.query(`SELECT 1 FROM push_tickets WHERE ticket_id = 'ticket-new'`)).length).toBe(0)
  })

  it('retries when Expo is busy, but not when the request is wrong', async () => {
    const push = createExpoPush({ db: t.server.db, log: t.server.app.log, accessToken: null, fetch: fakeFetch, sleep: async () => {} })
    const device = [{ user_id: mme.user.id, expo_push_token: 'ExponentPushToken[mme-phone-1]' }]
    let n = 0
    sendReply = (m) => (++n < 3 ? { status: 503, json: {} } : { status: 200, json: { data: m.map(() => ({ status: 'ok', id: `retry-${n}` })) } })
    expect((await push.send(device, { title: 'a', body: 'b', data: {} })).get(mme.user.id)).toEqual({ ok: true })
    expect(n).toBe(3)

    n = 0
    sendReply = () => (++n, { status: 400, json: { errors: [{ code: 'VALIDATION_ERROR', message: 'bad message' }] } })
    expect((await push.send(device, { title: 'a', body: 'b', data: {} })).get(mme.user.id)).toEqual({ ok: false, error: 'bad message' })
    expect(n).toBe(1)
  })

  it('a phone signing out stops getting pushes', async () => {
    await register(mme.token, 'ExponentPushToken[mme-phone-3]')
    expect((await t.call('POST', '/v1/devices/unregister', { expoPushToken: 'ExponentPushToken[mme-phone-3]' }, lerato.token)).status).toBe(204)
    expect(await devices(mme.user.id)).toContain('ExponentPushToken[mme-phone-3]') // not Lerato's phone to remove
    await t.call('POST', '/v1/devices/unregister', { expoPushToken: 'ExponentPushToken[mme-phone-3]' }, mme.token)
    expect(await devices(mme.user.id)).not.toContain('ExponentPushToken[mme-phone-3]')
  })
})
