import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
let thabo: { token: string; user: any }

const billerBalance = async (bill: string) =>
  (await t.server.db.query<{ b: number }>('SELECT balance_cents AS b FROM users WHERE biller = $1', [bill]))[0].b / 100

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
  thabo = await t.login(N.thabo)
})
afterAll(() => t.close())

describe('money requests (Kopa)', () => {
  it('create → pay in a direct chat', async () => {
    const chat = await chatByTitle(t, lerato.token, 'Mme')
    const created = await t.call('POST', '/v1/requests', { chatId: chat.id, clientId: 'k1', amount: 50, kind: 'money', note: 'Taxi fare' }, lerato.token)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'request', clientId: 'k1' })
    expect(created.body.request).toMatchObject({ kind: 'money', amount: 50, paid: 0, status: 'pending', toUserId: lerato.user.id, note: 'Taxi fare' })
    const id = created.body.id

    // The requester cannot pay or decline their own request.
    expect((await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234' }, lerato.token)).body.error.code).toBe('FORBIDDEN')
    expect((await t.call('POST', `/v1/requests/${id}/decline`, undefined, lerato.token)).body.error.code).toBe('FORBIDDEN')
    // Partial payments are only for groups.
    expect((await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234', amount: 20 }, mme.token)).body.error.code).toBe('VALIDATION')
    // Outsiders cannot see it.
    expect((await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234' }, thabo.token)).status).toBe(404)

    const before = await balanceOf(t, lerato.token)
    const paid = await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234' }, mme.token)
    expect(paid.status).toBe(200)
    expect(paid.body.message.request).toMatchObject({ status: 'paid', paid: 50, paidByName: 'Mme' })
    expect(paid.body.transaction).toMatchObject({ kind: 'request', amount: -50 })
    expect(paid.body.balance).toBe(600)
    expect(await balanceOf(t, lerato.token)).toBe(before + 50)
    expect((await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234' }, mme.token)).body.error.code).toBe('CONFLICT')
  })

  it('decline by the payer side', async () => {
    const chat = await chatByTitle(t, lerato.token, 'Mme')
    const created = await t.call('POST', '/v1/requests', { chatId: chat.id, clientId: 'k2', amount: 70, kind: 'money' }, lerato.token)
    const declined = await t.call('POST', `/v1/requests/${created.body.id}/decline`, undefined, mme.token)
    expect(declined.status).toBe(200)
    expect(declined.body.request.status).toBe('declined')
    expect((await t.call('POST', `/v1/requests/${created.body.id}/pay`, { pin: '1234' }, mme.token)).body.error.code).toBe('CONFLICT')
  })
})

describe('bill requests (Ntefelle)', () => {
  it('group school fees: partial payments go to the biller, never the requester', async () => {
    const lelapa = await chatByTitle(t, lerato.token, 'Lelapa (Family)')
    const id = lelapa.lastMessage.id
    const mmeBefore = await balanceOf(t, mme.token)
    const schoolBefore = await billerBalance('school')

    expect((await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234', amount: 700 }, lerato.token)).body.error.code).toBe('VALIDATION')
    const part = await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234', amount: 250 }, lerato.token)
    expect(part.status).toBe(200)
    expect(part.body.message.request).toMatchObject({ status: 'pending', paid: 850, amount: 1200, paidByName: 'Thabo, Lerato Mokhothu' })
    expect(part.body.transaction).toMatchObject({ kind: 'bill', amount: -250, counterpartyName: 'School fees' })

    const rest = await t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234' }, thabo.token) // defaults to what is due
    expect(rest.body.message.request).toMatchObject({ status: 'paid', paid: 1200 })
    expect(rest.body.transaction.amount).toBe(-350)
    expect(rest.body.token).toBeUndefined()

    expect(await balanceOf(t, mme.token)).toBe(mmeBefore)
    expect(await billerBalance('school')).toBe(schoolBefore + 600)
  })

  it("Mme's LEC request: payer pays LEC and the token goes to the requester's LEC chat", async () => {
    const chat = await chatByTitle(t, lerato.token, 'Mme')
    const req = (await t.call('GET', `/v1/chats/${chat.id}/messages`, undefined, lerato.token)).body.find(
      (m: any) => m.request?.bill === 'lec' && m.request.status === 'pending',
    )
    expect(req.request).toMatchObject({ amount: 100, account: '04127731905', detail: "Meter 0412 7731 905 · Mme's house" })
    const lecBefore = await billerBalance('lec')
    const mmeBefore = await balanceOf(t, mme.token)

    const r = await t.call('POST', `/v1/requests/${req.id}/pay`, { pin: '1234' }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.token).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/)
    expect(r.body.units).toBe('68.4 kWh')
    expect(r.body.message.request.status).toBe('paid')
    expect(await billerBalance('lec')).toBe(lecBefore + 100)
    expect(await balanceOf(t, mme.token)).toBe(mmeBefore)

    // Mme (the requester) now has an official LEC chat holding the token.
    const lec = await chatByTitle(t, mme.token, 'LEC')
    expect(lec.kind).toBe('official')
    expect(lec.lastMessage.text).toContain(r.body.token)
    expect(lec.lastMessage.text).toContain('Meter 0412 7731 905'.replace('Meter', 'meter'))
    expect(lec.lastMessage.text).toContain('M100.00 · 68.4 kWh')
  })

  it('validates bill requests', async () => {
    const chat = await chatByTitle(t, lerato.token, 'Mme')
    expect((await t.call('POST', '/v1/requests', { chatId: chat.id, clientId: 'b1', amount: 10, kind: 'bill', bill: 'lec' }, lerato.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/v1/requests', { chatId: chat.id, clientId: 'b2', amount: 10, kind: 'bill', bill: 'gas', account: '1' }, lerato.token)).body.error.code).toBe('VALIDATION')
    const ok = await t.call('POST', '/v1/requests', { chatId: chat.id, clientId: 'b3', amount: 10, kind: 'bill', bill: 'wasco', account: '201184471' }, lerato.token)
    expect(ok.body.request.toUserId).not.toBe(lerato.user.id)
  })
})

describe('bills', () => {
  it('LEC returns a token and posts it to the payer\'s LEC chat; other billers do not', async () => {
    const r = await t.call('POST', '/v1/bills/pay', { bill: 'lec', account: '04128890113', amount: 50, pin: '1234' }, thabo.token)
    expect(r.status).toBe(200)
    expect(r.body.token).toMatch(/^(\d{4}-){4}\d{4}$/)
    expect(r.body.units).toBe('34.2 kWh')
    expect(r.body.transaction).toMatchObject({ kind: 'bill', amount: -50, description: 'LEC · 04128890113' })
    expect(r.body.message.text).toContain(r.body.token)
    const lec = await chatByTitle(t, thabo.token, 'LEC')
    expect(lec.lastMessage.id).toBe(r.body.message.id)

    const w = await t.call('POST', '/v1/bills/pay', { bill: 'wasco', account: '201184471', amount: 80, pin: '1234' }, thabo.token)
    expect(w.status).toBe(200)
    expect(w.body.token).toBeUndefined()
    expect(w.body.transaction.counterpartyName).toBe('WASCO Water')
  })
})
