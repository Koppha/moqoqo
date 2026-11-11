import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chatByTitle, N, sleep, startTestServer, WsClient, type TestServer } from './helpers'

let t: TestServer
let base: string
const sockets: WsClient[] = []
const users: Record<string, { token: string; user: any; ws: WsClient }> = {}

async function connect(token: string) {
  const ws = new WsClient(`${base}/v1/ws?token=${encodeURIComponent(token)}`)
  sockets.push(ws)
  return ws
}

beforeAll(async () => {
  t = await startTestServer()
  const address = await t.server.app.listen({ port: 0, host: '127.0.0.1' })
  base = address.replace('http', 'ws')
  for (const [key, msisdn] of Object.entries({ lerato: N.lerato, mme: N.mme, thabo: N.thabo, palesa: N.palesa })) {
    const s = await t.login(msisdn)
    const ws = await connect(s.token)
    await ws.waitFor('hello', (e) => e.userId === s.user.id)
    users[key] = { ...s, ws }
  }
})
afterAll(async () => {
  for (const s of sockets) s.close()
  await t.close()
})

const clear = () => Object.values(users).forEach((u) => (u.ws.events = []))

describe('websocket', () => {
  it('answers ping with pong and ignores unknown messages', async () => {
    users.lerato.ws.send({ type: 'subscribe', what: 'everything' })
    users.lerato.ws.send({ type: 'ping' })
    await users.lerato.ws.waitFor('pong')
  })

  it('refuses bad tokens', async () => {
    const ws = await connect('not-a-token')
    expect(await ws.waitClose()).toBe(4401)
  })

  it('delivers message.created to chat members only', async () => {
    clear()
    const chat = await chatByTitle(t, users.lerato.token, 'Mme')
    const r = await t.call('POST', `/v1/chats/${chat.id}/messages`, { clientId: 'rt1', text: 'Ke a tla' }, users.lerato.token)
    const forMme = await users.mme.ws.waitFor('message.created', (e) => e.message.id === r.body.id)
    expect(forMme.message).toMatchObject({ text: 'Ke a tla', clientId: 'rt1', chatId: chat.id })
    await users.lerato.ws.waitFor('message.created', (e) => e.message.id === r.body.id) // sender's other devices
    await sleep(150)
    expect(users.thabo.ws.events).toHaveLength(0)
    expect(users.palesa.ws.events).toHaveLength(0)
  })

  it('delivers balance events only to wallets that changed', async () => {
    clear()
    const chat = await chatByTitle(t, users.lerato.token, 'Mme')
    await t.call(
      'POST',
      '/v1/payments/send',
      { chatId: chat.id, toUserId: users.mme.user.id, amount: 40, pin: '1234', kind: 'money', clientId: 'rt2' },
      users.lerato.token,
    )
    expect((await users.lerato.ws.waitFor('balance')).balance).toBe(1200.5)
    expect((await users.mme.ws.waitFor('balance')).balance).toBe(690)
    await users.mme.ws.waitFor('message.created', (e) => e.message.kind === 'money')
    await sleep(150)
    expect(users.thabo.ws.events).toHaveLength(0)
    expect(users.palesa.ws.events).toHaveLength(0)
  })

  it('group request payment: message.updated to all members, balance to the payer only (bill goes to the biller)', async () => {
    clear()
    const lelapa = await chatByTitle(t, users.lerato.token, 'Lelapa (Family)')
    await t.call('POST', `/v1/requests/${lelapa.lastMessage.id}/pay`, { pin: '1234', amount: 100 }, users.thabo.token)
    for (const k of ['lerato', 'mme', 'thabo']) {
      const e = await users[k].ws.waitFor('message.updated')
      expect(e.message.request).toMatchObject({ paid: 700, status: 'pending' })
    }
    await users.thabo.ws.waitFor('balance')
    await sleep(150)
    expect(users.mme.ws.events.some((e) => e.type === 'balance')).toBe(false)
    expect(users.lerato.ws.events.some((e) => e.type === 'balance')).toBe(false)
    expect(users.palesa.ws.events).toHaveLength(0)
  })

  it('announces new chats with chat.created', async () => {
    clear()
    await t.call('POST', '/v1/chats', { msisdn: N.palesa }, users.thabo.token)
    const e = await users.palesa.ws.waitFor('chat.created')
    expect(e.chat).toMatchObject({ kind: 'direct', title: 'Thabo' })
  })

  it('broadcasts config to everyone on maintenance changes, and sockets keep working during maintenance', async () => {
    clear()
    const admin = await t.adminLogin()
    const w = await t.call(
      'POST',
      '/admin/v1/maintenance',
      { startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 600_000).toISOString(), message: { en: 'Upgrade', st: 'Ntlafatso' } },
      admin,
    )
    for (const k of Object.keys(users)) {
      const e = await users[k].ws.waitFor('config')
      expect(e.config.maintenance).toMatchObject({ id: w.body.id, active: true })
    }
    users.palesa.ws.send({ type: 'ping' })
    await users.palesa.ws.waitFor('pong')
    clear()
    await t.call('POST', `/admin/v1/maintenance/${w.body.id}/end`, undefined, admin)
    expect((await users.lerato.ws.waitFor('config')).config.maintenance).toBeNull()
  })

  it('the watcher notices a window starting on its own', async () => {
    const admin = await t.adminLogin()
    const w = await t.call(
      'POST',
      '/admin/v1/maintenance',
      { startsAt: new Date(Date.now() + 400).toISOString(), endsAt: new Date(Date.now() + 600_000).toISOString(), message: { en: 'Soon', st: 'Haufinyane' } },
      admin,
    )
    clear()
    await sleep(600)
    await t.server.configWatcher.check()
    const e = await users.mme.ws.waitFor('config', (ev) => ev.config.maintenance?.active === true)
    expect(e.config.maintenance).toMatchObject({ id: w.body.id, active: true })
    await t.call('POST', `/admin/v1/maintenance/${w.body.id}/end`, undefined, admin)
  })

  it('suspension closes the user\'s sockets', async () => {
    const admin = await t.adminLogin()
    await t.call('PATCH', `/admin/v1/users/${users.palesa.user.id}`, { status: 'suspended' }, admin)
    expect(await users.palesa.ws.waitClose()).toBe(4403)
    const again = await connect(users.palesa.token)
    expect(await again.waitClose()).toBe(4403)
  })
})

