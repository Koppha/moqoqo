import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, N, sleep, startTestServer, WsClient, type TestServer } from './helpers'

const DEMO_TAG = '04A2246A8B6D80'

let t: TestServer
let cafe: { token: string; user: any }
let taxi: { token: string; user: any }
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  cafe = await t.login(N.cafe, 'business')
  taxi = await t.login(N.taxi, 'business')
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
})
afterAll(() => t.close())

const createIntent = (amount: number, note?: string, token = cafe.token) => t.call('POST', '/v1/merchant/intents', { amount, note }, token)

describe('payment intents', () => {
  it('create, look up by id and by code, pay by QR', async () => {
    const c = await createIntent(35.5, 'Coffee & vetkoek')
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ amount: 35.5, status: 'open', note: 'Coffee & vetkoek', merchant: { code: '1001', businessName: 'Ha Abia Cafe' } })
    expect(c.body.code).toMatch(/^\d{6}$/)
    expect(Date.parse(c.body.expiresAt) - Date.parse(c.body.createdAt)).toBe(10 * 60_000)

    const byId = await t.call('GET', `/v1/intents/lookup?id=${c.body.id}`, undefined, lerato.token)
    expect(byId.body).toMatchObject({ id: c.body.id, status: 'open' })
    expect((await t.call('GET', `/v1/intents/lookup?code=${c.body.code}`, undefined, lerato.token)).body.id).toBe(c.body.id)

    expect((await t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '0000', method: 'qr' }, lerato.token)).body.error.code).toBe('WRONG_PIN')
    const paid = await t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'qr' }, lerato.token)
    expect(paid.status).toBe(200)
    expect(paid.body.balance).toBe(1205)
    expect(paid.body.transaction).toMatchObject({ kind: 'qr', amount: -35.5, counterpartyName: 'Ha Abia Cafe' })
    expect(paid.body.message).toMatchObject({ kind: 'receipt', amount: 35.5, senderId: lerato.user.id })
    expect((await chatByTitle(t, cafe.token, 'Lerato Mokhothu')).lastMessage.id).toBe(paid.body.message.id)

    const after = await t.call('GET', `/v1/merchant/intents/${c.body.id}`, undefined, cafe.token)
    expect(after.body).toMatchObject({ status: 'paid', method: 'qr', paidBy: { id: lerato.user.id }, transaction: { kind: 'qr', amount: 35.5 } })
    // Paid intents can no longer be looked up or paid.
    expect((await t.call('GET', `/v1/intents/lookup?code=${c.body.code}`, undefined, thabo.token)).body.error.code).toBe('NOT_FOUND')
    expect((await t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'qr' }, thabo.token)).body.error.code).toBe('CONFLICT')
  })

  it('pays by code; concurrent double pay: exactly one wins', async () => {
    const c = await createIntent(20)
    const [a, b] = await Promise.all([
      t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'code' }, lerato.token),
      t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'code' }, thabo.token),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const intent = (await t.call('GET', `/v1/merchant/intents/${c.body.id}`, undefined, cafe.token)).body
    expect(intent).toMatchObject({ status: 'paid', method: 'code' })
    const [{ n }] = await t.server.db.query<{ n: number }>(`SELECT count(*) AS n FROM transactions WHERE id = $1`, [intent.transaction.id])
    expect(n).toBe(1)
  })

  it('expired and cancelled intents cannot be paid', async () => {
    const e = await createIntent(5)
    await t.server.db.query(`UPDATE payment_intents SET expires_at = now() - interval '1 second' WHERE id = $1`, [e.body.id])
    expect((await t.call('GET', `/v1/intents/lookup?id=${e.body.id}`, undefined, lerato.token)).body.error.code).toBe('NOT_FOUND')
    expect((await t.call('POST', `/v1/intents/${e.body.id}/pay`, { pin: '1234', method: 'qr' }, lerato.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('GET', `/v1/merchant/intents/${e.body.id}`, undefined, cafe.token)).body.status).toBe('expired')
    expect((await t.call('POST', `/v1/merchant/intents/${e.body.id}/cancel`, undefined, cafe.token)).body.error.code).toBe('CONFLICT')

    const c = await createIntent(6)
    const cancelled = await t.call('POST', `/v1/merchant/intents/${c.body.id}/cancel`, undefined, cafe.token)
    expect(cancelled.body.status).toBe('cancelled')
    expect((await t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'code' }, lerato.token)).body.error.code).toBe('CONFLICT')
    // Another merchant cannot see it; customers cannot create intents.
    expect((await t.call('GET', `/v1/merchant/intents/${c.body.id}`, undefined, taxi.token)).status).toBe(404)
    expect((await createIntent(5, undefined, lerato.token)).body.error.code).toBe('FORBIDDEN')
  })

  it('the sweeper expires overdue intents', async () => {
    const e = await createIntent(7)
    await t.server.db.query(`UPDATE payment_intents SET expires_at = now() - interval '1 second' WHERE id = $1`, [e.body.id])
    await t.server.intentSweeper.sweep()
    const [row] = await t.server.db.query<{ status: string }>('SELECT status FROM payment_intents WHERE id = $1', [e.body.id])
    expect(row.status).toBe('expired')
  })

  it('validates amounts and codes', async () => {
    expect((await createIntent(0)).body.error.code).toBe('VALIDATION')
    expect((await createIntent(10_001)).body.error.code).toBe('LIMIT_EXCEEDED')
    expect((await t.call('GET', '/v1/intents/lookup?code=12ab', undefined, lerato.token)).body.error.code).toBe('VALIDATION')
  })
})

