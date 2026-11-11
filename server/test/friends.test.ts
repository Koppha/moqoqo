import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let mme: { token: string; user: any }
let palesa: { token: string; user: any }
let admin: string

const overview = async (token: string) => (await t.call('GET', '/v1/friends', undefined, token)).body

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  mme = await t.login(N.mme)
  palesa = await t.login(N.palesa)
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('friends', () => {
  it('a request by number waits for the other person to accept', async () => {
    const r = await t.call('POST', '/v1/friends/requests', { msisdn: '62555010' }, lerato.token)
    expect(r.status).toBe(201)
    expect((await t.call('POST', '/v1/friends/requests', { msisdn: N.thabo }, lerato.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', '/v1/friends/requests', { msisdn: N.lerato }, lerato.token)).status).toBe(400)
    const theirs = await overview(thabo.token)
    expect(theirs.incoming).toHaveLength(1)
    expect(theirs.incoming[0].from.msisdn).toBe(N.lerato)
    expect((await t.call('POST', `/v1/friends/requests/${theirs.incoming[0].id}/accept`, {}, thabo.token)).status).toBe(204)
    expect((await overview(lerato.token)).friends.map((f: any) => f.msisdn)).toContain(N.thabo)
    expect((await overview(thabo.token)).friends.map((f: any) => f.msisdn)).toContain(N.lerato)
  })

  it('asking someone who already asked you makes you friends at once; declining and cancelling work', async () => {
    await t.call('POST', '/v1/friends/requests', { msisdn: N.lerato }, mme.token)
    expect((await t.call('POST', '/v1/friends/requests', { userId: mme.user.id }, lerato.token)).body).toEqual({ accepted: true })
    expect((await t.call('GET', `/v1/users/${mme.user.id}/relation`, undefined, lerato.token)).body.relation).toBe('friend')

    const r = (await t.call('POST', '/v1/friends/requests', { msisdn: N.palesa }, mme.token)).body
    expect((await t.call('GET', `/v1/users/${palesa.user.id}/relation`, undefined, mme.token)).body.relation).toBe('outgoing')
    expect((await t.call('DELETE', `/v1/friends/requests/${r.id}`, undefined, mme.token)).status).toBe(204)
    const again = (await t.call('POST', '/v1/friends/requests', { msisdn: N.palesa }, mme.token)).body
    expect((await t.call('POST', `/v1/friends/requests/${again.id}/decline`, {}, palesa.token)).status).toBe(204)
    expect((await overview(palesa.token)).incoming).toHaveLength(0)

    expect((await t.call('DELETE', `/v1/friends/${mme.user.id}`, undefined, lerato.token)).status).toBe(204)
    expect((await t.call('GET', `/v1/users/${mme.user.id}/relation`, undefined, lerato.token)).body.relation).toBe('none')
  })

  it('finds which phone contacts use EcoCash', async () => {
    const m = (await t.call('POST', '/v1/contacts/match', { msisdns: ['6255 5010', '+26662103401', '59990000', 'not a number'] }, lerato.token)).body
    expect(m.map((x: any) => [x.msisdn, x.relation]).sort()).toEqual([[N.mme, 'none'], [N.thabo, 'friend']])
  })

  it('an SMS invite becomes a friend request when the number first signs in', async () => {
    const newcomer = '+26662444111'
    expect((await t.call('POST', '/v1/invites', { msisdn: N.thabo }, lerato.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', '/v1/invites', { msisdn: newcomer }, lerato.token)).status).toBe(201)
    expect((await t.call('POST', '/v1/invites', { msisdn: newcomer }, lerato.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', '/admin/v1/users', { msisdn: newcomer, name: 'Nthabiseng', role: 'customer', pin: '5836' }, admin)).status).toBe(201)
    const nth = await t.login(newcomer, 'customer', '5836')
    const theirs = await overview(nth.token)
    expect(theirs.incoming.map((r: any) => r.from.msisdn)).toEqual([N.lerato])
  })
})

describe('message requests', () => {
  it('with friends-only messages, a stranger’s chat waits as a request until accepted', async () => {
    expect((await t.call('PUT', '/v1/me/privacy', { messagePolicy: 'friends' }, palesa.token)).body.messagePolicy).toBe('friends')
    const chat = (await t.call('POST', '/v1/chats', { msisdn: N.palesa }, thabo.token)).body
    await t.call('POST', `/v1/chats/${chat.id}/messages`, { kind: 'text', text: 'Lumela', clientId: 'mr-1' }, thabo.token)
    const mine = (await t.call('GET', '/v1/chats', undefined, palesa.token)).body.find((c: any) => c.id === chat.id)
    expect(mine.request).toBe(true)
    expect((await overview(palesa.token)).messageRequests).toBe(1)
    expect((await t.call('POST', `/v1/chats/${chat.id}/accept-request`, {}, palesa.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/chats', undefined, palesa.token)).body.find((c: any) => c.id === chat.id).request).toBeUndefined()
  })

  it('a declined request disappears from the list', async () => {
    const chat = (await t.call('POST', '/v1/chats', { msisdn: N.palesa }, lerato.token)).body
    expect((await t.call('POST', `/v1/chats/${chat.id}/decline-request`, {}, palesa.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/chats', undefined, palesa.token)).body.find((c: any) => c.id === chat.id)).toBeUndefined()
  })
})

describe('groups', () => {
  it('invites friends, who join when they accept; strangers cannot be invited', async () => {
    expect((await t.call('POST', '/v1/groups', { title: 'Weekend', memberIds: [palesa.user.id] }, lerato.token)).status).toBe(403)
    const g = await t.call('POST', '/v1/groups', { title: 'Weekend', memberIds: [thabo.user.id] }, lerato.token)
    expect(g.status).toBe(201)
    expect(g.body.members).toHaveLength(1)
    const inv = (await overview(thabo.token)).groupInvites
    expect(inv).toHaveLength(1)
    expect(inv[0]).toMatchObject({ title: 'Weekend', chatId: g.body.id })
    expect((await t.call('POST', `/v1/group-invites/${inv[0].id}/accept`, {}, thabo.token)).body.chatId).toBe(g.body.id)
    const chats = (await t.call('GET', '/v1/chats', undefined, thabo.token)).body
    expect(chats.find((c: any) => c.id === g.body.id).members).toHaveLength(2)
  })
})