describe('push over the live connection', () => {
  it('reaches an app in the background, not one on screen', async () => {
    const chatId = (await chatByTitle(t, users.mme.token, 'Lerato Mokhothu')).id
    const send = () => t.call('POST', `/v1/chats/${chatId}/messages`, { clientId: crypto.randomUUID(), text: 'Are you there?' }, users.mme.token)

    // On screen: the chat updates live, no system notification.
    clear()
    await send()
    await users.lerato.ws.waitFor('message.created')
    await t.server.ctx.notifier.idle()
    expect(users.lerato.ws.events.some((e: any) => e.type === 'notification')).toBe(false)

    // In the background: a notification event the app shows as a system notification.
    users.lerato.ws.send({ type: 'state', active: false })
    await users.lerato.ws.send({ type: 'ping' })
    await users.lerato.ws.waitFor('pong')
    clear()
    await send()
    const n = await users.lerato.ws.waitFor('notification')
    expect(n).toMatchObject({ title: 'Mme', body: 'Are you there?', data: { chatId } })
    await t.server.ctx.notifier.idle()
    const [row] = await t.server.db.query<{ recipient: string; status: string }>(
      `SELECT recipient, status FROM notifications WHERE user_id = $1 AND channel = 'push' ORDER BY created_at DESC LIMIT 1`,
      [users.lerato.user.id],
    )
    expect(row).toEqual({ recipient: 'app (live connection)', status: 'sent' })
    users.lerato.ws.send({ type: 'state', active: true })
  })
})
