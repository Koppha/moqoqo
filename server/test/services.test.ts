import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkServiceValues, serviceAmount, serviceFee, type ServiceDef } from '../../shared/api'
import { MockEcoCashServices } from '../src/gateways/ecocash'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
const gateway = new MockEcoCashServices()
let lerato: { token: string; user: any }
let admin: string
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const submit = (id: string, values: Record<string, string>, extra: Record<string, unknown> = {}, token = lerato.token) =>
  t.call('POST', `/v1/services/${id}/submit`, { values, pin: '1234', clientId: crypto.randomUUID(), ...extra }, token)

beforeAll(async () => {
  t = await startTestServer({ services: gateway })
  lerato = await t.login(N.lerato)
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('shared form rules', () => {
  const def = {
    fields: [
      { key: 'number', type: 'phone', label: { en: 'Number', st: '' }, required: true, networks: ['vodacom'] },
      { key: 'acct', type: 'text', label: { en: 'Account', st: '' }, required: false, pattern: '\\d{6}' },
      { key: 'bundle', type: 'select', label: { en: 'Bundle', st: '' }, required: true, options: [{ value: 'W1', label: { en: 'Week', st: '' }, amount: 30 }] },
    ],
  } as Pick<ServiceDef, 'fields'>
  it('checks each field', () => {
    expect(checkServiceValues(def, {})).toEqual({ number: 'required', bundle: 'required' })
    expect(checkServiceValues(def, { number: '62000021', bundle: 'W1' })).toEqual({ number: 'network' })
    expect(checkServiceValues(def, { number: '+266 5812 3456', bundle: 'W1', acct: '12ab' })).toEqual({ acct: 'pattern' })
    expect(checkServiceValues(def, { number: '58123456', bundle: 'X' })).toEqual({ bundle: 'option' })
  })
  it('prices from the chosen option, fees with a floor', () => {
    expect(serviceAmount(def, { bundle: 'W1' })).toBe(30)
    expect(serviceFee({ fixed: 1, percent: 2, min: 5 }, 100)).toBe(5)
    expect(serviceFee({ fixed: 1, percent: 2, max: 2 }, 100)).toBe(2)
  })
})

describe('customer services', () => {
  it('lists the enabled services with their fields', async () => {
    const r = await t.call('GET', '/v1/services', undefined, lerato.token)
    const codes = r.body.map((s: any) => s.code)
    expect(codes).toEqual(expect.arrayContaining(['MPESA', 'CPAY', 'KHETSI', 'AIRTIME', 'BUNDLE', 'KYC']))
    expect(codes).not.toContain('MYWALLET') // off until its fields are defined
    expect(r.body.find((s: any) => s.code === 'MPESA').placement).toBe('send')
  })

  it('quotes M-Pesa with fee and the account name, then sends through EcoCash', async () => {
    const values = { mpesa_number: '58123456', amount: '100' }
    const q = await t.call('POST', '/v1/services/svc-mpesa/quote', { values }, lerato.token)
    expect(q.status).toBe(200)
    expect(q.body).toMatchObject({ amount: 100, fee: 3, total: 103 })
    expect(q.body.recipientName).toBeTruthy()

    const before = await balanceOf(t, lerato.token)
    const clientId = crypto.randomUUID()
    const r = await submit('svc-mpesa', values, { clientId })
    expect(r.status).toBe(200)
    expect(r.body.reference).toMatch(/^SV\d{10}$/)
    expect(r.body.transaction).toMatchObject({ kind: 'service', amount: -100, description: 'M-Pesa · 58123456' })
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 103, 2)
    expect(gateway.calls.at(-1)).toMatchObject({ code: 'MPESA', executor: 'ecocash_transfer', amountCents: 10000 })

    // Retrying the same submit doesn't pay twice.
    const again = await submit('svc-mpesa', values, { clientId })
    expect(again.body.reference).toBe(r.body.reference)
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before - 103, 2)
  })

  it('refuses bad forms with a readable message', async () => {
    const wrongNet = await t.call('POST', '/v1/services/svc-mpesa/quote', { values: { mpesa_number: '62000021', amount: '10' } }, lerato.token)
    expect(wrongNet.status).toBe(400)
    expect(wrongNet.body.error.message).toContain('wrong network')
    const pattern = await t.call('POST', '/v1/services/svc-cpay/quote', { values: { cpay_account: '12', amount: '10' } }, lerato.token)
    expect(pattern.body.error.message).toBe('C-Pay account number: 6 to 12 digits')
    const tooMuch = await t.call('POST', '/v1/services/svc-cpay/quote', { values: { cpay_account: '123456', amount: '6000' } }, lerato.token)
    expect(tooMuch.status).toBe(400)
  })

  it('takes no money when the other network refuses', async () => {
    const before = await balanceOf(t, lerato.token)
    const r = await submit('svc-cpay', { cpay_account: '12340000', amount: '20' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(await balanceOf(t, lerato.token)).toBe(before)
  })

  it('needs the PIN', async () => {
    const r = await submit('svc-airtime', { number: '62000021', amount: '10' }, { pin: '9999' })
    expect(r.body.error.code).toBe('WRONG_PIN')
  })

  it('buys Econet airtime and bundles (Econet numbers only)', async () => {
    const airtime = await submit('svc-airtime', { number: '62000021', amount: '10' })
    expect(airtime.body.transaction).toMatchObject({ amount: -10, description: 'Airtime · 62000021' })
    const bundle = await submit('svc-bundles', { number: '62555010', bundle: 'W1GB' })
    expect(bundle.body.transaction).toMatchObject({ amount: -30, description: 'Bundles · 62555010' })
    const vodacom = await submit('svc-airtime', { number: '58123456', amount: '10' })
    expect(vodacom.status).toBe(400)
  })
})

describe('self service', () => {
  it('Update KYC files a request with photos that staff approve', async () => {
    const palesa = await t.login(N.palesa)
    const up = async () => (await t.call('POST', '/v1/ecosure/uploads', { fileName: 'id.png', contentType: 'image/png', base64: PNG }, palesa.token)).body.id
    const r = await submit('svc-kyc', { id_type: 'national_id', id_number: '0123456789', id_photo: await up(), selfie: await up(), address: 'Ha Abia, Maseru' }, {}, palesa.token)
    expect(r.status).toBe(200)
    expect(r.body.request).toMatchObject({ status: 'pending', reference: expect.stringMatching(/^SR-\d{4}-\d{5}$/) })
    expect(r.body.request.lines).toContainEqual({ label: 'Photo of the document', value: 'Photo attached' })

    const pending = await t.call('GET', '/v1/pending', undefined, palesa.token)
    expect(pending.body.some((p: any) => p.kind === 'service_request')).toBe(true)

    const list = await t.call('GET', '/admin/v1/service-requests?status=pending', undefined, admin)
    const item = list.body.items.find((x: any) => x.id === r.body.request.id)
    expect(item.files.map((f: any) => f.key)).toEqual(['id_photo', 'selfie'])
    const file = await t.server.app.inject({ method: 'GET', url: `/admin/v1/service-requests/${item.id}/files/id_photo`, headers: { authorization: `Bearer ${admin}` } })
    expect(file.headers['content-type']).toBe('image/png')

    const decided = await t.call('POST', `/admin/v1/service-requests/${item.id}/decision`, { status: 'approved' }, admin)
    expect(decided.body.status).toBe('approved')
    expect((await t.call('GET', '/v1/me', undefined, palesa.token)).body.kycTier).toBe(2)
    expect((await t.call('POST', `/admin/v1/service-requests/${item.id}/decision`, { status: 'rejected', note: 'x' }, admin)).status).toBe(400)
  })

  it("won't take someone else's upload", async () => {
    const thabo = await t.login(N.thabo)
    const theirs = (await t.call('POST', '/v1/ecosure/uploads', { fileName: 'id.png', contentType: 'image/png', base64: PNG }, thabo.token)).body.id
    const r = await submit('svc-kyc', { id_type: 'passport', id_number: 'RA12345', id_photo: theirs, selfie: theirs, address: 'Maseru' })
    expect(r.status).toBe(400)
  })

  it('changes the PIN', async () => {
    const mme = await t.login(N.mme)
    expect((await t.call('POST', '/v1/auth/change-pin', { currentPin: '1234', newPin: '1111' }, mme.token)).status).toBe(400)
    expect((await t.call('POST', '/v1/auth/change-pin', { currentPin: '0000', newPin: '4821' }, mme.token)).body.error.code).toBe('WRONG_PIN')
    expect((await t.call('POST', '/v1/auth/change-pin', { currentPin: '1234', newPin: '4821' }, mme.token)).status).toBe(204)
    expect((await t.call('POST', '/v1/auth/login', { msisdn: N.mme, pin: '4821', app: 'customer' })).status).toBe(200)
  })

  it('lists pending requests to pay', async () => {
    const r = await t.call('GET', '/v1/pending', undefined, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.some((p: any) => p.kind === 'request_to_pay' || p.kind === 'request_sent')).toBe(true)
  })
})

describe('portal form builder', () => {
  const body = {
    code: 'TESTPAY', name: { en: 'Test Pay', st: 'Test Pay' }, description: { en: '', st: '' }, icon: 'cash', color: '#123456',
    placement: 'send', sort: 99, enabled: true, executor: 'ecocash_transfer', confirmName: false,
    fields: [
      { key: 'acct', type: 'text', label: { en: 'Account', st: 'Akhaonte' }, required: true },
      { key: 'amount', type: 'amount', label: { en: 'Amount', st: 'Chelete' }, required: true },
    ],
    fee: { fixed: 0, percent: 1 }, limits: { min: 1, max: 100 },
  }

  it('creates a service that customers can use straight away', async () => {
    const created = await t.call('POST', '/admin/v1/services', body, admin)
    expect(created.status).toBe(201)
    const q = await t.call('POST', `/v1/services/${created.body.id}/quote`, { values: { acct: 'ABC', amount: '50' } }, lerato.token)
    expect(q.body).toMatchObject({ amount: 50, fee: 0.5, total: 50.5 })
    await t.call('PUT', `/admin/v1/services/${created.body.id}`, { ...body, enabled: false }, admin)
    expect((await t.call('POST', `/v1/services/${created.body.id}/quote`, { values: { acct: 'ABC', amount: '50' } }, lerato.token)).status).toBe(404)
  })

  it('refuses definitions that would not work', async () => {
    const noAmount = await t.call('POST', '/admin/v1/services', { ...body, fields: [body.fields[0]] }, admin)
    expect(noAmount.body.error.message).toContain('exactly one amount')
    const dupe = await t.call('POST', '/admin/v1/services', { ...body, fields: [body.fields[1], body.fields[1]] }, admin)
    expect(dupe.body.error.message).toContain('Two fields')
    const badRegex = await t.call('POST', '/admin/v1/services', { ...body, fields: [{ ...body.fields[0], pattern: '([' }, body.fields[1]] }, admin)
    expect(badRegex.body.error.message).toContain('regular expression')
    const photoInPayment = await t.call('POST', '/admin/v1/services', { ...body, fields: [...body.fields, { key: 'pic', type: 'image', label: { en: 'Pic', st: 'Pic' }, required: false }] }, admin)
    expect(photoInPayment.status).toBe(400)
  })

  it('support staff can read but not change services', async () => {
    await t.createSupportAdmin('support@test.local', 'support-pass-1')
    const support = await t.adminLogin('support@test.local', 'support-pass-1')
    expect((await t.call('GET', '/admin/v1/services', undefined, support)).status).toBe(200)
    expect((await t.call('POST', '/admin/v1/services', body, support)).status).toBe(403)
  })
})
