import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
})
afterAll(() => t.close())

const sendMany = (body: Record<string, unknown>, token = lerato.token) =>
  t.call('POST', '/v1/payments/send-many', { pin: '1234', clientId: crypto.randomUUID(), ...body }, token)

describe('send to many', () => {
  it('pays everyone in their own chat with one PIN', async () => {
    const mme = await t.login(N.mme)
    const thabo = await t.login(N.thabo)
    const [before, mmeBefore, thaboBefore] = [await balanceOf(t, lerato.token), await balanceOf(t, mme.token), await balanceOf(t, thabo.token)]
    const res = await sendMany({ recipients: [{ to: N.mme, amount: 5 }, { to: N.thabo, amount: 7.5 }], note: 'Lunch' })
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(12.5)
    expect(res.body.balance).toBe(before - 12.5)
    expect(res.body.payments.map((p: any) => [p.user.msisdn, p.transaction.amount, p.message.kind])).toEqual([[N.mme, -5, 'money'], [N.thabo, -7.5, 'money']])
    expect(await balanceOf(t, mme.token)).toBe(mmeBefore + 5)
    expect(await balanceOf(t, thabo.token)).toBe(thaboBefore + 7.5)
    // The money shows in the chat with each person.
    const msgs = await t.call('GET', `/v1/chats/${res.body.payments[1].chatId}/messages`, undefined, thabo.token)
    expect(msgs.body.at(-1)).toMatchObject({ kind: 'money', amount: 7.5, note: 'Lunch' })
  })

  it('pays whoever it can; one failure does not stop the others', async () => {
    const before = await balanceOf(t, lerato.token)
    const res = await sendMany({ recipients: [{ to: N.mme, amount: 1 }, { to: '+26662999999', amount: 1 }, { to: N.thabo, amount: 2 }] })
    expect(res.status).toBe(200)
    expect(res.body.payments.map((p: any) => [p.to, p.ok, p.error?.code])).toEqual([[N.mme, true, undefined], ['+26662999999', false, 'NOT_REGISTERED'], [N.thabo, true, undefined]])
    expect(res.body.total).toBe(3)
    expect(res.body.balance).toBe(before - 3)
    expect(await balanceOf(t, lerato.token)).toBe(before - 3)
  })

  it('a retry with the same clientId pays only the people not paid yet', async () => {
    const clientId = crypto.randomUUID()
    const first = await sendMany({ clientId, recipients: [{ to: N.mme, amount: 1 }, { to: N.thabo, amount: 9000 }] })
    expect(first.body.payments.map((p: any) => p.ok)).toEqual([true, false])
    expect(first.body.payments[1].error.code).toMatch(/INSUFFICIENT_FUNDS|LIMIT_EXCEEDED/)
    const after = await balanceOf(t, lerato.token)
    const again = await sendMany({ clientId, recipients: [{ to: N.mme, amount: 1 }, { to: N.thabo, amount: 2 }] })
    expect(again.body.payments.map((p: any) => p.ok)).toEqual([true, true])
    expect(again.body.payments[0].transaction.reference).toBe(first.body.payments[0].transaction.reference)
    expect(await balanceOf(t, lerato.token)).toBe(after - 2)
  })

  it('checks the list and the PIN', async () => {
    expect((await sendMany({ recipients: [] })).body.error.code).toBe('VALIDATION')
    const twice = await sendMany({ recipients: [{ to: N.mme, amount: 1 }, { to: N.mme, amount: 2 }, { to: N.lerato, amount: 1 }] })
    expect(twice.body.payments.map((p: any) => [p.ok, p.error?.code])).toEqual([[true, undefined], [false, 'VALIDATION'], [false, 'VALIDATION']])
    expect((await sendMany({ recipients: [{ to: N.mme, amount: 1 }], pin: '9999' })).body.error.code).toBe('WRONG_PIN')
  })

  it('a batch counts as one payment for the velocity rule', async () => {
    const palesa = await t.login(N.palesa)
    const recipients = [N.lerato, N.mme, N.thabo, N.taxi, N.cafe, N.agent].map((to) => ({ to, amount: 1 }))
    const res = await sendMany({ recipients }, palesa.token)
    expect(res.body.payments.every((p: any) => p.ok)).toBe(true)
    const again = await sendMany({ recipients }, palesa.token)
    expect(again.body.payments.every((p: any) => p.ok)).toBe(true)
  })
})
