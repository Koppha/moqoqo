import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cardBrand, luhnValid } from '../src/gateways/cards'
import { mockAccountName } from '../src/gateways/banks'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
type Session = { token: string; user: any }
let lerato: Session
let thabo: Session
let palesa: Session
let mme: Session
let admin: string
let support: string

const DEFAULT_TARIFF = { cardTopupFeePercent: 2, cardTopupFeeMin: 1, cardTopupMax: 5000, bankTransferFee: 10, bankTransferMax: 10000, dailyMax: 20000, atmFee: 5, atmMax: 3000 }
const YEAR = new Date().getUTCFullYear()
const cardBody = (over: Record<string, unknown> = {}) => ({ number: '4242 4242 4242 4242', expMonth: 12, expYear: YEAR + 2, cvv: '123', holderName: 'Lerato Mokhothu', ...over })
let cid = 0
const clientId = () => `c-${++cid}-${Date.now()}`

const addCard = async (token: string, over: Record<string, unknown> = {}) => {
  const r = await t.call('POST', '/v1/cards', cardBody(over), token)
  expect(r.status).toBe(201)
  return r.body
}
const startTopup = (token: string, cardId: string, amount: number, over: Record<string, unknown> = {}) =>
  t.call('POST', '/v1/topups', { cardId, amount, pin: '1234', clientId: clientId(), ...over }, token)
const confirm = (token: string, id: string, otp = '123456') => t.call('POST', `/v1/topups/${id}/confirm`, { otp }, token)
const transfer = (token: string, over: Record<string, unknown> = {}) =>
  t.call('POST', '/v1/bank-transfers', { bankCode: 'SLB', accountNumber: '12345678901', amount: 100, pin: '1234', clientId: clientId(), ...over }, token)
const feesBalance = async () => (await t.server.db.query<{ balance_cents: number }>(`SELECT balance_cents FROM users WHERE biller = 'fees'`))[0].balance_cents
const setTariff = (body: Record<string, number>) => t.call('PUT', '/admin/v1/tariff', { ...DEFAULT_TARIFF, ...body }, admin)

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  palesa = await t.login(N.palesa)
  mme = await t.login(N.mme)
  admin = await t.adminLogin()
  await t.createSupportAdmin('support@test.local', 'support-pass-123')
  support = await t.adminLogin('support@test.local', 'support-pass-123')
})
afterAll(() => t.close())

describe('tariff', () => {
  it('serves the placeholder tariff to the app and the portal', async () => {
    expect((await t.call('GET', '/v1/tariff', undefined, lerato.token)).body).toEqual(DEFAULT_TARIFF)
    expect((await t.call('GET', '/admin/v1/tariff', undefined, admin)).body).toEqual(DEFAULT_TARIFF)
    expect((await t.call('GET', '/admin/v1/tariff', undefined, support)).status).toBe(200)
    expect((await t.call('GET', '/v1/tariff')).status).toBe(401)
  })

  it('admins change it (audited); support is read-only; values are checked', async () => {
    expect((await t.call('PUT', '/admin/v1/tariff', { ...DEFAULT_TARIFF, bankTransferFee: 12 }, support)).status).toBe(403)
    for (const bad of [{ cardTopupFeePercent: 25 }, { bankTransferFee: -1 }, { cardTopupMax: 20000 }, { bankTransferMax: 10000.001 }, { dailyMax: 'x' }]) {
      const r = await setTariff(bad as any)
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.body.error.code).toBe('VALIDATION')
    }
    const r = await setTariff({ bankTransferFee: 12.5 })
    expect(r.status).toBe(200)
    expect(r.body.bankTransferFee).toBe(12.5)
    expect((await t.call('GET', '/v1/tariff', undefined, lerato.token)).body.bankTransferFee).toBe(12.5)
    const audit = await t.call('GET', '/admin/v1/audit', undefined, admin)
    expect(audit.body.items[0]).toMatchObject({ action: 'tariff.update', target: 'tariff', detail: 'bankTransferFee: 10 → 12.5' })
    expect((await setTariff({})).status).toBe(200)
  })
})

