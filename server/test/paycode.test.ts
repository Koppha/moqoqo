import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, N, startTestServer, WsClient, type TestServer } from './helpers'

let t: TestServer
let cafe: { token: string; user: any }
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  cafe = await t.login(N.cafe, 'business')
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
})
afterAll(() => t.close())

const createIntent = (amount: number) => t.call('POST', '/v1/merchant/intents', { amount }, cafe.token)
const issue = async (token = lerato.token) => (await t.call('POST', '/v1/paycode', undefined, token)).body.code as string
const scan = (intentId: string, code: string, pin?: string) =>
  t.call('POST', `/v1/merchant/intents/${intentId}/paycode`, { code, pin }, cafe.token)

describe('Quick Pay', () => {
  it('is off until enabled with the PIN; then issues 18-digit one-time codes', async () => {
    expect((await t.call('GET', '/v1/me', undefined, lerato.token)).body.quickPay).toBeUndefined()
    expect((await t.call('POST', '/v1/paycode', undefined, lerato.token)).body.error.code).toBe('FORBIDDEN')
    expect((await t.call('POST', '/v1/paycode/enable', { pin: '0000' }, lerato.token)).body.error.code).toBe('WRONG_PIN')
    const on = await t.call('POST', '/v1/paycode/enable', { pin: '1234' }, lerato.token)
    expect(on.body.quickPay).toBe(true)

    const r = await t.call('POST', '/v1/paycode', undefined, lerato.token)
    expect(r.body.code).toMatch(/^62\d{16}$/)
    expect(Date.parse(r.body.expiresAt) - Date.now()).toBeGreaterThan(100_000)
    expect(await issue()).not.toBe(r.body.code)
    // Only the hash is stored.
    const [{ n }] = await t.server.db.query<{ n: number }>('SELECT count(*) AS n FROM pay_codes WHERE code_hash = $1', [r.body.code])
    expect(n).toBe(0)
  })

  it('merchant scans the code: the owner pays, the code is spent, both get intent.updated', async () => {
    const base = (await t.server.app.listen({ port: 0, host: '127.0.0.1' })).replace('http', 'ws')
    const ws = new WsClient(`${base}/v1/ws?token=${lerato.token}`)
    await ws.waitFor('hello')
    try {
      const before = await balanceOf(t, lerato.token)
      const code = await issue()
      const c = await createIntent(42)
      const paid = await scan(c.body.id, code)
      expect(paid.status).toBe(200)
      expect(paid.body).toMatchObject({ status: 'paid', method: 'paycode', paidBy: { id: lerato.user.id }, transaction: { kind: 'qr', amount: 42 } })
      expect(await balanceOf(t, lerato.token)).toBe(before - 42)
      expect((await chatByTitle(t, lerato.token, 'Ha Abia Cafe')).lastMessage).toMatchObject({ kind: 'receipt', amount: 42, note: 'Payment code · Ha Abia Cafe' })
      expect((await ws.waitFor('intent.updated', (e) => e.intent.id === c.body.id)).intent.method).toBe('paycode')

      // Single use.
      const again = await createIntent(1)
      expect((await scan(again.body.id, code)).body.error.code).toBe('NOT_FOUND')
    } finally {
      ws.close()
    }
  })

  it('two terminals scanning the same code: exactly one wins', async () => {
    const code = await issue()
    const [a, b] = await Promise.all([createIntent(3), createIntent(4)])
    const res = await Promise.all([scan(a.body.id, code), scan(b.body.id, code)])
    expect(res.map((r) => r.status).sort()).toEqual([200, 404])
    // The losing intent stays open for another payment.
    const loser = res[0].status === 404 ? a : b
    expect((await t.call('GET', `/v1/merchant/intents/${loser.body.id}`, undefined, cafe.token)).body.status).toBe('open')
  })

  it('rejects expired, malformed and unknown codes; PIN needed above the limit', async () => {
    const c = await createIntent(10)
    const old = await issue()
    await t.server.db.query(`UPDATE pay_codes SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [lerato.user.id])
    expect((await scan(c.body.id, old)).body.error.code).toBe('NOT_FOUND')
    expect((await scan(c.body.id, '62123')).body.error.code).toBe('VALIDATION')
    expect((await scan(c.body.id, '621234567890123456')).body.error.code).toBe('NOT_FOUND')

    const big = await createIntent(250)
    const code = await issue()
    expect((await scan(big.body.id, code)).body.error.code).toBe('VALIDATION')
    expect((await scan(big.body.id, code, '0000')).body.error.code).toBe('WRONG_PIN')
    expect((await scan(big.body.id, code, '1234')).body.status).toBe('paid')
  })

  it('turning Quick Pay off voids unused codes', async () => {
    const code = await issue()
    expect((await t.call('POST', '/v1/paycode/disable', undefined, lerato.token)).body.quickPay).toBeUndefined()
    const c = await createIntent(5)
    expect((await scan(c.body.id, code)).body.error.code).toBe('NOT_FOUND')
    expect((await t.call('POST', '/v1/paycode', undefined, lerato.token)).body.error.code).toBe('FORBIDDEN')
    // Customers cannot redeem codes.
    expect((await t.call('POST', `/v1/merchant/intents/${c.body.id}/paycode`, { code }, thabo.token)).body.error.code).toBe('FORBIDDEN')
  })
})

describe('receive QR (pay a person)', () => {
  it('looks up the payee with a masked number and pays with PIN into the direct chat', async () => {
    const p = await t.call('GET', `/v1/payees/${lerato.user.id}`, undefined, thabo.token)
    expect(p.body).toEqual({ id: lerato.user.id, name: lerato.user.name, maskedMsisdn: '+266 62•• ••21' })
    expect((await t.call('GET', '/v1/payees/nope', undefined, thabo.token)).body.error.code).toBe('NOT_FOUND')

    const before = await balanceOf(t, lerato.token)
    const body = { toUserId: lerato.user.id, amount: 25, pin: '1234', clientId: 'rq-1', note: 'Lunch' }
    const r = await t.call('POST', '/v1/payments/person', body, thabo.token)
    expect(r.status).toBe(200)
    expect(r.body.transaction).toMatchObject({ kind: 'send', amount: -25 })
    expect(r.body.message).toMatchObject({ kind: 'money', amount: 25, note: 'Lunch' })
    expect(await balanceOf(t, lerato.token)).toBe(before + 25)
    // A retry with the same clientId does not pay twice.
    expect((await t.call('POST', '/v1/payments/person', body, thabo.token)).body.error.code).toBe('CONFLICT')
    expect(await balanceOf(t, lerato.token)).toBe(before + 25)

    expect((await t.call('POST', '/v1/payments/person', { ...body, clientId: 'rq-2', toUserId: thabo.user.id }, thabo.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/v1/payments/person', { ...body, clientId: 'rq-3', pin: '0000' }, thabo.token)).body.error.code).toBe('WRONG_PIN')
  })
})
