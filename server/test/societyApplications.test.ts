import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let palesa: { token: string; user: any }
let thabo: { token: string; user: any }
let admin: string

beforeAll(async () => {
  t = await startTestServer()
  palesa = await t.login(N.palesa)
  thabo = await t.login(N.thabo)
  admin = await t.adminLogin()
})
afterAll(() => t.close())

const applyBody = { name: 'Ha Mafefooane Motšelo', kind: 'motselo', contribution: 150, approvalsRequired: 2, executives: [N.thabo] }

describe('applying for a society', () => {
  it('checks the application', async () => {
    const bad = (body: object) => t.call('POST', '/v1/society-applications', { ...applyBody, ...body }, palesa.token)
    expect((await bad({ contribution: undefined })).body.error.code).toBe('VALIDATION')
    expect((await bad({ approvalsRequired: 3 })).body.error.code).toBe('VALIDATION')
    expect((await bad({ executives: [N.palesa] })).body.error.code).toBe('VALIDATION')
  })

  it('applied in the app, approved in the portal, opened when the SIM is collected', async () => {
    const a = await t.call('POST', '/v1/society-applications', applyBody, palesa.token)
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ status: 'pending', kind: 'motselo', contribution: 150, reference: expect.stringMatching(/^MKH-\d{6}$/) })
    expect(a.body.executives.map((u: any) => u.id)).toEqual([palesa.user.id, thabo.user.id])
    const id = a.body.id

    // The SIM can't be recorded before approval.
    expect((await t.call('POST', `/admin/v1/society-applications/${id}/activate`, { simNumber: '+26663999001' }, admin)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', `/admin/v1/society-applications/${id}/approve`, {}, admin)).body.status).toBe('approved')
    // The applicant can't cancel once approved; the portal can't decide twice.
    expect((await t.call('POST', `/v1/society-applications/${id}/cancel`, {}, palesa.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', `/admin/v1/society-applications/${id}/reject`, { reason: 'x' }, admin)).body.error.code).toBe('CONFLICT')
    // A number that already has a wallet is not a new Mokhatlo SIM.
    expect((await t.call('POST', `/admin/v1/society-applications/${id}/activate`, { simNumber: N.lerato }, admin)).body.error.code).toBe('CONFLICT')

    const done = await t.call('POST', `/admin/v1/society-applications/${id}/activate`, { simNumber: '63999001', code: '5150' }, admin)
    expect(done.body).toMatchObject({ status: 'active', simNumber: '+26663999001', societyCode: '5150' })
    const mine = (await t.call('GET', '/v1/societies', undefined, thabo.token)).body.find((s: any) => s.code === '5150')
    expect(mine).toMatchObject({ name: 'Ha Mafefooane Motšelo', kind: 'motselo', contribution: 150, myRole: 'signatory', memberCount: 2 })
    expect((await t.call('GET', '/v1/society-applications', undefined, palesa.token)).body[0].status).toBe('active')
  })

  it('rejects with a reason, cancels while pending, and limits open applications', async () => {
    const one = (await t.call('POST', '/v1/society-applications', { ...applyBody, name: 'One' }, palesa.token)).body
    const rej = await t.call('POST', `/admin/v1/society-applications/${one.id}/reject`, { reason: 'Bring the constitution' }, admin)
    expect(rej.body).toMatchObject({ status: 'rejected', reason: 'Bring the constitution' })

    const two = (await t.call('POST', '/v1/society-applications', { ...applyBody, name: 'Two' }, palesa.token)).body
    expect((await t.call('POST', `/v1/society-applications/${two.id}/cancel`, {}, thabo.token)).status).toBe(404)
    expect((await t.call('POST', `/v1/society-applications/${two.id}/cancel`, {}, palesa.token)).body.status).toBe('cancelled')

    // At most 2 open (pending or approved) at once by default.
    await t.call('POST', '/v1/society-applications', { ...applyBody, name: 'Three' }, palesa.token)
    await t.call('POST', '/v1/society-applications', { ...applyBody, name: 'Four' }, palesa.token)
    expect((await t.call('POST', '/v1/society-applications', { ...applyBody, name: 'Five' }, palesa.token)).body.error.code).toBe('CONFLICT')
  })

  it('the portal can close applications in the app', async () => {
    const s = (await t.call('GET', '/admin/v1/society-apply-settings', undefined, admin)).body
    expect(s.enabled).toBe(true)
    await t.call('PUT', '/admin/v1/society-apply-settings', { ...s, enabled: false }, admin)
    expect((await t.call('POST', '/v1/society-applications', { ...applyBody, name: 'Six' }, thabo.token)).body.error.code).toBe('VALIDATION')
    expect((await t.call('GET', '/v1/society-apply-settings', undefined, thabo.token)).body.enabled).toBe(false)
  })
})
