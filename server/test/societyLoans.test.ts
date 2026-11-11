import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sweepLoans } from '../src/services/societyLoans'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
let thabo: { token: string; user: any }
let palesa: { token: string; user: any }
let molemi: string // Lerato + Mme are executives (2 approvals); Thabo, Palesa members; M330

const pin = '1234'
let n = 0
const loans = (token: string) => t.call('GET', `/v1/societies/${molemi}/loans`, undefined, token)
const ask = (body: object, token = palesa.token) => t.call('POST', `/v1/societies/${molemi}/loans`, { amount: 100, months: 2, pin, clientId: `l-${n++}`, ...body }, token)
const decide = (id: string, action: 'approve' | 'reject', token: string) => t.call('POST', `/v1/society-loans/${id}/${action}`, { pin }, token)
const repay = (id: string, amount: number, token = palesa.token) => t.call('POST', `/v1/society-loans/${id}/repay`, { amount, pin }, token)
const terms = { enabled: true, interestPercent: 10, maxMonths: 3, maxAmount: 200 }

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
  thabo = await t.login(N.thabo)
  palesa = await t.login(N.palesa)
  molemi = (await t.call('GET', '/v1/societies', undefined, lerato.token)).body.find((s: any) => s.code === '7896').id
})
afterAll(() => t.close())

