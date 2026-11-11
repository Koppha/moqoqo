import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, lastMessage, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
let chatId: string

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
  chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
})
afterAll(() => t.close())

const send = (body: Record<string, unknown>, token = lerato.token) =>
  t.call('POST', '/v1/payments/send', { chatId, toUserId: mme.user.id, pin: '1234', kind: 'money', clientId: crypto.randomUUID(), ...body }, token)

describe('send money', () => {
  it('moves money, writes the ledger and posts a money message', async () => {
    const r = await send({ amount: 150.25, note: 'Lijo' })
    expect(r.status).toBe(200)
    expect(r.body.balance).toBe(1090.25)
    expect(r.body.transaction).toMatchObject({ kind: 'send', amount: -150.25, counterpartyName: 'Mme' })
    expect(r.body.transaction.reference).toMatch(/^MP\d{10}$/)
    expect(r.body.message).toMatchObject({ kind: 'money', amount: 150.25, note: 'Lijo', senderId: lerato.user.id, chatId })
    expect(await balanceOf(t, mme.token)).toBe(800.25)
    const mmeTx = await t.call('GET', '/v1/transactions?limit=5', undefined, mme.token)
    expect(mmeTx.body[0]).toMatchObject({ kind: 'send', amount: 150.25, counterpartyName: 'Lerato Mokhothu' })
    expect((await lastMessage(t, mme.token, chatId)).id).toBe(r.body.message.id)
  })

  it('sends mpho (gift) messages', async () => {
    const r = await send({ amount: 10, kind: 'mpho' })
    expect(r.body.message.kind).toBe('mpho')
    expect(r.body.transaction.kind).toBe('mpho')
  })

  it('refuses insufficient funds without moving anything', async () => {
    const before = await balanceOf(t, lerato.token)
    const r = await send({ amount: 9999 })
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS')
    expect(await balanceOf(t, lerato.token)).toBe(before)
    const [{ n }] = await t.server.db.query<{ n: number }>(`SELECT count(*) AS n FROM transactions WHERE amount_cents = 999900`)
    expect(n).toBe(0)
  })

  it('validates amounts and limits', async () => {
    expect((await send({ amount: 0 })).body.error.code).toBe('VALIDATION')
    expect((await send({ amount: -5 })).body.error.code).toBe('VALIDATION')
    expect((await send({ amount: 1.234 })).body.error.code).toBe('VALIDATION')
    expect((await send({ amount: 10_000.01 })).body.error.code).toBe('LIMIT_EXCEEDED')
    expect((await send({ amount: '5' })).body.error.code).toBe('VALIDATION')
  })

  it('checks the PIN and membership', async () => {
    expect((await send({ amount: 1, pin: '9999' })).body.error.code).toBe('WRONG_PIN')
    const palesa = await t.login(N.palesa)
    expect((await send({ amount: 1 }, palesa.token)).body.error.code).toBe('NOT_FOUND')
    expect((await send({ amount: 1, toUserId: lerato.user.id })).body.error.code).toBe('VALIDATION')
  })

  it('a reused clientId never pays twice', async () => {
    const clientId = crypto.randomUUID()
    expect((await send({ amount: 1, clientId })).status).toBe(200)
    const before = await balanceOf(t, lerato.token)
    const again = await send({ amount: 1, clientId })
    expect(again.body.error.code).toBe('CONFLICT')
    expect(await balanceOf(t, lerato.token)).toBe(before)
  })

  it('concurrent payments cannot overdraw', async () => {
    const palesa = await t.login(N.palesa) // M85
    const chat = await t.call('POST', '/v1/chats', { msisdn: N.mme }, palesa.token)
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.call(
          'POST',
          '/v1/payments/send',
          { chatId: chat.body.id, toUserId: mme.user.id, amount: 30, pin: '1234', kind: 'money', clientId: crypto.randomUUID() },
          palesa.token,
        ),
      ),
    )
    expect(results.filter((r) => r.status === 200)).toHaveLength(2)
    expect(results.filter((r) => r.body.error?.code === 'INSUFFICIENT_FUNDS')).toHaveLength(3)
    expect(await balanceOf(t, palesa.token)).toBe(25)
  })
})

describe('chats and messages', () => {
  it('get-or-create direct chats by number', async () => {
    const a = await t.call('POST', '/v1/chats', { msisdn: N.thabo }, lerato.token)
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ kind: 'direct', title: 'Thabo', unread: 0 })
    const b = await t.call('POST', '/v1/chats', { msisdn: N.thabo }, lerato.token)
    expect(b.status).toBe(200)
    expect(b.body.id).toBe(a.body.id)
    expect((await t.call('POST', '/v1/chats', { msisdn: '+26662999999' }, lerato.token)).body.error.code).toBe('NOT_REGISTERED')
  })

  it('creates groups, posts text, paginates with before and tracks unread', async () => {
    const g = await t.call('POST', '/v1/chats', { title: 'Book club', memberMsisdns: [N.mme, N.thabo] }, lerato.token)
    expect(g.status).toBe(201)
    expect(g.body.members).toHaveLength(3)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const m = await t.call('POST', `/v1/chats/${g.body.id}/messages`, { clientId: `c${i}`, text: `hello ${i}` }, lerato.token)
      expect(m.body).toMatchObject({ kind: 'text', text: `hello ${i}`, clientId: `c${i}` })
      ids.push(m.body.id)
    }
    // Retrying a clientId returns the same message.
    expect((await t.call('POST', `/v1/chats/${g.body.id}/messages`, { clientId: 'c4', text: 'hello 4' }, lerato.token)).body.id).toBe(ids[4])
    const page = await t.call('GET', `/v1/chats/${g.body.id}/messages?before=${ids[3]}&limit=2`, undefined, mme.token)
    expect(page.body.map((m: any) => m.text)).toEqual(['hello 1', 'hello 2'])
    const summary = await chatByTitle(t, mme.token, 'Book club')
    expect(summary.unread).toBe(5)
    expect(summary.lastMessage.text).toBe('hello 4')
    expect((await t.call('POST', `/v1/chats/${g.body.id}/read`, undefined, mme.token)).status).toBe(204)
    expect((await chatByTitle(t, mme.token, 'Book club')).unread).toBe(0)
    const palesa = await t.login(N.palesa)
    expect((await t.call('GET', `/v1/chats/${g.body.id}/messages`, undefined, palesa.token)).status).toBe(404)
  })

  it('seeded chats match the app demo world', async () => {
    const chats = (await t.call('GET', '/v1/chats', undefined, lerato.token)).body
    const lelapa = chats.find((c: any) => c.title === 'Lelapa (Family)')
    expect(lelapa.kind).toBe('group')
    expect(lelapa.lastMessage.request).toMatchObject({ kind: 'bill', bill: 'school', amount: 1200, paid: 600, status: 'pending', paidByName: 'Thabo' })
    const lec = chats.find((c: any) => c.kind === 'official' && !c.assistant)
    expect(lec.title).toBe('LEC')
    expect(lec.members.find((m: any) => m.official)).toBeTruthy()
    expect(lec.lastMessage.text).toContain('2216-4471-0983-5512-7704')
  })
})
