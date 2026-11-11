import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, png, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
})
afterAll(() => t.close())

/** Status of a picture URL (a picture, not JSON). */
const fetchStatus = async (path: string) => (await t.server.app.inject({ method: 'GET', url: path })).statusCode

describe('profile pictures', () => {
  it('a person sets a photo; others see it on them; a new one replaces it; they can remove it', async () => {
    const set = await t.call('PUT', '/v1/me/photo', { contentType: 'image/png', base64: png(200, 200) }, lerato.token)
    expect(set.status).toBe(200)
    expect(set.body.photo).toMatch(/^\/v1\/assets\/[\w-]+$/)
    expect(await fetchStatus(set.body.photo)).toBe(200)

    // Thabo sees her photo on the chat with her.
    const chat = (await t.call('POST', '/v1/chats', { msisdn: N.lerato }, thabo.token)).body
    expect(chat.members.find((u: any) => u.id === lerato.user.id).photo).toBe(set.body.photo)

    const again = await t.call('PUT', '/v1/me/photo', { contentType: 'image/png', base64: png(300, 300) }, lerato.token)
    expect(again.body.photo).not.toBe(set.body.photo)
    expect(await fetchStatus(set.body.photo)).toBe(404) // the old one is gone

    const removed = await t.call('DELETE', '/v1/me/photo', undefined, lerato.token)
    expect(removed.body.photo).toBeUndefined()
    expect(await fetchStatus(again.body.photo)).toBe(404)
  })

  it('only real pictures, not tiny ones', async () => {
    expect((await t.call('PUT', '/v1/me/photo', { contentType: 'image/png', base64: Buffer.from('not a picture').toString('base64') }, thabo.token)).status).toBe(400)
    expect((await t.call('PUT', '/v1/me/photo', { contentType: 'image/png', base64: png(20, 20) }, thabo.token)).status).toBe(400)
    expect((await t.call('PUT', '/v1/me/photo', { contentType: 'image/png', base64: png(200, 200) })).status).toBe(401)
  })
})
