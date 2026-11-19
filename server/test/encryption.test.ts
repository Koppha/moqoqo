import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureVault, keyIdOf, openBytes, openJson, openText, sealBytes, sealJson, sealText } from '../src/lib/vault'
import { N, startTestServer, type TestServer } from './helpers'

// Encryption at rest with rotating keys (DFS guidelines 3.2.6g–i), session token rotation, https only.
const k1 = `k1:${randomBytes(32).toString('base64')}`
const k2 = `k2:${randomBytes(32).toString('base64')}`
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAZklEQVR4nO3PQQ0AIAzAQIv/rSQLzKR8B2Qk1a8m7j5zrX0BEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhIS3gGdGQGgmFXPKAAAAABJRU5ErkJggg=='

describe('the vault', () => {
  it('seals text, bytes and JSON with the current key and opens them again', () => {
    configureVault(k1)
    const t = sealText('card-token-123')
    expect(t).toMatch(/^enc:v1:k1:/)
    expect(openText(t)).toBe('card-token-123')
    const b = sealBytes(Buffer.from('a photo'))
    expect(keyIdOf(b)).toBe('k1')
    expect(openBytes(b).toString()).toBe('a photo')
    expect(openJson(sealJson([{ label: 'ID', value: '9511300004' }]))).toEqual([{ label: 'ID', value: '9511300004' }])
  })

  it('rotates: a new first key seals new data, the old key still opens old data', () => {
    configureVault(k1)
    const old = sealText('secret')
    configureVault(`${k2},${k1}`)
    expect(openText(old)).toBe('secret')
    expect(keyIdOf(sealText('x'))).toBe('k2')
    configureVault(k2) // old key removed too early: the value can't be read, and that is loud
    expect(() => openText(old)).toThrow(/k1/)
  })

  it('without keys stores values as they are, and reads plain old values', () => {
    configureVault(null)
    expect(sealText('plain')).toBe('plain')
    expect(openText('plain')).toBe('plain')
    expect(() => configureVault('bad')).toThrow(/DATA_KEYS/)
    configureVault(null)
  })
})

describe('a server with DATA_KEYS', () => {
  let t: TestServer
  beforeAll(async () => { t = await startTestServer({}, { dataKeys: k1 }) })
  afterAll(async () => { await t.close(); configureVault(null) })

  it('stores uploads and request details sealed, and serves them back readable', async () => {
    const s = await t.login(N.palesa)
    const up = await t.call('POST', '/v1/ecosure/uploads', { fileName: 'id.png', contentType: 'image/png', base64: PNG }, s.token)
    expect(up.status).toBe(201)
    const [row] = await t.server.db.query<{ content: Uint8Array }>('SELECT content FROM ecosure_uploads WHERE id = $1', [up.body.id])
    expect(keyIdOf(row.content)).toBe('k1')
    expect(Buffer.from(row.content).includes(Buffer.from(PNG, 'base64').subarray(0, 8))).toBe(false)
  })
})

describe('sessions and transport', () => {
  let t: TestServer
  beforeAll(async () => { t = await startTestServer() })
  afterAll(() => t.close())

  it('rotates the session token after a day of use; the old one works 5 more minutes', async () => {
    const s = await t.login(N.thabo)
    await t.server.db.query(`UPDATE sessions SET rotated_at = now() - interval '25 hours' WHERE user_id = $1`, [s.user.id])
    const r = await t.server.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${s.token}` } })
    const fresh = r.headers['x-session-token'] as string
    expect(fresh).toBeTruthy()
    expect((await t.call('GET', '/v1/me', undefined, fresh)).status).toBe(200)
    expect((await t.call('GET', '/v1/me', undefined, s.token)).status).toBe(200)
    await t.server.db.query(`UPDATE sessions SET retire_at = now() - interval '1 second' WHERE retire_at IS NOT NULL`)
    expect((await t.call('GET', '/v1/me', undefined, s.token)).status).toBe(401)
    expect((await t.call('GET', '/v1/me', undefined, fresh)).status).toBe(200)
  })

  it('payment fingerprint tokens expire after 90 days', async () => {
    const s = await t.login(N.lerato)
    const on = await t.call('POST', '/v1/me/pay-biometric', { pin: '1234' }, s.token)
    await t.server.db.query(`UPDATE pay_biometric_keys SET created_at = now() - interval '91 days'`)
    expect((await t.call('POST', '/v1/payments/merchant', { merchantCode: '1001', amount: 5, pin: on.body.token }, s.token)).body.error.code).toBe('WRONG_PIN')
    await t.server.db.query('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE msisdn = $1', [N.lerato])
  })

  it('REQUIRE_TLS refuses plain http, and accepts https from the proxy', async () => {
    const s = await startTestServer({}, { requireTls: true })
    expect((await s.call('GET', '/v1/app-config')).status).toBe(403)
    const viaProxy = await s.server.app.inject({ method: 'GET', url: '/v1/app-config', headers: { 'x-forwarded-proto': 'https' } })
    expect(viaProxy.statusCode).toBe(200)
    expect(viaProxy.headers['strict-transport-security']).toContain('max-age')
    await s.close()
  })
})
