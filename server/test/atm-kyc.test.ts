import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MockSms } from '../src/notify/gateways'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
const sms = new MockSms()
let lerato: { token: string; user: any }
let palesa: { token: string; user: any }
let admin: string
const withdraw = (amount: number, token = lerato.token) =>
  t.call('POST', '/v1/atm/withdrawals', { amount, pin: '1234', clientId: crypto.randomUUID() }, token)
const atm = (body: Record<string, unknown>) => t.call('POST', '/admin/v1/atm/redeem', { msisdn: N.lerato, atm: 'Kingsway ATM', ...body }, admin)

beforeAll(async () => {
  t = await startTestServer({ sms })
  lerato = await t.login(N.lerato) // tier 2
  palesa = await t.login(N.palesa) // tier 1
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('cardless ATM withdrawal', () => {
  it('holds amount + fee, then the ATM pays out with number + code', async () => {
    const before = await balanceOf(t, lerato.token)
    const w = await withdraw(200)
    expect(w.status).toBe(201)
    expect(w.body).toMatchObject({ amount: 200, fee: 5, status: 'active', reference: expect.stringMatching(/^ATM-\d{6}$/) })
    expect(w.body.code).toMatch(/^\d{8}$/)
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 205, 2)

    expect((await atm({ code: w.body.code, amount: 100 })).status).toBe(400) // wrong amount
    const out = await atm({ code: w.body.code, amount: 200 })
    expect(out.body).toMatchObject({ status: 'redeemed', atm: 'Kingsway ATM' })
    expect(out.body.code).toBeUndefined()
    expect((await atm({ code: w.body.code, amount: 200 })).status).toBe(400) // used
    await t.server.ctx.notifier.idle()
    expect(sms.sent.some((s) => s.to === N.lerato && s.text.includes('taken out at Kingsway ATM'))).toBe(true)
    expect(sms.sent.some((s) => s.text.includes(w.body.code))).toBe(false) // never in a message
  })

  it('agents and merchants take cash out too, signed in to the business app', async () => {
    for (const [msisdn, role] of [[N.agent, 'agent'], [N.cafe, 'merchant']] as const) {
      const biz = await t.login(msisdn, 'business')
      expect(biz.user.role).toBe(role)
      const before = await balanceOf(t, biz.token)
      const w = await withdraw(100, biz.token)
      expect(w.status).toBe(201)
      expect(await balanceOf(t, biz.token)).toBeCloseTo(before - 105, 2)
      expect((await atm({ msisdn, code: w.body.code, amount: 100 })).body.status).toBe('redeemed')
    }
  })

  it('only multiples of M50, up to the maximum', async () => {
    expect((await withdraw(120)).status).toBe(400)
    expect((await withdraw(5000)).body.error.code).toBe('LIMIT_EXCEEDED')
  })

  it('cancel or expiry gives the money back', async () => {
    const before = await balanceOf(t, lerato.token)
    const w = await withdraw(100)
    const c = await t.call('POST', `/v1/atm/withdrawals/${w.body.id}/cancel`, undefined, lerato.token)
    expect(c.body.status).toBe('cancelled')
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before, 2)

    const w2 = await withdraw(50)
    await t.server.db.query(`UPDATE atm_withdrawals SET expires_at = now() - interval '1 minute' WHERE id = $1`, [w2.body.id])
    expect(await t.server.atmSweeper.sweep()).toBe(1)
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before, 2)
    expect((await atm({ code: w2.body.code, amount: 50 })).status).toBe(400)
  })

  it('three wrong codes stop it', async () => {
    const before = await balanceOf(t, lerato.token)
    await withdraw(50)
    for (let i = 0; i < 3; i++) await atm({ code: '00000000', amount: 50 })
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before, 2)
  })
})

describe('KYC tiers', () => {
  it('tier 1 cannot use ATMs or cash out', async () => {
    const r = await withdraw(50, palesa.token)
    expect(r.body.error.code).toBe('KYC_REQUIRED')
  })

  it('tier 1 limits apply per payment and per day, from the portal', async () => {
    const chat = await t.call('POST', '/v1/chats', { msisdn: N.mme }, palesa.token)
    const mme = chat.body.members.find((m: any) => m.msisdn === N.mme)
    const send = (amount: number) =>
      t.call('POST', '/v1/payments/send', { chatId: chat.body.id, toUserId: mme.id, amount, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, palesa.token)
    await t.call('POST', '/admin/v1/users/' + palesa.user.id + '/float', { amount: 1000, note: 'test money' }, admin).catch(() => {})
    await t.server.db.query('UPDATE users SET balance_cents = 500000 WHERE id = $1', [palesa.user.id])
    const limits = (await t.call('GET', '/admin/v1/kyc-limits', undefined, admin)).body
    const set = await t.call('PUT', '/admin/v1/kyc-limits', { ...limits, perTransaction: { ...limits.perTransaction, send: 100 }, daily: { ...limits.daily, send: 150 } }, admin)
    expect(set.body.perTransaction.send).toBe(100)
    expect((await send(120)).body.error.code).toBe('KYC_REQUIRED')
    expect((await send(100)).status).toBe(200)
    const third = await send(60)
    expect(third.body.error).toMatchObject({ code: 'KYC_REQUIRED' })
    expect(third.body.error.message).toContain('daily limit')
    expect((await t.call('GET', '/v1/kyc-limits', undefined, palesa.token)).body.daily.send).toBe(150)
  })

  it('approving Update KYC raises the tier and tells the customer in the app and by SMS', async () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const up = async () => (await t.call('POST', '/v1/ecosure/uploads', { fileName: 'id.png', contentType: 'image/png', base64: PNG }, palesa.token)).body.id
    const r = await t.call('POST', '/v1/services/svc-kyc/submit', {
      values: { id_type: 'national_id', id_number: '9511300004', id_photo: await up(), selfie: await up(), address: 'Maseru' }, pin: '1234', clientId: crypto.randomUUID(),
    }, palesa.token)
    sms.sent.length = 0
    await t.call('POST', `/admin/v1/service-requests/${r.body.request.id}/decision`, { status: 'approved' }, admin)
    await t.server.ctx.notifier.idle()
    expect((await t.call('GET', '/v1/me', undefined, palesa.token)).body.kycTier).toBe(2)
    const inbox = await chatByTitle(t, palesa.token, 'EcoCash Super App')
    expect(inbox.lastMessage.text).toContain('approved')
    expect(sms.sent.some((s) => s.to === N.palesa && s.text.includes('approved'))).toBe(true)
    expect((await withdraw(50, palesa.token)).status).toBe(201)
  })
})