describe('cards', () => {
  it('card helpers: Luhn and brands', () => {
    expect(luhnValid('4242424242424242')).toBe(true)
    expect(luhnValid('4242424242424241')).toBe(false)
    expect(cardBrand('4111111111111111')).toBe('visa')
    expect(cardBrand('5555555555554444')).toBe('mastercard')
    expect(cardBrand('2223000048400011')).toBe('mastercard')
    expect(cardBrand('2721000000000000')).toBe(null)
    expect(cardBrand('378282246310005')).toBe(null)
  })

  it('saves a card with only token, brand, last 4 and expiry', async () => {
    const card = await addCard(lerato.token)
    expect(card).toEqual({ id: expect.any(String), brand: 'visa', last4: '4242', expMonth: 12, expYear: YEAR + 2, holderName: 'Lerato Mokhothu', createdAt: expect.any(String) })
    const mc = await addCard(lerato.token, { number: '5555-5555-5555-4444', expYear: (YEAR + 3) % 100 })
    expect(mc).toMatchObject({ brand: 'mastercard', last4: '4444', expYear: YEAR + 3 })
    const rows = await t.server.db.query('SELECT * FROM cards')
    const dump = JSON.stringify(rows)
    expect(dump).not.toContain('4242424242424242')
    expect(dump).not.toContain('5555555555554444')
    expect(Object.keys(rows[0]).sort()).toEqual(['brand', 'created_at', 'exp_month', 'exp_year', 'gateway_token', 'holder_name', 'id', 'last4', 'removed_at', 'user_id'])
  })

  it('rejects bad cards with clear messages', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ number: '4242 4242 4242 4241' }, 'That card number is not valid. Check it and try again'],
      [{ number: '4242 abcd' }, 'Card number can only contain digits'],
      [{ number: '424242424242' }, 'Card number must be 13 to 19 digits'],
      [{ number: '378282246310005' }, 'Only Visa and Mastercard are supported'],
      [{ expYear: YEAR - 1 }, 'This card has expired'],
      [{ expYear: YEAR + 21 }, 'Expiry year is too far in the future'],
      [{ expMonth: 13 }, 'Expiry month must be 1 to 12'],
      [{ cvv: '12' }, 'CVV must be 3 digits'],
      [{ holderName: ' L ' }, 'Name on card must be 2 to 60 characters'],
    ]
    for (const [over, message] of cases) {
      const r = await t.call('POST', '/v1/cards', cardBody(over), lerato.token)
      expect(r.status, message).toBe(400)
      expect(r.body.error).toEqual({ code: 'VALIDATION', message })
    }
    const declined = await t.call('POST', '/v1/cards', cardBody({ number: '4000 0000 0000 0002' }), lerato.token)
    expect(declined.status).toBe(422)
    expect(declined.body.error).toEqual({ code: 'CARD_DECLINED', message: 'Your bank declined this card' })
  })

  it('lists and removes only my own cards', async () => {
    const mine = (await t.call('GET', '/v1/cards', undefined, lerato.token)).body
    expect(mine.map((c: any) => c.last4)).toEqual(['4444', '4242'])
    expect((await t.call('GET', '/v1/cards', undefined, thabo.token)).body).toEqual([])
    expect((await t.call('DELETE', `/v1/cards/${mine[0].id}`, undefined, thabo.token)).status).toBe(404)
    expect((await t.call('DELETE', `/v1/cards/${mine[0].id}`, undefined, lerato.token)).status).toBe(204)
    expect((await t.call('DELETE', `/v1/cards/${mine[0].id}`, undefined, lerato.token)).status).toBe(404)
    expect((await t.call('GET', '/v1/cards', undefined, lerato.token)).body.map((c: any) => c.last4)).toEqual(['4242'])
    // A removed card can't top up.
    expect((await startTopup(lerato.token, mine[0].id, 50)).status).toBe(404)
  })
})

