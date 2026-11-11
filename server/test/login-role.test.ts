import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
beforeAll(async () => {
  t = await startTestServer()
})
afterAll(() => t.close())

const login = (msisdn: string, role?: string, pin = '1234') => t.call('POST', '/v1/auth/login', { msisdn, pin, app: 'business', role })

describe('business login: Merchant / Agent choice', () => {
  it('signs in when the chosen role matches', async () => {
    expect((await login(N.cafe, 'merchant')).body.user.role).toBe('merchant')
    expect((await login(N.agent, 'agent')).body.user.role).toBe('agent')
    expect((await login(N.agent)).status).toBe(200) // older builds send no role
  })

  it('refuses the other role, but only after the PIN is right', async () => {
    const wrong = await login(N.agent, 'merchant')
    expect(wrong.status).toBe(403)
    expect(wrong.body.error).toMatchObject({ code: 'WRONG_ROLE', message: expect.stringContaining('an agent') })
    expect((await login(N.cafe, 'agent')).body.error.code).toBe('WRONG_ROLE')
    expect((await login(N.agent, 'merchant', '0000')).body.error.code).toBe('WRONG_PIN')
    expect((await login(N.cafe, 'boss')).body.error.code).toBe('VALIDATION')
  })
})
