import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

// Blocking: a customer blocks another customer. One to one, nothing gets through either way (messages, money,
// requests, friend requests); groups are unaffected; the blocked person isn't told; unblocking restores it all.

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let chatId: string

const text = (token: string, words: string, chat = chatId) => t.call('POST', `/v1/chats/${chat}/messages`, { clientId: crypto.randomUUID(), text: words }, token)
const send = (token: string, toUserId: string, amount = 5) =>
  t.call('POST', '/v1/payments/send', { chatId, toUserId, amount, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, token)
const chatOf = async (token: string) => (await t.call('GET', '/v1/chats', undefined, token)).body.find((c: any) => c.id === chatId)

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  chatId = (await t.call('POST', '/v1/chats', { msisdn: N.thabo }, lerato.token)).body.id
})
afterAll(() => t.close())

describe('blocking people', () => {
  it('blocks a customer; only the blocker sees it', async () => {
    const r = await t.call('POST', '/v1/blocks', { userId: thabo.user.id }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body).toEqual([{ user: expect.objectContaining({ id: thabo.user.id }), since: expect.any(String) }])
    expect((await chatOf(lerato.token)).blockedByMe).toBe(true)
    expect((await chatOf(thabo.token)).blockedByMe).toBeUndefined()
  })

  it('the blocked person cannot message, send money or request; not told why', async () => {
    const before = await balanceOf(t, lerato.token)
    const msg = await text(thabo.token, 'hello?')
    expect(msg.status).toBe(403)
    expect(msg.body.error).toMatchObject({ code: 'BLOCKED' })
    expect(msg.body.error.message).not.toMatch(/block/i)
    const money = await send(thabo.token, lerato.user.id)
    expect(money.body.error.code).toBe('BLOCKED')
    expect(await balanceOf(t, lerato.token)).toBe(before)
    const req = await t.call('POST', '/v1/requests', { chatId, kind: 'money', amount: 10, clientId: crypto.randomUUID() }, thabo.token)
    expect(req.body.error.code).toBe('BLOCKED')
    const friend = await t.call('POST', '/v1/friends/requests', { msisdn: N.lerato }, thabo.token)
    expect(friend.body.error.code).toBe('BLOCKED')
    const many = await t.call('POST', '/v1/payments/send-many', { pin: '1234', clientId: crypto.randomUUID(), recipients: [{ to: N.lerato, amount: 1 }] }, thabo.token)
    expect(many.body.payments[0]).toMatchObject({ ok: false })
    expect(await balanceOf(t, lerato.token)).toBe(before)
  })

  it('the blocker cannot reach them either until unblocking', async () => {
    const msg = await text(lerato.token, 'still there?')
    expect(msg.body.error).toMatchObject({ code: 'BLOCKED', message: expect.stringContaining('Unblock') })
  })

  it('QR codes respect it: the profile QR shows the block, the receive QR refuses before amount or PIN', async () => {
    const mine = await t.call('GET', `/v1/users/${thabo.user.id}/relation`, undefined, lerato.token)
    expect(mine.body).toMatchObject({ blockedByMe: true })
    const theirs = await t.call('GET', `/v1/users/${lerato.user.id}/relation`, undefined, thabo.token)
    expect(theirs.body.blockedByMe).toBeUndefined()

    const before = await balanceOf(t, lerato.token)
    const scan = await t.call('GET', `/v1/payees/${lerato.user.id}`, undefined, thabo.token)
    expect(scan.body.error.code).toBe('BLOCKED')
    // Their chat exists already, so this must be stopped before money moves, not by the chat.
    const pay = await t.call('POST', '/v1/payments/person', { toUserId: lerato.user.id, amount: 5, pin: '1234', clientId: crypto.randomUUID() }, thabo.token)
    expect(pay.body.error.code).toBe('BLOCKED')
    expect(await balanceOf(t, lerato.token)).toBe(before)
  })

  it('groups they share are unaffected', async () => {
    const group = await t.call('POST', '/v1/chats', { title: 'Book club', memberMsisdns: [N.thabo] }, lerato.token)
    expect(group.status).toBeLessThan(300)
    expect((await text(thabo.token, 'hi all', group.body.id)).status).toBe(200)
  })

  it('merchants cannot be blocked, and business accounts cannot block', async () => {
    const cafe = await t.login(N.cafe, 'business')
    expect((await t.call('POST', '/v1/blocks', { userId: cafe.user.id }, lerato.token)).status).toBe(400)
    expect((await t.call('POST', '/v1/blocks', { userId: lerato.user.id }, cafe.token)).status).toBe(403)
  })

  it('unblocking restores everything', async () => {
    const r = await t.call('DELETE', `/v1/blocks/${thabo.user.id}`, undefined, lerato.token)
    expect(r.body).toEqual([])
    expect((await text(thabo.token, 'hello again')).status).toBe(200)
    expect((await send(thabo.token, lerato.user.id)).status).toBe(200)
    expect((await chatOf(lerato.token)).blockedByMe).toBeUndefined()
    expect((await t.call('GET', `/v1/payees/${lerato.user.id}`, undefined, thabo.token)).status).toBe(200)
  })
})