describe('tap on an intent', () => {
  it('pays from the tag owner without PIN at or under the limit', async () => {
    const before = await balanceOf(t, lerato.token)
    const c = await createIntent(150, undefined, taxi.token)
    const r = await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: '04:a2:24:6a:8b:6d:80' }, taxi.token)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'paid', method: 'tap', paidBy: { id: lerato.user.id }, transaction: { kind: 'tap', amount: 150 } })
    expect(await balanceOf(t, lerato.token)).toBe(before - 150)
    expect((await chatByTitle(t, lerato.token, 'Taxi · Ntate Mokoena')).lastMessage).toMatchObject({ kind: 'receipt', amount: 150 })
  })

  it('needs the owner PIN above the limit; wrong PIN counts against the owner', async () => {
    const c = await createIntent(250, undefined, taxi.token)
    const noPin = await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: DEMO_TAG }, taxi.token)
    expect(noPin.body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: DEMO_TAG, pin: '0000' }, taxi.token)).body.error.code).toBe('WRONG_PIN')
    const [{ failed_pins }] = await t.server.db.query<{ failed_pins: number }>('SELECT failed_pins FROM users WHERE msisdn = $1', [N.lerato])
    expect(failed_pins).toBe(1)
    const ok = await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: DEMO_TAG, pin: '1234' }, taxi.token)
    expect(ok.body.status).toBe('paid')
  })

  it('unknown tags are NOT_REGISTERED; suspended owners are SUSPENDED', async () => {
    const c = await createIntent(10, undefined, taxi.token)
    expect((await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: 'DEADBEEF' }, taxi.token)).body.error.code).toBe('NOT_REGISTERED')
    expect((await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: 'xyz' }, taxi.token)).body.error.code).toBe('VALIDATION')
    const tag = await t.call('POST', '/v1/me/tags', { tagId: '11223344', label: 'Thabo card' }, thabo.token)
    await t.server.db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [thabo.user.id])
    expect((await t.call('POST', `/v1/merchant/intents/${c.body.id}/tap`, { tagId: '11223344' }, taxi.token)).body.error.code).toBe('SUSPENDED')
    await t.server.db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [thabo.user.id])
    expect((await t.call('DELETE', `/v1/me/tags/${tag.body.id}`, undefined, thabo.token)).status).toBe(204)
  })
})

