import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
beforeAll(async () => {
  t = await startTestServer()
})
afterAll(() => t.close())

describe('auth', () => {
  it('logs in with a correct PIN and returns Me', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '1234', app: 'customer' })
    expect(r.status).toBe(200)
    expect(r.body.token).toMatch(/^[\w-]{40,}$/)
    expect(r.body.user).toMatchObject({ msisdn: N.lerato, name: 'Lerato Mokhothu', role: 'customer', balance: 1240.5, kycTier: 2 })
    const me = await t.call('GET', '/v1/me', undefined, r.body.token)
    expect(me.body.id).toBe(r.body.user.id)
  })

  it('accepts local number formats', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: '6200 0021', pin: '1234', app: 'customer' })
    expect(r.status).toBe(200)
  })

  it('rejects unknown numbers, bad input and missing tokens', async () => {
    expect((await t.call('POST', '/v1/auth/login', { msisdn: '+26662999999', pin: '1234', app: 'customer' })).body.error.code).toBe('NOT_REGISTERED')
    const bad = await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: 'abcd', app: 'customer' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION' })
    expect(bad.body.error.message).toMatch(/pin/)
    const anon = await t.call('GET', '/v1/me')
    expect(anon.status).toBe(401)
    expect(anon.body.error.code).toBe('UNAUTHORIZED')
  })

  it('locks the PIN after 5 wrong attempts in a row, and a success resets the counter', async () => {
    const login = (pin: string) => t.call('POST', '/v1/auth/login', { msisdn: N.thabo, pin, app: 'customer' })
    for (let i = 0; i < 4; i++) expect((await login('0000')).body.error.code).toBe('WRONG_PIN')
    expect((await login('1234')).status).toBe(200) // counter resets
    for (let i = 0; i < 4; i++) expect((await login('0000')).body.error.code).toBe('WRONG_PIN')
    const fifth = await login('0000')
    expect(fifth.status).toBe(423)
    expect(fifth.body.error.code).toBe('PIN_LOCKED')
    // Even the right PIN is refused while locked.
    expect((await login('1234')).body.error.code).toBe('PIN_LOCKED')
    // The lock lasts 15 minutes; simulate its expiry.
    const [row] = await t.server.db.query<{ mins: number }>(
      `SELECT round(extract(epoch FROM locked_until - now()) / 60) AS mins FROM users WHERE msisdn = $1`,
      [N.thabo],
    )
    expect(Number(row.mins)).toBe(15)
    await t.server.db.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE msisdn = $1`, [N.thabo])
    expect((await login('1234')).status).toBe(200)
  })

  it('PIN lockout also applies to verify-pin (and therefore payments)', async () => {
    const { token } = await t.login(N.palesa)
    for (let i = 0; i < 4; i++) expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '9999' }, token)).body.error.code).toBe('WRONG_PIN')
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '9999' }, token)).body.error.code).toBe('PIN_LOCKED')
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '1234' }, token)).body.error.code).toBe('PIN_LOCKED')
    await t.server.db.query(`UPDATE users SET locked_until = NULL WHERE msisdn = $1`, [N.palesa])
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '1234' }, token)).status).toBe(204)
  })

  it('business app requires an agent or merchant (WRONG_APP)', async () => {
    const r = await t.call('POST', '/v1/auth/login', { msisdn: N.lerato, pin: '1234', app: 'business' })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('WRONG_APP')
    const agent = await t.call('POST', '/v1/auth/login', { msisdn: N.agent, pin: '1234', app: 'business' })
    expect(agent.status).toBe(200)
    expect(agent.body.user).toMatchObject({ role: 'agent', code: 'AGENT-0101', balance: 20000 })
    const merchant = await t.call('POST', '/v1/auth/login', { msisdn: N.taxi, pin: '1234', app: 'business' })
    expect(merchant.body.user).toMatchObject({ role: 'merchant', code: '1042', businessName: 'Taxi · Ntate Mokoena' })
    // The customer app accepts every role.
    expect((await t.call('POST', '/v1/auth/login', { msisdn: N.agent, pin: '1234', app: 'customer' })).status).toBe(200)
  })

  it('suspended users are refused at login and on every call with an existing session', async () => {
    const { token, user } = await t.login(N.cafe)
    const admin = await t.adminLogin()
    expect((await t.call('PATCH', `/admin/v1/users/${user.id}`, { status: 'suspended' }, admin)).status).toBe(200)
    const call = await t.call('GET', '/v1/chats', undefined, token)
    expect(call.status).toBe(403)
    expect(call.body.error.code).toBe('SUSPENDED')
    expect((await t.call('POST', '/v1/auth/login', { msisdn: N.cafe, pin: '1234', app: 'business' })).body.error.code).toBe('SUSPENDED')
    await t.call('PATCH', `/admin/v1/users/${user.id}`, { status: 'active' }, admin)
    expect((await t.call('GET', '/v1/me', undefined, token)).status).toBe(200)
  })

  it('logout revokes the token', async () => {
    const { token } = await t.login(N.mme)
    expect((await t.call('POST', '/v1/auth/logout', undefined, token)).status).toBe(204)
    expect((await t.call('GET', '/v1/me', undefined, token)).body.error.code).toBe('UNAUTHORIZED')
  })

  it('looks up wallets by number but never system accounts', async () => {
    const { token } = await t.login(N.lerato)
    const r = await t.call('GET', `/v1/users/lookup?msisdn=${encodeURIComponent(N.taxi)}`, undefined, token)
    expect(r.body).toMatchObject({ name: 'Ntate Mokoena', role: 'merchant', businessName: 'Taxi · Ntate Mokoena' })
    expect(r.body.balance).toBeUndefined()
    expect((await t.call('GET', '/v1/users/lookup?msisdn=%2B26662000000', undefined, token)).body.error.code).toBe('NOT_REGISTERED')
  })

  it('registers push devices', async () => {
    const { token } = await t.login(N.lerato)
    const r = await t.call('POST', '/v1/devices', { expoPushToken: 'ExponentPushToken[abcdefghijk]', platform: 'android', app: 'customer' }, token)
    expect(r.status).toBe(204)
    expect(await t.server.db.query('SELECT * FROM devices')).toHaveLength(1)
  })

  it('unknown routes answer NOT_FOUND in the ApiError shape', async () => {
    const r = await t.call('GET', '/v1/nope')
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('NOT_FOUND')
  })
})
