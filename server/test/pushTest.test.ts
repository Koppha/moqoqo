import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
})
afterAll(() => t.close())

describe('Me › Notifications › Send a test', () => {
  it('says plainly when push is not switched on for this server', async () => {
    const r = await t.call('POST', '/v1/devices/test', {}, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'off', error: null })
    expect((await t.call('POST', '/v1/devices/test', {})).status).toBe(401)
  })
})