describe('card top-ups', () => {
  let card: any
  beforeAll(async () => {
    card = (await t.call('GET', '/v1/cards', undefined, lerato.token)).body[0]
  })

  it('checks PIN, card owner and limits before starting', async () => {
    const wrong = await startTopup(lerato.token, card.id, 100, { pin: '9999' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('WRONG_PIN')
    expect((await startTopup(thabo.token, card.id, 100)).status).toBe(404)
    const over = await startTopup(lerato.token, card.id, 5000.01)
    expect(over.status).toBe(422)
    expect(over.body.error).toEqual({ code: 'LIMIT_EXCEEDED', message: 'The most you can top up at once is M5,000.00' })
    expect((await startTopup(lerato.token, card.id, 0)).status).toBe(400)
    expect((await startTopup(lerato.token, card.id, 10.001)).status).toBe(400)
  })

  it('starts a top-up waiting for the bank code; a retry with the same clientId returns it', async () => {
    const id = clientId()
    const r = await startTopup(lerato.token, card.id, 100, { clientId: id })
    expect(r.status).toBe(201)
    expect(r.body.otpHint).toContain('123456')
    expect(r.body.topup).toEqual({
      id: expect.any(String),
      reference: expect.stringMatching(/^TU-\d{6}$/),
      card: { id: card.id, brand: 'visa', last4: '4242' },
      amount: 100,
      fee: 2,
      charged: 102,
      status: 'pending_otp',
      createdAt: expect.any(String),
    })
    const again = await startTopup(lerato.token, card.id, 100, { clientId: id })
    expect(again.status).toBe(200)
    expect(again.body.topup.id).toBe(r.body.topup.id)
    // Minimum fee.
    expect((await startTopup(lerato.token, card.id, 10)).body.topup).toMatchObject({ amount: 10, fee: 1, charged: 11 })
  })

  it('wrong codes: 3 tries, then the top-up fails', async () => {
    const before = await balanceOf(t, lerato.token)
    const { topup } = (await startTopup(lerato.token, card.id, 50)).body
    const r1 = await confirm(lerato.token, topup.id, '000000')
    expect(r1.status).toBe(400)
    expect(r1.body.error).toEqual({ code: 'VALIDATION', message: 'Wrong code. 2 tries left' })
    expect((await confirm(lerato.token, topup.id, '111111')).body.error.message).toBe('Wrong code. 1 try left')
    const r3 = await confirm(lerato.token, topup.id, '222222')
    expect(r3.status).toBe(400)
    expect(r3.body.error.message).toBe('Wrong code. No tries left: start a new top-up')
    const r4 = await confirm(lerato.token, topup.id, '123456')
    expect(r4.status).toBe(409)
    expect(r4.body.error.code).toBe('CONFLICT')
    const [row] = await t.server.db.query<any>('SELECT status, otp_attempts FROM card_topups WHERE id = $1', [topup.id])
    expect(row).toEqual({ status: 'failed', otp_attempts: 3 })
    expect(await balanceOf(t, lerato.token)).toBe(before)
  })

  it('the right code credits the amount (not the charged amount) once, as ledger kind topup', async () => {
    const before = await balanceOf(t, lerato.token)
    const { topup } = (await startTopup(lerato.token, card.id, 200)).body
    expect((await confirm(thabo.token, topup.id)).status).toBe(404)
    const r = await confirm(lerato.token, topup.id)
    expect(r.status).toBe(200)
    expect(r.body.topup).toMatchObject({ id: topup.id, status: 'completed', amount: 200, fee: 4, charged: 204 })
    expect(r.body.money.balance).toBe(before + 200)
    expect(r.body.money.transaction).toMatchObject({ kind: 'topup', amount: 200, counterpartyName: 'Visa •• 4242', description: 'Card top-up · Visa •• 4242' })
    expect(await balanceOf(t, lerato.token)).toBe(before + 200)
    const [tx] = await t.server.db.query<any>(
      'SELECT t.kind, t.from_user_id, t.amount_cents FROM card_topups c JOIN transactions t ON t.id = c.transaction_id WHERE c.id = $1',
      [topup.id],
    )
    expect(tx).toEqual({ kind: 'topup', from_user_id: null, amount_cents: 20000 })
    const again = await confirm(lerato.token, topup.id)
    expect(again.status).toBe(409)
    expect(again.body.error.message).toBe('This top-up is already completed')
    expect(await balanceOf(t, lerato.token)).toBe(before + 200)
  })

  it('concurrent confirms credit only once', async () => {
    const before = await balanceOf(t, lerato.token)
    const { topup } = (await startTopup(lerato.token, card.id, 30)).body
    const results = await Promise.all([confirm(lerato.token, topup.id), confirm(lerato.token, topup.id), confirm(lerato.token, topup.id)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect(await balanceOf(t, lerato.token)).toBe(before + 30)
    const [{ n }] = await t.server.db.query<any>(`SELECT count(*) AS n FROM transactions WHERE kind = 'topup' AND to_user_id = $1 AND amount_cents = 3000`, [lerato.user.id])
    expect(n).toBe(1)
  })

  it('an expired top-up cannot be confirmed', async () => {
    const { topup } = (await startTopup(lerato.token, card.id, 40)).body
    await t.server.db.query(`UPDATE card_topups SET expires_at = now() - interval '1 minute' WHERE id = $1`, [topup.id])
    const r = await confirm(lerato.token, topup.id)
    expect(r.status).toBe(409)
    expect(r.body.error.message).toBe('This top-up has expired. Start a new one')
    expect((await t.server.db.query<any>('SELECT status FROM card_topups WHERE id = $1', [topup.id]))[0].status).toBe('expired')
  })

  it('a card without funds is declined at confirm and the top-up fails', async () => {
    const before = await balanceOf(t, lerato.token)
    const nsf = await addCard(lerato.token, { number: '4000 0000 0000 9995' })
    const { topup } = (await startTopup(lerato.token, nsf.id, 60)).body
    const r = await confirm(lerato.token, topup.id)
    expect(r.status).toBe(422)
    expect(r.body.error).toEqual({ code: 'CARD_DECLINED', message: 'Insufficient funds on the card' })
    const [row] = await t.server.db.query<any>('SELECT status, failure_reason FROM card_topups WHERE id = $1', [topup.id])
    expect(row).toEqual({ status: 'failed', failure_reason: 'Insufficient funds on the card' })
    expect(await balanceOf(t, lerato.token)).toBe(before)
    expect((await confirm(lerato.token, topup.id)).status).toBe(409)
  })

  it('daily limit counts completed and pending top-ups', async () => {
    const card2 = await addCard(thabo.token, { holderName: 'Thabo' })
    for (let i = 0; i < 4; i++) expect((await startTopup(thabo.token, card2.id, 5000)).status).toBe(201)
    const r = await startTopup(thabo.token, card2.id, 1)
    expect(r.status).toBe(422)
    expect(r.body.error).toEqual({ code: 'LIMIT_EXCEEDED', message: 'Card top-ups are limited to M20,000.00 a day. You can still top up M0.00 today' })
    // Expired pending top-ups no longer count.
    await t.server.db.query(`UPDATE card_topups SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [thabo.user.id])
    expect((await startTopup(thabo.token, card2.id, 1)).status).toBe(201)
  })
})

describe('banks', () => {
  it('lists the banks with account lengths', async () => {
    const r = await t.call('GET', '/v1/banks', undefined, lerato.token)
    expect(r.body).toEqual([
      { code: 'SLB', name: 'Standard Lesotho Bank', accountLength: 11 },
      { code: 'FNB', name: 'FNB Lesotho', accountLength: 11 },
      { code: 'NED', name: 'Nedbank Lesotho', accountLength: 11 },
      { code: 'LPB', name: 'Lesotho PostBank', accountLength: 10 },
    ])
  })

  it('looks up the account name', async () => {
    const r = await t.call('GET', '/v1/banks/lookup?bank=SLB&account=1234%205678%20901', undefined, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ bankCode: 'SLB', accountNumber: '12345678901', accountName: mockAccountName('12345678901') })
    expect(r.body.accountName).toMatch(/^[A-Z]( [A-Z])? [A-Z]+$/)
    expect((await t.call('GET', '/v1/banks/lookup?bank=LPB&account=1234567890', undefined, lerato.token)).status).toBe(200)

    const short = await t.call('GET', '/v1/banks/lookup?bank=SLB&account=1234567890', undefined, lerato.token)
    expect(short.status).toBe(400)
    expect(short.body.error.message).toBe('Standard Lesotho Bank account numbers have 11 digits')
    expect((await t.call('GET', '/v1/banks/lookup?bank=SLB&account=1234567890a', undefined, lerato.token)).body.error.message).toBe(
      'Account number can only contain digits',
    )
    expect((await t.call('GET', '/v1/banks/lookup?bank=XYZ&account=12345678901', undefined, lerato.token)).status).toBe(400)
    const missing = await t.call('GET', '/v1/banks/lookup?bank=FNB&account=12345670000', undefined, lerato.token)
    expect(missing.status).toBe(404)
    expect(missing.body.error).toEqual({ code: 'NOT_FOUND', message: 'No account with that number at FNB Lesotho' })
  })
})

describe('bank transfers', () => {
  it('debits amount + fee in one go: withdraw row out of the system, fee row to the EcoCash Super App fees wallet', async () => {
    const before = await balanceOf(t, lerato.token)
    const fees = await feesBalance()
    const name = mockAccountName('12345678901')
    const r = await transfer(lerato.token, { amount: 100, save: true })
    expect(r.status).toBe(201)
    expect(r.body.transfer).toEqual({
      id: expect.any(String),
      reference: expect.stringMatching(/^BT-\d{6}$/),
      bankCode: 'SLB',
      bankName: 'Standard Lesotho Bank',
      accountNumber: '12345678901',
      accountName: name,
      amount: 100,
      fee: 10,
      total: 110,
      status: 'completed',
      createdAt: expect.any(String),
    })
    expect(r.body.money.balance).toBe(before - 110)
    expect(r.body.money.transaction).toMatchObject({ kind: 'withdraw', amount: -100, counterpartyName: 'Standard Lesotho Bank', description: 'To Standard Lesotho Bank ••8901' })
    expect(r.body.account).toMatchObject({ bankCode: 'SLB', bankName: 'Standard Lesotho Bank', accountNumber: '12345678901', accountName: name })
    expect(await balanceOf(t, lerato.token)).toBe(before - 110)
    expect(await feesBalance()).toBe(fees + 1000)

    const [row] = await t.server.db.query<any>(
      `SELECT w.kind AS wk, w.to_user_id AS wto, w.amount_cents AS wc, f.kind AS fk, f.amount_cents AS fc, u.biller
       FROM bank_transfers b JOIN transactions w ON w.id = b.transaction_id JOIN transactions f ON f.id = b.fee_transaction_id
       JOIN users u ON u.id = f.to_user_id WHERE b.id = $1`,
      [r.body.transfer.id],
    )
    expect(row).toEqual({ wk: 'withdraw', wto: null, wc: 10000, fk: 'fee', fc: 1000, biller: 'fees' })

    const list = (await t.call('GET', '/v1/transactions?limit=2', undefined, lerato.token)).body
    expect(list.map((x: any) => [x.kind, x.amount, x.description, x.counterpartyName]).sort()).toEqual([
      ['fee', -10, 'Bank transfer fee', 'EcoCash Super App'],
      ['withdraw', -100, 'To Standard Lesotho Bank ••8901', 'Standard Lesotho Bank'],
    ])
  })

  it('a retry with the same clientId returns the same transfer and moves no money', async () => {
    const id = clientId()
    const first = await transfer(lerato.token, { clientId: id, amount: 20, bankCode: 'LPB', accountNumber: '1234567890' })
    expect(first.status).toBe(201)
    const balance = await balanceOf(t, lerato.token)
    const again = await transfer(lerato.token, { clientId: id, amount: 20, bankCode: 'LPB', accountNumber: '1234567890' })
    expect(again.status).toBe(201)
    expect(again.body.transfer.id).toBe(first.body.transfer.id)
    expect(again.body.money.balance).toBe(balance)
    expect(await balanceOf(t, lerato.token)).toBe(balance)
  })

  it('not enough for amount + fee leaves nothing behind', async () => {
    const before = await balanceOf(t, palesa.token)
    expect(before).toBe(85)
    const r = await transfer(palesa.token, { amount: 80 })
    expect(r.status).toBe(422)
    expect(r.body.error).toEqual({ code: 'INSUFFICIENT_FUNDS', message: 'Not enough money. You need M90.00 including the M10.00 fee. Your balance is M85.00' })
    expect(await balanceOf(t, palesa.token)).toBe(85)
    const [{ n }] = await t.server.db.query<any>(`SELECT count(*) AS n FROM transactions WHERE from_user_id = $1 AND kind IN ('withdraw', 'fee')`, [palesa.user.id])
    expect(n).toBe(0)
    expect(await t.server.db.query('SELECT 1 FROM bank_transfers WHERE user_id = $1', [palesa.user.id])).toEqual([])
  })

  it('checks the PIN and the account before moving money', async () => {
    const before = await balanceOf(t, mme.token)
    const wrong = await transfer(mme.token, { pin: '0000' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('WRONG_PIN')
    expect((await transfer(mme.token, { accountNumber: '12345670000' })).status).toBe(404)
    expect((await transfer(mme.token, { accountNumber: '123' })).status).toBe(400)
    expect(await balanceOf(t, mme.token)).toBe(before)
  })

  it('enforces the per-transfer and daily limits from the tariff', async () => {
    expect((await setTariff({ bankTransferMax: 50, cardTopupMax: 50, dailyMax: 150 })).status).toBe(200)
    try {
      const over = await transfer(lerato.token, { amount: 60 })
      expect(over.status).toBe(422)
      expect(over.body.error).toEqual({ code: 'LIMIT_EXCEEDED', message: 'The most you can send to a bank at once is M50.00' })
      // Lerato already sent M120 today.
      const daily = await transfer(lerato.token, { amount: 40 })
      expect(daily.status).toBe(422)
      expect(daily.body.error).toEqual({ code: 'LIMIT_EXCEEDED', message: 'Bank transfers are limited to M150.00 a day. You can still send M30.00 today' })
      expect((await transfer(lerato.token, { amount: 30 })).status).toBe(201)
    } finally {
      expect((await setTariff({})).status).toBe(200)
    }
  })

  it('saved bank accounts: list and remove my own', async () => {
    const list = (await t.call('GET', '/v1/bank-accounts', undefined, lerato.token)).body
    expect(list).toHaveLength(1)
    expect((await t.call('GET', '/v1/bank-accounts', undefined, thabo.token)).body).toEqual([])
    expect((await t.call('DELETE', `/v1/bank-accounts/${list[0].id}`, undefined, thabo.token)).status).toBe(404)
    expect((await t.call('DELETE', `/v1/bank-accounts/${list[0].id}`, undefined, lerato.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/bank-accounts', undefined, lerato.token)).body).toEqual([])
    // Saving again after removal creates a fresh beneficiary.
    const r = await transfer(lerato.token, { amount: 5, save: true })
    expect(r.body.account.id).not.toBe(list[0].id)
    expect((await t.call('GET', '/v1/bank-accounts', undefined, lerato.token)).body).toHaveLength(1)
  })

  it('the portal sees the new kinds', async () => {
    const r = await t.call('GET', '/admin/v1/transactions?kind=fee', undefined, admin)
    expect(r.body.items.length).toBeGreaterThan(0)
    expect(r.body.items[0]).toMatchObject({ kind: 'fee', description: 'Bank transfer fee', to: { name: 'EcoCash Super App', official: true } })
    const topups = await t.call('GET', '/admin/v1/transactions?kind=topup', undefined, admin)
    expect(topups.body.items[0]).toMatchObject({ kind: 'topup', from: null, description: 'Card top-up · Visa •• 4242' })
  })
})
