import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
})
afterAll(() => t.close())

describe('pay bill', () => {
  it('lists the categories in order, with their billers', async () => {
    const cats = (await t.call('GET', '/v1/bill-categories', undefined, lerato.token)).body
    expect(cats.map((c: any) => c.id)).toEqual(['econet', 'lec', 'multichoice', 'wasco', 'insurance', 'financial', 'utility'])
    const services = (await t.call('GET', '/v1/services', undefined, lerato.token)).body
    const inCat = (id: string) => services.filter((s: any) => s.category === id).map((s: any) => s.name.en)
    expect(inCat('insurance')).toEqual(expect.arrayContaining(['Lesotho Funeral', 'Alliance', 'Mamothe Funeral', 'Sentabale Funeral', 'GL Funeral', 'Metropolitan', 'Zenith Horizon', 'LING', 'Naleli Funeral', 'Liberty']))
    expect(inCat('financial')).toEqual(expect.arrayContaining(['Lesana Lesotho', 'Peoples SACCOS']))
    expect(inCat('econet')).toEqual(expect.arrayContaining(['Airtime', 'Econet postpaid']))
    expect(inCat('multichoice')).toEqual(expect.arrayContaining(['DStv', 'GOtv']))
    expect(inCat('utility')).toEqual(expect.arrayContaining(['LAA', 'Maseru City Council']))
  })

  it('pays a biller with the PIN, through EcoCash', async () => {
    const before = await balanceOf(t, lerato.token)
    const r = await t.call('POST', '/v1/services/bill-dstv/submit', { values: { account: '4123456789', amount: '350' }, pin: '1234', clientId: 'dstv-1' }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.transaction).toMatchObject({ amount: -350 })
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 350, 2)
    expect((await t.call('POST', '/v1/services/bill-dstv/submit', { values: { account: '4123456789', amount: '350' }, pin: '0000', clientId: 'dstv-2' }, lerato.token)).body.error.code).toBe('WRONG_PIN')
  })

  it('staff add a category and a biller, and cannot remove a category with billers in it', async () => {
    const cat = await t.call('POST', '/admin/v1/bill-categories', { id: 'schools', name: { en: 'Schools', st: 'Likolo' }, icon: 'school', color: '#5B2C9F', sort: 80, enabled: true }, admin)
    expect(cat.status).toBe(201)
    const svc = await t.call('POST', '/admin/v1/services', {
      code: 'MACHABENG', name: { en: 'Machabeng College', st: 'Machabeng College' }, description: { en: 'School fees', st: 'Lichelete tsa sekolo' },
      icon: 'school', color: '#5B2C9F', placement: 'bills', category: 'schools', sort: 10, enabled: true, executor: 'bill',
      fields: [{ key: 'student', type: 'text', label: { en: 'Student number', st: 'Nomoro ea moithuti' }, required: true }, { key: 'amount', type: 'amount', label: { en: 'Amount', st: 'Chelete' }, required: true }],
      fee: { fixed: 0, percent: 0 }, limits: { min: 5, max: 50000 }, confirmName: false,
    }, admin)
    expect(svc.status).toBe(201)
    expect((await t.call('DELETE', '/admin/v1/bill-categories/schools', undefined, admin)).body.error.code).toBe('CONFLICT')
    expect((await t.call('DELETE', `/admin/v1/services/${svc.body.id}`, undefined, admin)).status).toBe(204)
    expect((await t.call('DELETE', '/admin/v1/bill-categories/schools', undefined, admin)).status).toBe(204)
  })

  it('a biller needs a category and an account field', async () => {
    const base = { code: 'X_BILL', name: { en: 'X', st: 'X' }, description: { en: '', st: '' }, icon: 'card', color: '#000000', placement: 'bills', sort: 1, enabled: true, executor: 'bill', fee: { fixed: 0, percent: 0 }, limits: { min: 1, max: 10 }, confirmName: false }
    const amountOnly = [{ key: 'amount', type: 'amount', label: { en: 'Amount', st: 'Chelete' }, required: true }]
    expect((await t.call('POST', '/admin/v1/services', { ...base, category: 'utility', fields: amountOnly }, admin)).status).toBe(400)
    expect((await t.call('POST', '/admin/v1/services', { ...base, fields: [{ key: 'acc', type: 'text', label: { en: 'Acc', st: 'Acc' }, required: true }, ...amountOnly] }, admin)).status).toBe(400)
  })
})

describe('app PIN apart from the wallet PIN', () => {
  it('sets an app PIN that opens the app; the wallet PIN still pays', async () => {
    expect((await t.call('POST', '/v1/auth/unlock', { pin: '1234' }, thabo.token)).status).toBe(204)
    expect((await t.call('POST', '/v1/auth/change-app-pin', { currentPin: '1234', newPin: '1111' }, thabo.token)).status).toBe(400) // too easy
    expect((await t.call('POST', '/v1/auth/change-app-pin', { currentPin: '1234', newPin: '2580' }, thabo.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/me', undefined, thabo.token)).body.appPin).toBe(true)

    expect((await t.call('POST', '/v1/auth/unlock', { pin: '2580' }, thabo.token)).status).toBe(204)
    expect((await t.call('POST', '/v1/auth/unlock', { pin: '1234' }, thabo.token)).body.error.code).toBe('WRONG_PIN')
    // Payments and pay codes keep the wallet PIN.
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '1234' }, thabo.token)).status).toBe(204)
    expect((await t.call('POST', '/v1/auth/verify-pin', { pin: '2580' }, thabo.token)).body.error.code).toBe('WRONG_PIN')

    // Back to opening with the wallet PIN.
    expect((await t.call('POST', '/v1/auth/remove-app-pin', { currentPin: '2580' }, thabo.token)).status).toBe(204)
    expect((await t.call('POST', '/v1/auth/unlock', { pin: '1234' }, thabo.token)).status).toBe(204)
    expect((await t.call('GET', '/v1/me', undefined, thabo.token)).body.appPin).toBeUndefined()
  })
})
