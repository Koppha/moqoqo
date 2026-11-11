import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, addMonths, todayMaseru } from '../src/ecosure/account'
import { requiredClaimDocuments } from '../src/ecosure/claims'
import { balanceOf, chatByTitle, lastMessage, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
type Session = { token: string; user: any }
let lerato: Session
let thabo: Session
let palesa: Session
let mme: Session
let admin: string
let support: string

const FUNERAL_DOCS = [
  'Deceased ID copy',
  'Death certificate',
  'Mortuary letter',
  'Beneficiary’s ID',
  'Beneficiary’s banking details',
  'Medical certificate (natural cause)',
  'Police report (unnatural cause)',
  'Chief’s letter (undetermined cause)',
]

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const PDF = Buffer.from('%PDF-1.4\n% test document\n')

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

const buyBody = (over: Record<string, unknown> = {}) => ({
  productCode: 'FUN-STD',
  cover: 'family',
  idNumber: '0101199012345',
  fullName: 'Lerato Mokhothu',
  dob: '1990-01-01',
  gender: 'female',
  beneficiaryName: 'Mme Mokhothu',
  beneficiaryMsisdn: '62103401',
  acceptedTerms: true,
  pin: '1234',
  ...over,
})
const upload = async (token: string, file = PNG, contentType = 'image/png', fileName = 'doc.png') =>
  t.call('POST', '/v1/ecosure/uploads', { fileName, contentType, base64: file.toString('base64') }, token)
const uploadId = async (token: string, fileName = 'doc.png') => {
  const r = await upload(token, PNG, 'image/png', fileName)
  expect(r.status).toBe(201)
  return r.body.id as string
}
const setPaidUntil = (number: string, date: string) => t.server.db.query('UPDATE ecosure_policies SET paid_until = $2 WHERE number = $1', [number, date])
const ecosureChat = async (token: string) => {
  const chat = await chatByTitle(t, token, 'EcoSure')
  expect(chat.kind).toBe('official')
  return lastMessage(t, token, chat.id)
}

let policy: any // Lerato's
let mmePolicy: any

describe('EcoSure catalogue', () => {
  it('lists the live catalogue: funeral first, cheapest first', async () => {
    const r = await t.call('GET', '/v1/ecosure/products', undefined, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body.map((p: any) => p.code)).toEqual(['FUN-LITE', 'FUN-BASIC', 'FUN-STD', 'FUN-PREM', 'ST-MOTOR', 'ST-DEVICE', 'ST-CONTENTS', 'ST-OWNERS', 'ST-SME'])
    const std = r.body.find((p: any) => p.code === 'FUN-STD')
    expect(std).toEqual({
      code: 'FUN-STD',
      name: 'EcoSure Standard',
      line: 'funeral',
      category: 'funeral',
      pricing: 'fixed',
      underwriter: 'LNIG Hollard',
      options: [
        { label: 'Family cover', cover: 'family', monthlyPremium: 84 },
        { label: 'Single cover', cover: 'single', monthlyPremium: 60 },
      ],
      quoteFields: [],
      claimDocuments: FUNERAL_DOCS,
    })
    const motor = r.body.find((p: any) => p.code === 'ST-MOTOR')
    expect(motor).toMatchObject({ pricing: 'quoted', options: [] })
    expect(motor.quoteFields.find((f: any) => f.label === 'Use')).toEqual({ label: 'Use', type: 'choice', required: true, choices: ['Private', 'Commercial'] })
    expect(motor.quoteFields.at(-1)).toMatchObject({ label: 'Letter of settlement (if previous claims)', type: 'document', required: false })
    const sme = r.body.find((p: any) => p.code === 'ST-SME')
    expect(sme.options).toEqual([
      { label: 'Small business', monthlyPremium: 560 },
      { label: 'Medium business', monthlyPremium: 750 },
      { label: 'Larger business', monthlyPremium: 1000 },
    ])
    expect(sme.claimDocuments).toEqual([])
    expect(r.body.find((p: any) => p.code === 'ST-DEVICE').claimDocuments).toHaveLength(3)
    // Public: the standalone EcoSure app shows cover and prices before sign-in.
    expect((await t.call('GET', '/v1/ecosure/products')).status).toBe(200)
  })

  it('works out the claim documents for a cause of death', () => {
    expect(requiredClaimDocuments(FUNERAL_DOCS, 'natural')).toEqual([...FUNERAL_DOCS.slice(0, 5), 'Medical certificate (natural cause)'])
    expect(requiredClaimDocuments(FUNERAL_DOCS, 'unnatural')).toEqual([...FUNERAL_DOCS.slice(0, 5), 'Police report (unnatural cause)'])
    expect(requiredClaimDocuments(FUNERAL_DOCS, 'undetermined')).toEqual([...FUNERAL_DOCS.slice(0, 5), 'Chief’s letter (undetermined cause)'])
  })
})

describe('EcoSure: buy funeral cover', () => {
  it('validates and checks the PIN before any money moves', async () => {
    expect((await t.call('POST', '/v1/ecosure/policies', buyBody({ acceptedTerms: false }), lerato.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/v1/ecosure/policies', buyBody({ productCode: 'ST-SME' }), lerato.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/v1/ecosure/policies', buyBody({ dob: '2999-01-01' }), lerato.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/v1/ecosure/policies', buyBody({ productCode: 'NOPE' }), lerato.token)).body.error.code).toBe('NOT_FOUND')
    const before = await balanceOf(t, lerato.token)
    const wrong = await t.call('POST', '/v1/ecosure/policies', buyBody({ pin: '9999' }), lerato.token)
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('WRONG_PIN')
    expect(await balanceOf(t, lerato.token)).toBe(before)
    expect((await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body).toEqual([])
  })

  it('insufficient funds leaves no policy behind', async () => {
    const r = await t.call('POST', '/v1/ecosure/policies', buyBody({ productCode: 'FUN-PREM', fullName: 'Palesa Letsie' }), palesa.token)
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS')
    expect((await t.call('GET', '/v1/ecosure/policies', undefined, palesa.token)).body).toEqual([])
    const [{ n }] = await t.server.db.query<{ n: number }>('SELECT count(*) AS n FROM ecosure_members')
    expect(n).toBe(0)
  })

  it('creates the policy, main member and payment, debits the wallet and welcomes the buyer in the EcoSure chat', async () => {
    const before = await balanceOf(t, lerato.token)
    const r = await t.call('POST', '/v1/ecosure/policies', buyBody(), lerato.token)
    expect(r.status).toBe(201)
    policy = r.body.policy
    const nextDue = addMonths(todayMaseru(), 1)
    expect(policy).toMatchObject({
      number: expect.stringMatching(/^ES-\d{6}$/),
      productCode: 'FUN-STD',
      packageName: 'EcoSure Standard',
      cover: 'family',
      premium: 84,
      status: 'active',
      nextDue,
      holder: { name: 'Lerato Mokhothu', idNumber: '0101199012345', dob: '1990-01-01', gender: 'female', msisdn: N.lerato },
      beneficiary: { name: 'Mme Mokhothu', msisdn: N.mme },
    })
    expect(policy.members).toEqual([{ id: expect.any(String), name: 'Lerato Mokhothu', relationship: 'main', dob: '1990-01-01' }])
    expect(r.body.payment).toMatchObject({ receipt: expect.stringMatching(/^RC-\d{6}$/), policyNumber: policy.number, holderFirstName: 'Lerato', amount: 84, months: 1, payerName: 'Lerato Mokhothu' })
    expect(r.body.money.balance).toBe(before - 84)
    expect(r.body.money.transaction).toMatchObject({ kind: 'ecosure', amount: -84, counterpartyName: 'EcoSure', description: `EcoSure premium · ${policy.number}` })
    expect(await balanceOf(t, lerato.token)).toBe(before - 84)

    const msg = await ecosureChat(lerato.token)
    expect(msg.text).toContain(`Welcome to EcoSure. Your EcoSure Standard Family cover ${policy.number} has started. Next premium M84.00 due`)
    expect(r.body.money.message.id).toBe(msg.id)

    const list = await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)
    expect(list.body).toEqual([policy])
    const tx = await t.call('GET', '/v1/transactions?limit=1', undefined, lerato.token)
    expect(tx.body[0]).toMatchObject({ kind: 'ecosure', amount: -84 })
  })

  it('one funeral policy per holder', async () => {
    const r = await t.call('POST', '/v1/ecosure/policies', buyBody({ productCode: 'FUN-LITE', cover: 'single' }), lerato.token)
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('CONFLICT')
  })

  it('Mme buys single cover', async () => {
    const r = await t.call('POST', '/v1/ecosure/policies', buyBody({ productCode: 'FUN-LITE', cover: 'single', fullName: 'Mme Mokhothu', beneficiaryName: undefined, beneficiaryMsisdn: undefined }), mme.token)
    expect(r.status).toBe(201)
    mmePolicy = r.body.policy
    expect(mmePolicy).toMatchObject({ premium: 20, cover: 'single' })
    expect(mmePolicy.beneficiary).toBeUndefined()
  })
})

describe('EcoSure: status and premiums', () => {
  it('derives grace and lapsed from the paid-up date', async () => {
    const get = async () => (await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body[0]
    await setPaidUntil(policy.number, addDays(todayMaseru(), -5))
    expect((await get()).status).toBe('grace')
    await setPaidUntil(policy.number, addDays(todayMaseru(), -30))
    expect((await get()).status).toBe('grace')
    await setPaidUntil(policy.number, addDays(todayMaseru(), -31))
    expect((await get()).status).toBe('lapsed')
    await setPaidUntil(policy.number, todayMaseru())
    expect((await get()).status).toBe('active')
  })

  it('looks a policy up by number or phone, showing only the first name', async () => {
    await setPaidUntil(policy.number, addDays(todayMaseru(), -40))
    const byNumber = await t.call('GET', `/v1/ecosure/policies/lookup?ref=${policy.number.toLowerCase()}`, undefined, thabo.token)
    expect(byNumber.status).toBe(200)
    expect(byNumber.body).toEqual({
      number: policy.number,
      holderFirstName: 'Lerato',
      packageName: 'EcoSure Standard',
      cover: 'family',
      premium: 84,
      nextDue: addDays(todayMaseru(), -40),
      status: 'lapsed',
    })
    for (const ref of ['62000021', '26662000021', encodeURIComponent('+26662000021')]) {
      expect((await t.call('GET', `/v1/ecosure/policies/lookup?ref=${ref}`, undefined, thabo.token)).body.number).toBe(policy.number)
    }
    expect((await t.call('GET', '/v1/ecosure/policies/lookup?ref=ES-999999', undefined, thabo.token)).body.error.code).toBe('NOT_FOUND')
    expect((await t.call('GET', `/v1/ecosure/policies/lookup?ref=${N.palesa.slice(1)}`, undefined, thabo.token)).body.error.code).toBe('NOT_FOUND')
  })

  it('anyone can pay a policy; a lapsed policy restarts from today', async () => {
    const before = await balanceOf(t, thabo.token)
    expect((await t.call('POST', '/v1/ecosure/payments', { policyNumber: policy.number, months: 2, pin: '0000' }, thabo.token)).body.error.code).toBe('WRONG_PIN')
    const r = await t.call('POST', '/v1/ecosure/payments', { policyNumber: policy.number, months: 2, pin: '1234' }, thabo.token)
    expect(r.status).toBe(200)
    expect(r.body.payment).toMatchObject({ policyNumber: policy.number, holderFirstName: 'Lerato', amount: 168, months: 2, payerName: 'Thabo' })
    expect(r.body.money).toMatchObject({ balance: before - 168, transaction: { kind: 'ecosure', amount: -168 } })
    const mine = (await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body[0]
    expect(mine).toMatchObject({ status: 'active', nextDue: addMonths(todayMaseru(), 2) })
    expect((await ecosureChat(lerato.token)).text).toContain(`Thabo paid M168.00 towards your EcoSure cover ${policy.number}`)
    expect((await ecosureChat(thabo.token)).text).toContain('Payment received')

    // Not lapsed: the months continue from the paid-up date.
    const own = await t.call('POST', '/v1/ecosure/payments', { policyNumber: policy.number, pin: '1234' }, lerato.token)
    expect(own.status).toBe(200)
    expect((await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body[0].nextDue).toBe(addMonths(addMonths(todayMaseru(), 2), 1))

    expect((await t.call('POST', '/v1/ecosure/payments', { policyNumber: 'ES-999999', pin: '1234' }, thabo.token)).body.error.code).toBe('NOT_FOUND')
    expect((await t.call('POST', '/v1/ecosure/payments', { policyNumber: policy.number, months: 13, pin: '1234' }, thabo.token)).body.error.code).toBe('VALIDATION')
  })

  it('lists payments made by me or for my policies', async () => {
    const forLerato = (await t.call('GET', '/v1/ecosure/payments', undefined, lerato.token)).body
    expect(forLerato.map((p: any) => [p.payerName, p.amount])).toEqual([
      ['Lerato Mokhothu', 84],
      ['Thabo', 168],
      ['Lerato Mokhothu', 84],
    ])
    const byThabo = (await t.call('GET', '/v1/ecosure/payments', undefined, thabo.token)).body
    expect(byThabo).toHaveLength(1)
    expect((await t.call('GET', '/v1/ecosure/payments', undefined, palesa.token)).body).toEqual([])
  })
})

describe('EcoSure: members and changes', () => {
  it('adds and removes dependants on family cover only', async () => {
    const add = await t.call('POST', `/v1/ecosure/policies/${policy.id}/members`, { name: 'Neo Mokhothu', relationship: 'child', dob: '2015-03-02' }, lerato.token)
    expect(add.status).toBe(201)
    expect(add.body.members.map((m: any) => [m.name, m.relationship])).toEqual([
      ['Lerato Mokhothu', 'main'],
      ['Neo Mokhothu', 'child'],
    ])
    const spouse = await t.call('POST', `/v1/ecosure/policies/${policy.id}/members`, { name: 'Tumelo', relationship: 'spouse' }, lerato.token)
    expect(spouse.body.members).toHaveLength(3)
    expect((await t.call('POST', `/v1/ecosure/policies/${policy.id}/members`, { name: 'X', relationship: 'main' }, lerato.token)).body.error.code).toBe('VALIDATION')
    // Someone else's policy is invisible.
    expect((await t.call('POST', `/v1/ecosure/policies/${policy.id}/members`, { name: 'X', relationship: 'child' }, thabo.token)).body.error.code).toBe('NOT_FOUND')
    // Single cover has no dependants.
    expect((await t.call('POST', `/v1/ecosure/policies/${mmePolicy.id}/members`, { name: 'X', relationship: 'child' }, mme.token)).body.error.code).toBe('VALIDATION')

    const main = policy.members[0].id
    expect((await t.call('DELETE', `/v1/ecosure/policies/${policy.id}/members/${main}`, undefined, lerato.token)).body.error.code).toBe('VALIDATION')
    const tumelo = spouse.body.members.find((m: any) => m.name === 'Tumelo').id
    const del = await t.call('DELETE', `/v1/ecosure/policies/${policy.id}/members/${tumelo}`, undefined, lerato.token)
    expect(del.status).toBe(200)
    expect(del.body.members.map((m: any) => m.name)).toEqual(['Lerato Mokhothu', 'Neo Mokhothu'])
    expect((await t.call('DELETE', `/v1/ecosure/policies/${policy.id}/members/${tumelo}`, undefined, lerato.token)).body.error.code).toBe('NOT_FOUND')
  })

  it('changes package within the same cover and the beneficiary', async () => {
    const r = await t.call('PATCH', `/v1/ecosure/policies/${policy.id}`, { productCode: 'FUN-PREM', beneficiaryName: 'Thabo', beneficiaryMsisdn: N.thabo }, lerato.token)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ productCode: 'FUN-PREM', packageName: 'EcoSure Premium', cover: 'family', premium: 140, beneficiary: { name: 'Thabo', msisdn: N.thabo } })
    expect((await ecosureChat(lerato.token)).text).toContain('EcoSure Premium Family cover')
    expect((await t.call('PATCH', `/v1/ecosure/policies/${policy.id}`, { productCode: 'ST-MOTOR' }, lerato.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('PATCH', `/v1/ecosure/policies/${policy.id}`, { beneficiaryName: '' }, lerato.token)).body.beneficiary).toBeUndefined()
  })

  it('migrating to single removes the dependants; back to family keeps the package', async () => {
    const single = await t.call('POST', `/v1/ecosure/policies/${policy.id}/migrate`, { cover: 'single' }, lerato.token)
    expect(single.status).toBe(200)
    expect(single.body).toMatchObject({ cover: 'single', premium: 100, packageName: 'EcoSure Premium' })
    expect(single.body.members.map((m: any) => m.relationship)).toEqual(['main'])
    expect((await t.call('POST', `/v1/ecosure/policies/${policy.id}/migrate`, { cover: 'single' }, lerato.token)).body.error.code).toBe('VALIDATION')
    const family = await t.call('POST', `/v1/ecosure/policies/${policy.id}/migrate`, { cover: 'family' }, lerato.token)
    expect(family.body).toMatchObject({ cover: 'family', premium: 140 })
    expect(family.body.members).toHaveLength(1)
    const neo = await t.call('POST', `/v1/ecosure/policies/${policy.id}/members`, { name: 'Neo Mokhothu', relationship: 'child', dob: '2015-03-02' }, lerato.token)
    policy = neo.body
  })
})

describe('EcoSure: uploads', () => {
  it('accepts photos and PDFs up to 10 MB', async () => {
    const png = await upload(lerato.token)
    expect(png.status).toBe(201)
    expect(png.body).toEqual({ id: expect.any(String), fileName: 'doc.png', size: PNG.length })
    expect((await upload(lerato.token, PDF, 'application/pdf', 'letter.pdf')).status).toBe(201)
    expect((await upload(lerato.token, PNG, 'text/plain' as any)).body.error.code).toBe('VALIDATION')
    // The content must match its type.
    expect((await upload(lerato.token, PDF, 'image/png')).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/v1/ecosure/uploads', { fileName: 'x.png', contentType: 'image/png', base64: '***' }, lerato.token)).body.error.code).toBe('VALIDATION')
    const big = Buffer.alloc(10 * 1024 * 1024 + 1)
    PDF.copy(big)
    const tooBig = await upload(lerato.token, big, 'application/pdf', 'big.pdf')
    expect(tooBig.status).toBe(400)
    expect(tooBig.body.error.message).toMatch(/10 MB/)
  })

  it('deletes unused uploads after 24 hours', async () => {
    const old = await uploadId(lerato.token)
    await t.server.db.query(`UPDATE ecosure_uploads SET created_at = now() - interval '25 hours' WHERE id = $1`, [old])
    await uploadId(lerato.token)
    expect(await t.server.db.query('SELECT id FROM ecosure_uploads WHERE id = $1', [old])).toEqual([])
  })
})

describe('EcoSure: claims', () => {
  let claim: any
  const docs = async (cause: 'natural' | 'unnatural' | 'undetermined', token = lerato.token) =>
    Promise.all(requiredClaimDocuments(FUNERAL_DOCS, cause).map(async (label) => ({ label, uploadId: await uploadId(token, `${label}.png`) })))
  const neo = () => policy.members.find((m: any) => m.name === 'Neo Mokhothu').id
  const claimBody = async (over: Record<string, unknown> = {}) => ({
    policyId: policy.id,
    memberId: neo(),
    dateOfDeath: addDays(todayMaseru(), -3),
    cause: 'natural',
    documents: await docs('natural'),
    pin: '1234',
    ...over,
  })
  const submit = async (body: unknown, token = lerato.token) => t.call('POST', '/v1/ecosure/claims', body, token)

  it('validates documents by cause, the member and the PIN', async () => {
    const body = await claimBody()
    const missing = await submit({ ...body, documents: body.documents.slice(0, 5) })
    expect(missing.body.error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('Medical certificate (natural cause)') })
    const police = { label: 'Police report (unnatural cause)', uploadId: await uploadId(lerato.token) }
    expect((await submit({ ...body, documents: [...body.documents, police] })).body.error.code).toBe('VALIDATION')
    const theirs = { label: 'Deceased ID copy', uploadId: await uploadId(thabo.token) }
    expect((await submit({ ...body, documents: [theirs, ...body.documents.slice(1)] })).body.error.code).toBe('VALIDATION')
    expect((await submit({ ...body, memberId: mmePolicy.members[0].id })).body.error.code).toBe('VALIDATION')
    expect((await submit({ ...body, policyId: mmePolicy.id })).body.error.code).toBe('NOT_FOUND')
    expect((await submit({ ...body, dateOfDeath: addDays(todayMaseru(), 2) })).body.error.code).toBe('VALIDATION')
    expect((await submit({ ...body, pin: '0000' })).body.error.code).toBe('WRONG_PIN')
    expect((await t.call('GET', '/v1/ecosure/claims', undefined, lerato.token)).body).toEqual([])
  })

  it('submits a claim and tells the holder in the EcoSure chat', async () => {
    const r = await submit(await claimBody())
    expect(r.status).toBe(201)
    claim = r.body
    expect(claim).toMatchObject({
      reference: expect.stringMatching(/^CLM-\d{4}-\d{5}$/),
      policyNumber: policy.number,
      member: { id: neo(), name: 'Neo Mokhothu', relationship: 'child' },
      cause: 'natural',
      status: 'submitted',
    })
    expect(claim.documents.map((d: any) => d.label)).toEqual(requiredClaimDocuments(FUNERAL_DOCS, 'natural'))
    expect(claim.steps.map((s: any) => [s.label, s.done])).toEqual([
      ['Submitted', true],
      ['Documents verified', false],
      ['Under assessment', false],
      ['Decision and payout', false],
    ])
    expect(claim.steps[0].at).toBe(claim.createdAt)
    expect((await ecosureChat(lerato.token)).text).toContain(`We received your claim ${claim.reference}`)
    expect((await submit(await claimBody())).body.error.code).toBe('CONFLICT')
    expect((await t.call('GET', '/v1/ecosure/claims', undefined, lerato.token)).body).toEqual([claim])
    expect((await t.call('GET', '/v1/ecosure/claims', undefined, thabo.token)).body).toEqual([])
  })

  it('needs active or grace cover', async () => {
    await setPaidUntil(mmePolicy.number, addDays(todayMaseru(), -60))
    const r = await submit(
      { policyId: mmePolicy.id, memberId: mmePolicy.members[0].id, dateOfDeath: todayMaseru(), cause: 'natural', documents: await docs('natural', mme.token), pin: '1234' },
      mme.token,
    )
    expect(r.body.error.code).toBe('CONFLICT')
    await setPaidUntil(mmePolicy.number, addMonths(todayMaseru(), 1))
  })

  it('back office: support is read-only; documents can be opened', async () => {
    const decide = (body: unknown, token = admin) => t.call('POST', `/admin/v1/ecosure/claims/${claim.id}/decision`, body, token)
    expect((await decide({ action: 'verify_documents' }, support)).body.error.code).toBe('FORBIDDEN')
    const list = await t.call('GET', '/admin/v1/ecosure/claims?status=submitted', undefined, support)
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({ total: 1, page: 1, items: [{ reference: claim.reference, holder: { id: lerato.user.id, name: 'Lerato Mokhothu' } }] })
    const file = await t.server.app.inject({ method: 'GET', url: `/admin/v1/ecosure/claims/${claim.id}/documents/0`, headers: { authorization: `Bearer ${support}` } })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('image/png')
    expect(Buffer.from(file.rawPayload).equals(PNG)).toBe(true)
    expect((await t.call('GET', `/admin/v1/ecosure/claims/${claim.id}/documents/9`, undefined, admin)).status).toBe(404)
    expect((await t.call('GET', `/admin/v1/ecosure/claims/${claim.id}/documents/0`, undefined, lerato.token)).status).toBe(401)
  })

  it('back office: verify → assess → approve pays into the holder’s wallet', async () => {
    const decide = (body: unknown) => t.call('POST', `/admin/v1/ecosure/claims/${claim.id}/decision`, body, admin)
    expect((await decide({ action: 'approve', payout: 100 })).body.error.code).toBe('CONFLICT')
    expect((await decide({ action: 'start_assessment' })).body.error.code).toBe('CONFLICT')
    const verified = await decide({ action: 'verify_documents' })
    expect(verified.body).toMatchObject({ status: 'documents_verified' })
    expect(verified.body.steps[1]).toMatchObject({ label: 'Documents verified', done: true, at: expect.any(String) })

    expect((await decide({ action: 'request_info' })).body.error.code).toBe('VALIDATION')
    const info = await decide({ action: 'request_info', reason: 'Please send a clearer death certificate' })
    expect(info.body).toMatchObject({ status: 'documents_verified', reason: 'Please send a clearer death certificate' })
    expect((await ecosureChat(lerato.token)).text).toContain('Please send a clearer death certificate')

    expect((await decide({ action: 'start_assessment' })).body.status).toBe('under_assessment')
    expect((await decide({ action: 'approve' })).body.error.code).toBe('VALIDATION')
    expect((await decide({ action: 'approve', payout: 0 })).body.error.code).toBe('VALIDATION')

    const before = await balanceOf(t, lerato.token)
    const approved = await decide({ action: 'approve', payout: 15000 })
    expect(approved.status).toBe(200)
    expect(approved.body).toMatchObject({ status: 'approved', payout: 15000 })
    expect(approved.body.steps.every((s: any) => s.done)).toBe(true)
    expect(await balanceOf(t, lerato.token)).toBe(before + 15000)
    const tx = (await t.call('GET', '/v1/transactions?limit=1', undefined, lerato.token)).body[0]
    expect(tx).toMatchObject({ kind: 'claim', amount: 15000, counterpartyName: 'EcoSure', description: `EcoSure claim payout · ${claim.reference}` })
    expect((await ecosureChat(lerato.token)).text).toBe(`Your claim ${claim.reference} was approved. M15,000.00 has been paid into your EcoCash wallet.`)
    expect((await decide({ action: 'reject', reason: 'x' })).body.error.code).toBe('CONFLICT')

    const audit = await t.call('GET', '/admin/v1/audit', undefined, admin)
    expect(audit.body.items[0]).toMatchObject({ action: 'ecosure.claim.approve', target: `claim:${claim.id}` })
    const adminTx = await t.call('GET', '/admin/v1/transactions?kind=claim', undefined, admin)
    expect(adminTx.body.items[0]).toMatchObject({ kind: 'claim', amount: 15000, from: null })
  })

  it('back office: reject needs a reason and tells the holder', async () => {
    const spouse = await t.call('POST', `/v1/ecosure/policies/${policy.id}/members`, { name: 'Tumelo', relationship: 'spouse' }, lerato.token)
    const memberId = spouse.body.members.find((m: any) => m.name === 'Tumelo').id
    const r = await submit({ ...(await claimBody({ memberId, cause: 'unnatural' })), documents: await docs('unnatural') })
    expect(r.status).toBe(201)
    const decide = (body: unknown) => t.call('POST', `/admin/v1/ecosure/claims/${r.body.id}/decision`, body, admin)
    expect((await decide({ action: 'reject' })).body.error.code).toBe('VALIDATION')
    const rejected = await decide({ action: 'reject', reason: 'The police report does not match' })
    expect(rejected.body).toMatchObject({ status: 'rejected', reason: 'The police report does not match' })
    expect(rejected.body.steps.at(-1).done).toBe(true)
    expect((await ecosureChat(lerato.token)).text).toContain('was not approved. Reason: The police report does not match')
  })
})

describe('EcoSure: quotes', () => {
  const quote = (body: Record<string, unknown>, token = lerato.token) => t.call('POST', '/v1/ecosure/quotes', { answers: {}, documents: {}, consent: true, ...body }, token)

  it('fixed-price products are priced at once', async () => {
    const documents = {
      'Business licence': await uploadId(lerato.token),
      'Valid tax clearance certificate': await uploadId(lerato.token),
      'Director’s national ID or passport': await uploadId(lerato.token),
    }
    const answers = { 'Nature of the business': 'Spaza shop' }
    expect((await quote({ productCode: 'ST-SME', answers, documents })).body.error.code).toBe('VALIDATION') // no option
    expect((await quote({ productCode: 'ST-SME', option: 'Small business', answers, documents, consent: false })).body.error.code).toBe('VALIDATION')
    expect((await quote({ productCode: 'ST-SME', option: 'Small business', answers: {}, documents })).body.error.code).toBe('VALIDATION')
    const withoutLicence = Object.fromEntries(Object.entries(documents).filter(([label]) => label !== 'Business licence'))
    expect((await quote({ productCode: 'ST-SME', option: 'Small business', answers, documents: withoutLicence })).body.error.message).toContain('Business licence')
    expect((await quote({ productCode: 'FUN-STD' })).body.error.code).toBe('VALIDATION')

    const r = await quote({ productCode: 'ST-SME', option: 'Small business', answers, documents })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({
      reference: expect.stringMatching(/^Q-\d{4}-\d{6}$/),
      productCode: 'ST-SME',
      productName: 'SMEs – Mphatlalatsane',
      option: 'Small business',
      status: 'priced',
      monthlyPremium: 560,
    })
    expect(r.body.documents).toHaveLength(3)
    const days = (Date.parse(r.body.expiresAt) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
    expect(r.body.answers).toBeUndefined()
  })

  it('quoted products wait for staff, who price them', async () => {
    const reg = await uploadId(lerato.token, 'vat11.pdf')
    const answers = { 'Vehicle description': 'White hatchback', 'Vehicle model': 'Toyota Vitz 2016', Use: 'private', 'Is a tracker installed?': 'yes', 'Any previous claims?': 'No' }
    const base = { productCode: 'ST-MOTOR', answers, documents: { 'Registration papers / VAT11': reg } }
    expect((await quote(base)).body.error.code).toBe('VALIDATION') // contact needed
    const contact = { contactName: 'Lerato Mokhothu', msisdn: '62000021' }
    expect((await quote({ ...base, ...contact, documents: {} })).body.error.code).toBe('VALIDATION')
    expect((await quote({ ...base, ...contact, answers: { ...answers, Use: 'Racing' } })).body.error.code).toBe('VALIDATION')
    expect((await quote({ ...base, ...contact, answers: { ...answers, 'Is a tracker installed?': 'maybe' } })).body.error.code).toBe('VALIDATION')
    expect((await quote({ ...base, ...contact, answers: { ...answers, Colour: 'red' } })).body.error.code).toBe('VALIDATION')
    expect((await quote({ ...base, ...contact, documents: { 'Registration papers / VAT11': await uploadId(thabo.token) } })).body.error.code).toBe('VALIDATION')
    expect((await quote({ productCode: 'ST-CONTENTS', answers: { 'Estimated replacement value (M)': 'lots' }, ...contact })).body.error.code).toBe('VALIDATION')

    const r = await quote({ ...base, ...contact })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ productCode: 'ST-MOTOR', status: 'submitted', documents: [{ label: 'Registration papers / VAT11', fileName: 'vat11.pdf' }] })
    expect(r.body.monthlyPremium).toBeUndefined()
    expect((await ecosureChat(lerato.token)).text).toContain(`We received your quote request ${r.body.reference}`)

    const list = await t.call('GET', '/admin/v1/ecosure/quotes?status=submitted', undefined, support)
    expect(list.body.items).toEqual([
      expect.objectContaining({
        reference: r.body.reference,
        contactName: 'Lerato Mokhothu',
        msisdn: N.lerato,
        answers: { ...answers, Use: 'Private', 'Is a tracker installed?': 'Yes' },
      }),
    ])
    const doc = await t.server.app.inject({ method: 'GET', url: `/admin/v1/ecosure/quotes/${r.body.reference}/documents/0`, headers: { authorization: `Bearer ${support}` } })
    expect(doc.statusCode).toBe(200)

    const price = (body: unknown, token = admin) => t.call('POST', `/admin/v1/ecosure/quotes/${r.body.reference}/price`, body, token)
    expect((await price({ monthlyPremium: 450.5 }, support)).body.error.code).toBe('FORBIDDEN')
    expect((await price({ monthlyPremium: 0 })).body.error.code).toBe('VALIDATION')
    const priced = await price({ monthlyPremium: 450.5 })
    expect(priced.status).toBe(200)
    expect(priced.body).toMatchObject({ status: 'priced', monthlyPremium: 450.5, expiresAt: expect.any(String) })
    expect((await price({ monthlyPremium: 400 })).body.error.code).toBe('CONFLICT')
    expect((await ecosureChat(lerato.token)).text).toContain(`Your EcoSure quote ${r.body.reference} for Motor Vehicle is ready: M450.50 a month`)
    const mine = (await t.call('GET', '/v1/ecosure/quotes', undefined, lerato.token)).body
    expect(mine.map((q: any) => [q.productCode, q.status])).toEqual([
      ['ST-MOTOR', 'priced'],
      ['ST-SME', 'priced'],
    ])
    expect((await t.call('GET', '/admin/v1/audit', undefined, admin)).body.items[0]).toMatchObject({ action: 'ecosure.quote.price' })

    // Expiry is derived.
    await t.server.db.query(`UPDATE ecosure_quotes SET expires_at = now() - interval '1 minute' WHERE reference = $1`, [r.body.reference])
    expect((await t.call('GET', '/v1/ecosure/quotes', undefined, lerato.token)).body[0].status).toBe('expired')
  })
})

describe('EcoSure: sponsorships', () => {
  let sp: any
  const sponsor = (msisdn: string, token: string) => t.call('POST', '/v1/ecosure/sponsorships', { msisdn }, token)
  const act = (id: string, action: string, token: string) => t.call('POST', `/v1/ecosure/sponsorships/${id}/${action}`, undefined, token)

  it('asks the member to accept in their EcoSure chat', async () => {
    expect((await sponsor(N.lerato, lerato.token)).body.error.code).toBe('VALIDATION')
    expect((await sponsor(N.palesa, thabo.token)).body.error.code).toBe('NOT_FOUND') // no policy
    expect((await sponsor('+26658999999', thabo.token)).body.error.code).toBe('NOT_REGISTERED')
    const r = await sponsor('62000021', thabo.token)
    expect(r.status).toBe(201)
    sp = r.body
    expect(sp).toMatchObject({
      status: 'awaiting',
      sponsor: { name: 'Thabo' },
      member: { name: 'Lerato Mokhothu', msisdn: N.lerato },
      policy: { number: policy.number, holderFirstName: 'Lerato' },
    })
    expect((await ecosureChat(lerato.token)).text).toBe(`Thabo would like to pay for your EcoSure cover ${policy.number}. Open EcoSure to accept or decline.`)
    expect((await sponsor(N.lerato, thabo.token)).body.error.code).toBe('CONFLICT')
    expect((await sponsor(N.lerato, mme.token)).body.error.code).toBe('CONFLICT')
  })

  it('the member accepts; the policy shows its sponsor until cancelled', async () => {
    expect((await act(sp.id, 'accept', thabo.token)).body.error.code).toBe('FORBIDDEN')
    expect((await act(sp.id, 'accept', palesa.token)).body.error.code).toBe('NOT_FOUND')
    const ok = await act(sp.id, 'accept', lerato.token)
    expect(ok.body.status).toBe('active')
    expect((await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body[0].sponsoredBy).toEqual({ name: 'Thabo' })
    expect((await ecosureChat(thabo.token)).text).toContain('Lerato Mokhothu accepted')
    const lists = await t.call('GET', '/v1/ecosure/sponsorships', undefined, thabo.token)
    expect(lists.body.mine.map((s: any) => s.status)).toEqual(['active'])
    expect(lists.body.forMe).toEqual([])
    expect((await t.call('GET', '/v1/ecosure/sponsorships', undefined, lerato.token)).body.forMe.map((s: any) => s.id)).toEqual([sp.id])
    expect((await act(sp.id, 'decline', lerato.token)).body.error.code).toBe('CONFLICT')

    const cancelled = await act(sp.id, 'cancel', thabo.token)
    expect(cancelled.body.status).toBe('cancelled')
    expect((await ecosureChat(lerato.token)).text).toContain('Thabo cancelled the sponsorship')
    expect((await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body[0].sponsoredBy).toBeUndefined()
    expect((await act(sp.id, 'cancel', lerato.token)).body.error.code).toBe('CONFLICT')
  })

  it('the member can decline a new request', async () => {
    const r = await sponsor(N.lerato, mme.token)
    expect(r.status).toBe(201)
    const declined = await act(r.body.id, 'decline', lerato.token)
    expect(declined.body.status).toBe('declined')
    expect((await ecosureChat(mme.token)).text).toContain('declined')
  })
})

describe('EcoSure back office: policies', () => {
  it('searches policies and filters by status (support may read)', async () => {
    const all = await t.call('GET', '/admin/v1/ecosure/policies', undefined, support)
    expect(all.status).toBe(200)
    expect(all.body.total).toBe(2)
    const byName = await t.call('GET', '/admin/v1/ecosure/policies?query=lerato', undefined, support)
    expect(byName.body.items.map((p: any) => p.number)).toEqual([policy.number])
    expect((await t.call('GET', `/admin/v1/ecosure/policies?query=${mmePolicy.number}`, undefined, support)).body.total).toBe(1)
    await setPaidUntil(mmePolicy.number, addDays(todayMaseru(), -10))
    const grace = await t.call('GET', '/admin/v1/ecosure/policies?status=grace', undefined, admin)
    expect(grace.body.items.map((p: any) => p.number)).toEqual([mmePolicy.number])
    expect((await t.call('GET', '/admin/v1/ecosure/policies?status=lapsed', undefined, admin)).body.total).toBe(0)
  })
})
