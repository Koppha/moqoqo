import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let mme: { token: string; user: any }

const chatIds = async (token: string) => (await t.call('GET', '/v1/chats', undefined, token)).body.map((c: any) => c.id)
const newGroup = async (title: string) =>
  (await t.call('POST', '/v1/chats', { title, memberMsisdns: [N.thabo, N.mme] }, lerato.token)).body

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  mme = await t.login(N.mme)
})
afterAll(() => t.close())

describe('deleting and leaving groups', () => {
  it('the person who made a group deletes it for everyone; nobody else can', async () => {
    const g = await newGroup('Braai')
    expect(g.createdBy).toBe(lerato.user.id)
    expect((await t.call('DELETE', `/v1/chats/${g.id}`, undefined, thabo.token)).body.error.code).toBe('FORBIDDEN')
    expect((await t.call('DELETE', `/v1/chats/${g.id}`, undefined, lerato.token)).status).toBe(204)
    for (const who of [lerato, thabo, mme]) expect(await chatIds(who.token)).not.toContain(g.id)
    expect((await t.call('GET', `/v1/chats/${g.id}/messages`, undefined, thabo.token)).status).toBe(404)
  })

  it('a group with an open split bill cannot be deleted until it is settled or cancelled', async () => {
    const g = await newGroup('Dinner')
    const s = await t.call('POST', '/v1/splits', {
      chatId: g.id, clientId: 'grp-1', pin: '1234', method: 'equal', total: 90,
      participants: [{ userId: lerato.user.id }, { userId: thabo.user.id }, { userId: mme.user.id }],
    }, lerato.token)
    expect(s.status).toBe(201)
    expect((await t.call('DELETE', `/v1/chats/${g.id}`, undefined, lerato.token)).body.error.code).toBe('CONFLICT')
    // Thabo owes a share: he can't leave yet either.
    expect((await t.call('POST', `/v1/chats/${g.id}/leave`, {}, thabo.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', `/v1/splits/${s.body.id}/cancel`, { pin: '1234' }, lerato.token)).status).toBe(200)
    expect((await t.call('DELETE', `/v1/chats/${g.id}`, undefined, lerato.token)).status).toBe(204)
  })

  it('members leave (the others see who left); the one who made it deletes instead', async () => {
    const g = await newGroup('Taxi rank')
    expect((await t.call('POST', `/v1/chats/${g.id}/leave`, {}, lerato.token)).status).toBe(400)
    expect((await t.call('POST', `/v1/chats/${g.id}/leave`, {}, mme.token)).status).toBe(204)
    expect(await chatIds(mme.token)).not.toContain(g.id)
    const msgs = (await t.call('GET', `/v1/chats/${g.id}/messages`, undefined, lerato.token)).body
    expect(msgs.at(-1)).toMatchObject({ kind: 'system', text: 'Mme left the group' })
    const [chat] = (await t.call('GET', '/v1/chats', undefined, lerato.token)).body.filter((c: any) => c.id === g.id)
    expect(chat.members.map((u: any) => u.id)).not.toContain(mme.user.id)
  })

  it('direct chats cannot be deleted or left', async () => {
    const d = (await t.call('POST', '/v1/chats', { msisdn: N.thabo }, lerato.token)).body
    expect((await t.call('DELETE', `/v1/chats/${d.id}`, undefined, lerato.token)).status).toBe(400)
    expect((await t.call('POST', `/v1/chats/${d.id}/leave`, {}, lerato.token)).status).toBe(400)
  })
})
