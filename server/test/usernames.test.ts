import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let mme: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
})
afterAll(() => t.close())

describe('usernames', () => {
  it('can be chosen once per person, case-insensitively', async () => {
    const r = await t.call('PUT', '/v1/me/username', { username: '@Lerato.M' }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.username).toBe('lerato.m')
    expect((await t.call('PUT', '/v1/me/username', { username: 'LERATO.M' }, mme.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('PUT', '/v1/me/username', { username: '9lives' }, mme.token)).status).toBe(400)
    expect((await t.call('PUT', '/v1/me/username', { username: 'ab' }, mme.token)).status).toBe(400)
  })

  it('sign in with the username instead of the number', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: '@lerato.m', pin: '1234', app: 'customer' })
    expect(r.status).toBe(200)
    expect(r.body.user.msisdn).toBe(N.lerato)
    expect((await t.call('POST', '/v1/auth/login', { msisdn: 'nobody.here', pin: '1234', app: 'customer' })).body.error.code).toBe('NOT_REGISTERED')
  })

  it('find people and start a chat by username', async () => {
    const found = await t.call('GET', '/v1/users/lookup?username=@lerato.m', undefined, mme.token)
    expect(found.body).toMatchObject({ name: 'Lerato Mokhothu', username: 'lerato.m' })
    const chat = await t.call('POST', '/v1/chats', { username: 'lerato.m' }, mme.token)
    expect([200, 201]).toContain(chat.status)
    expect(chat.body.members.some((m: any) => m.username === 'lerato.m')).toBe(true)
  })
})
