import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remitFee, remitReceive } from '../../shared/api'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let admin: string
let support: string
let cid = 0
const clientId = () => `rm-${++cid}-${Date.now()}`

const send = (over: Record<string, unknown> = {}) =>
  t.call(
    'POST',
    '/v1/remittances',
    { country: 'ZA', payout: 'mobile', recipientName: 'Thabo Mokoena', recipientPhone: '+27 82 123 4567', amount: 100, pin: '1234', clientId: clientId(), ...over },
    lerato.token,
  )
const feesBalance = async () => (await t.server.db.query<{ balance_cents: number }>(`SELECT balance_cents FROM users WHERE biller = 'fees'`))[0].balance_cents

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  admin = await t.adminLogin()
  await t.createSupportAdmin('support-remit@test.local', 'support-pass-123')
  support = await t.adminLogin('support-remit@test.local', 'support-pass-123')
})
afterAll(() => t.close())

describe('remittance', () => {
  it('fee and receive amount formulas', () => {
    expect(remitFee({ fee: 15, feePercent: 1 }, 100)).toBe(16)
    expect(remitFee({ fee: 20, feePercent: 1.5 }, 333.33)).toBe(25)
    expect(remitReceive({ rate: 1 }, 100)).toBe(100)
    expect(remitReceive({ rate: 0.055 }, 100)).toBe(5.5)
    expect(remitReceive({ rate: 0.74 }, 12.34)).toBe(9.13)
  })

  it('the app sees only the enabled countries', async () => {
    const r = await t.call('GET', '/v1/remit', undefined, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.corridors.map((c: any) => c.code)).toEqual(['ZA', 'SZ', 'BW', 'ZW'])
    expect((await t.call('GET', '/admin/v1/remit', undefined, admin)).body.corridors).toHaveLength(5)
    expect((await t.call('GET', '/v1/remit')).status).toBe(401)
  })

  it('sends to a mobile wallet: amount and fee leave the wallet, the retry is not charged twice', async () => {
    const before = await balanceOf(t, lerato.token)
    const fees = await feesBalance()
    const id = clientId()
    const r = await send({ clientId: id })
    expect(r.status).toBe(201)
    expect(r.body.remittance).toMatchObject({ country: 'ZA', countryName: 'South Africa', currency: 'ZAR', amount: 100, fee: 16, total: 116, receiveAmount: 100, status: 'completed', pickupCode: null })
    expect(r.body.remittance.reference).toMatch(/^RM-\d{6}$/)
    expect(r.body.money.transaction.description).toBe('To Thabo Mokoena · South Africa')
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 116, 2)
    expect(await feesBalance()).toBe(fees + 1600)

    const again = await send({ clientId: id })
    expect(again.body.remittance.id).toBe(r.body.remittance.id)
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 116, 2)

    const list = await t.call('GET', '/v1/remittances', undefined, lerato.token)
    expect(list.body[0].id).toBe(r.body.remittance.id)
  })

  it('cash pick-up gets a code; bank needs bank details', async () => {
    const cash = await send({ payout: 'cash', amount: 50 })
    expect(cash.status).toBe(201)
    expect(cash.body.remittance.pickupCode).toMatch(/^\d{8}$/)
    expect(cash.body.remittance.status).toBe('submitted')

    expect((await send({ payout: 'bank' })).status).toBe(400)
    const bank = await send({ payout: 'bank', bankName: 'Capitec', accountNumber: '1234 567 890', recipientPhone: undefined })
    expect(bank.status).toBe(201)
    expect(bank.body.remittance).toMatchObject({ bankName: 'Capitec', accountNumber: '1234567890' })
  })

  it('checks the country, payout, recipient, PIN and limits', async () => {
    expect((await send({ country: 'MZ' })).status).toBe(400) // switched off
    expect((await send({ country: 'SZ', payout: 'cash' })).status).toBe(400) // Eswatini: no cash pick-up
    expect((await send({ recipientName: 'Thabo' })).status).toBe(400) // surname needed
    expect((await send({ recipientPhone: '123' })).status).toBe(400)
    expect((await send({ pin: '0000' })).body.error.code).toBe('WRONG_PIN')
    const big = await send({ amount: 5000.01 })
    expect(big.status).toBe(422)
    expect(big.body.error.code).toBe('LIMIT_EXCEEDED')
  })

  it('admins edit countries (audited); support is read-only; values are checked', async () => {
    const current = (await t.call('GET', '/admin/v1/remit', undefined, admin)).body
    expect((await t.call('PUT', '/admin/v1/remit', current, support)).status).toBe(403)
    const dup = { ...current, corridors: [...current.corridors, current.corridors[0]] }
    expect((await t.call('PUT', '/admin/v1/remit', dup, admin)).status).toBe(400)
    const badRate = { ...current, corridors: current.corridors.map((c: any, i: number) => (i === 0 ? { ...c, rate: 0 } : c)) }
    expect((await t.call('PUT', '/admin/v1/remit', badRate, admin)).status).toBe(400)

    const next = { ...current, corridors: current.corridors.map((c: any) => (c.code === 'MZ' ? { ...c, enabled: true, rate: 3.6 } : c)) }
    const saved = await t.call('PUT', '/admin/v1/remit', next, admin)
    expect(saved.status).toBe(200)
    expect(saved.body.corridors.find((c: any) => c.code === 'MZ')).toMatchObject({ enabled: true, rate: 3.6 })
    const audit = await t.server.db.query<{ detail: string }>(`SELECT detail FROM audit_log WHERE action = 'remit.update' ORDER BY created_at DESC LIMIT 1`)
    expect(audit[0].detail).toContain('MZ')

    const mz = await send({ country: 'MZ', amount: 10 })
    expect(mz.status).toBe(201)
    expect(mz.body.remittance).toMatchObject({ currency: 'MZN', receiveAmount: 36 })

    const recent = await t.call('GET', '/admin/v1/remittances', undefined, support)
    expect(recent.status).toBe(200)
    expect(recent.body[0].sender.id).toBe(lerato.user.id)
  })
})