describe('society loans', () => {
  it('the executives set the society’s own terms; loans are off until they do', async () => {
    expect((await ask({})).body.error.code).toBe('VALIDATION')
    expect((await t.call('PUT', `/v1/societies/${molemi}/loan-settings`, terms, thabo.token)).status).toBe(403)
    expect((await t.call('PUT', `/v1/societies/${molemi}/loan-settings`, { ...terms, maxMonths: 30 }, lerato.token)).status).toBe(400)
    // The largest loan is a cap, not a payment: above the single-payment limit is fine (proposed, then withdrawn by rejection).
    const big = await t.call('PUT', `/v1/societies/${molemi}/loan-settings`, { ...terms, maxAmount: 250000 }, lerato.token)
    expect(big.status).toBe(200)
    expect(big.body.pendingTerms.settings.maxAmount).toBe(250000)
    expect((await t.call('POST', `/v1/society-loan-terms/${big.body.pendingTerms.id}/reject`, { pin: '1234' }, mme.token)).status).toBe(200)
    // Lerato proposes; nothing changes until another executive approves.
    const r = await t.call('PUT', `/v1/societies/${molemi}/loan-settings`, terms, lerato.token)
    expect(r.body.settings.enabled).toBe(false)
    expect(r.body.pendingTerms).toMatchObject({ settings: terms, approvalsRequired: 2, canDecide: false, proposedBy: { id: lerato.user.id } })
    const changeId = r.body.pendingTerms.id
    expect((await t.call('PUT', `/v1/societies/${molemi}/loan-settings`, terms, mme.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', `/v1/society-loan-terms/${changeId}/approve`, { pin }, lerato.token)).body.error.message).toMatch(/Another executive/)
    expect((await t.call('POST', `/v1/society-loan-terms/${changeId}/approve`, { pin }, thabo.token)).status).toBe(403)
    expect((await loans(mme.token)).body.pendingTerms.canDecide).toBe(true)
    expect((await loans(thabo.token)).body.pendingTerms).toBeUndefined()
    const done = await t.call('POST', `/v1/society-loan-terms/${changeId}/approve`, { pin }, mme.token)
    expect(done.body.settings).toEqual(terms)
    expect(done.body.pendingTerms).toBeUndefined()

    // A rejected proposal changes nothing.
    const p = await t.call('PUT', `/v1/societies/${molemi}/loan-settings`, { ...terms, interestPercent: 50 }, mme.token)
    await t.call('POST', `/v1/society-loan-terms/${p.body.pendingTerms.id}/reject`, { pin }, lerato.token)
    expect((await loans(lerato.token)).body.settings).toEqual(terms)
  })

  it('a member asks within the terms; the executives approve and the society pays out', async () => {
    expect((await ask({ amount: 300 })).body.error.message).toMatch(/largest loan/)
    expect((await ask({ months: 4 })).body.error.code).toBe('VALIDATION')
    const before = await balanceOf(t, palesa.token)
    const a = await ask({ purpose: 'School uniform' })
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ status: 'pending', amount: 100, months: 2, interestPercent: 10, total: 120, outstanding: 120, approvalsRequired: 2, reference: expect.stringMatching(/^LN-\d{6}$/) })
    expect((await ask({})).body.error.code).toBe('CONFLICT') // one open loan at a time
    expect((await decide(a.body.id, 'approve', thabo.token)).status).toBe(403)

    // Members see only their own loans; executives see all of them and the report.
    expect((await loans(thabo.token)).body.loans).toHaveLength(0)
    expect((await loans(thabo.token)).body.report).toBeUndefined()
    expect((await loans(lerato.token)).body.loans[0].canDecide).toBe(true)

    expect((await decide(a.body.id, 'approve', lerato.token)).body.status).toBe('pending')
    const done = await decide(a.body.id, 'approve', mme.token)
    expect(done.body.status).toBe('active')
    expect(new Date(done.body.dueAt).getTime()).toBeGreaterThan(Date.now() + 55 * 24 * 3600_000)
    expect(await balanceOf(t, palesa.token)).toBe(before + 100)
  })

  it('the borrower repays in parts; the society tracks it to the end', async () => {
    const [loan] = (await loans(palesa.token)).body.loans
    expect((await repay(loan.id, 50)).status).toBe(200)
    expect((await repay(loan.id, 80)).body.error.message).toMatch(/You owe M70/)
    expect((await repay(loan.id, 10, thabo.token)).status).toBe(404)
    await repay(loan.id, 70)
    const after = (await loans(palesa.token)).body.loans[0]
    expect(after).toMatchObject({ status: 'repaid', repaid: 120, outstanding: 0 })
    expect(after.repayments.map((r: any) => r.amount)).toEqual([50, 70])
    expect((await loans(lerato.token)).body.report).toMatchObject({ lentTotal: 100, interestTotal: 20, repaidTotal: 120, outstanding: 0, activeCount: 0 })
  })

  it('an executive never approves their own loan; the others do', async () => {
    const a = await ask({ amount: 50, months: 1 }, lerato.token)
    expect(a.body.approvalsRequired).toBe(1) // only Mme is left to approve
    expect((await decide(a.body.id, 'approve', lerato.token)).status).toBe(403)
    expect((await decide(a.body.id, 'approve', mme.token)).body.status).toBe('active')
  })

  it('reports overdue loans and reminds the borrower and the executives', async () => {
    const [mine] = (await loans(lerato.token)).body.loans.filter((l: any) => l.borrower.id === lerato.user.id)
    await t.server.db.query(`UPDATE society_loans SET due_at = now() - interval '2 days' WHERE id = $1`, [mine.id])
    const view = await loans(mme.token)
    expect(view.body.loans.find((l: any) => l.id === mine.id).overdue).toBe(true)
    expect(view.body.report).toMatchObject({ overdueCount: 1, overdue: 55, outstanding: 55 })
    expect((await sweepLoans(t.server.ctx)).late).toBe(1)
    expect((await sweepLoans(t.server.ctx)).late).toBe(0) // weekly, not every sweep
  })

  it('one rejection stops a loan; unapproved loans expire', async () => {
    const a = await ask({ amount: 20, months: 1 }, thabo.token)
    expect((await decide(a.body.id, 'reject', mme.token)).body).toMatchObject({ status: 'rejected', rejectedBy: { id: mme.user.id } })
    const b = await ask({ amount: 20, months: 1 }, thabo.token)
    await t.server.db.query(`UPDATE society_loans SET expires_at = now() - interval '1 minute' WHERE id = $1`, [b.body.id])
    expect((await decide(b.body.id, 'approve', mme.token)).body.error.code).toBe('CONFLICT')
    expect((await loans(thabo.token)).body.loans.find((l: any) => l.id === b.body.id).status).toBe('expired')
  })
})