describe('static merchant QR', () => {
  it('looks up the merchant and pays with PIN (ledger kind qr)', async () => {
    const m = await t.call('GET', '/v1/merchants/1042', undefined, lerato.token)
    expect(m.body).toMatchObject({ code: '1042', businessName: 'Taxi · Ntate Mokoena', role: 'merchant' })
    expect(m.body.balance).toBeUndefined()
    expect((await t.call('GET', `/v1/merchants/AGENT-0101`, undefined, lerato.token)).body.error.code).toBe('NOT_FOUND')

    const r = await t.call('POST', '/v1/payments/merchant', { merchantCode: '1042', amount: 14, pin: '1234', note: 'Maseru → Roma' }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.transaction).toMatchObject({ kind: 'qr', amount: -14 })
    expect(r.body.message).toMatchObject({ kind: 'receipt', note: 'Maseru → Roma' })
    expect((await t.call('POST', '/v1/payments/merchant', { merchantCode: '1042', amount: 14 }, lerato.token)).body.error.code).toBe('VALIDATION')

    const s = await t.call('GET', '/v1/merchant/summary', undefined, taxi.token)
    expect(s.body.salesToday).toEqual({ count: 3, total: 414 }) // tap 150 + tap 250 + qr 14
    expect(s.body.recent[0]).toMatchObject({ kind: 'qr', amount: 14 })

    const admin = await t.adminLogin()
    const qr = await t.call('GET', '/admin/v1/transactions?kind=qr', undefined, admin)
    expect(qr.body.items.length).toBeGreaterThanOrEqual(1)
    expect(qr.body.items.every((x: any) => x.kind === 'qr')).toBe(true)
  })
})

describe('NFC tags', () => {
  it('list, add, delete; cannot delete someone else\'s', async () => {
    const list = await t.call('GET', '/v1/me/tags', undefined, lerato.token)
    expect(list.body).toEqual([expect.objectContaining({ tagId: DEMO_TAG, label: 'EcoCash sticker' })])
    const added = await t.call('POST', '/v1/me/tags', { tagId: 'aa bb cc dd', label: 'Keyring' }, lerato.token)
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ tagId: 'AABBCCDD', label: 'Keyring' })
    expect((await t.call('POST', '/v1/me/tags', { tagId: 'AABBCCDD', label: 'Mine' }, thabo.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('DELETE', `/v1/me/tags/${added.body.id}`, undefined, thabo.token)).status).toBe(404)
    expect((await t.call('DELETE', `/v1/me/tags/${added.body.id}`, undefined, lerato.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/me/tags', undefined, lerato.token)).body).toHaveLength(1)
  })
})

describe('intent.updated over WebSocket', () => {
  it('goes to the merchant and the payer only', async () => {
    const base = (await t.server.app.listen({ port: 0, host: '127.0.0.1' })).replace('http', 'ws')
    const open = async (token: string) => {
      const ws = new WsClient(`${base}/v1/ws?token=${token}`)
      await ws.waitFor('hello')
      return ws
    }
    const mme = await t.login(N.mme)
    const [wsCafe, wsMme, wsThabo, wsTaxi] = await Promise.all([open(cafe.token), open(mme.token), open(thabo.token), open(taxi.token)])
    try {
      const c = await createIntent(12)
      await t.call('POST', `/v1/intents/${c.body.id}/pay`, { pin: '1234', method: 'code' }, mme.token)
      for (const ws of [wsCafe, wsMme]) {
        const e = await ws.waitFor('intent.updated', (ev) => ev.intent.id === c.body.id)
        expect(e.intent).toMatchObject({ status: 'paid', method: 'code', paidBy: { id: mme.user.id } })
      }
      await wsMme.waitFor('balance')
      await wsCafe.waitFor('balance')
      await sleep(150)
      expect(wsThabo.events.filter((e) => e.type !== 'hello')).toHaveLength(0)
      expect(wsTaxi.events.filter((e) => e.type !== 'hello')).toHaveLength(0)

      const x = await createIntent(3)
      wsCafe.events = []
      await t.call('POST', `/v1/merchant/intents/${x.body.id}/cancel`, undefined, cafe.token)
      expect((await wsCafe.waitFor('intent.updated', (ev) => ev.intent.id === x.body.id)).intent.status).toBe('cancelled')
    } finally {
      for (const ws of [wsCafe, wsMme, wsThabo, wsTaxi]) ws.close()
    }
  })
})
