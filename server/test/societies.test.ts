import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let mme: { token: string; user: any }
let palesa: { token: string; user: any }
let molemi: string // Lerato + Mme sign; Thabo, Palesa members; M330
let digital: string // Thabo + Mme sign; Lerato member; M23.70

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  mme = await t.login(N.mme)
  palesa = await t.login(N.palesa)
  const list = (await t.call('GET', '/v1/societies', undefined, lerato.token)).body
  molemi = list.find((s: any) => s.code === '7896').id
  digital = list.find((s: any) => s.code === '7745').id
})
afterAll(() => t.close())

const pin = '1234'
let n = 0
const payout = (to: string, amount: number, token = lerato.token, id = molemi) =>
  t.call('POST', `/v1/societies/${id}/transfers`, { to, amount, pin, clientId: `p-${n++}`, note: 'Funeral support' }, token)
const decide = (transferId: string, action: 'approve' | 'reject', token: string) => t.call('POST', `/v1/society-transfers/${transferId}/${action}`, { pin }, token)

describe('society', () => {
  it('lists my societies with my role, balance and code', async () => {
    const list = (await t.call('GET', '/v1/societies', undefined, lerato.token)).body
    expect(list.map((s: any) => [s.code, s.name, s.kind, s.myRole, s.balance, s.memberCount])).toEqual([
      ['7745', 'Digital Transformation', 'society', 'member', 23.7, 3],
      ['7896', 'Molemi Burial Society', 'burial', 'signatory', 330, 4],
      ['4410', 'Motšelo oa Ha Abia', 'motselo', 'member', 400, 4],
    ])
    // Not a member: not found, so names don't leak.
    const cafe = await t.login(N.cafe, 'business')
    expect((await t.call('GET', `/v1/societies/${molemi}`, undefined, cafe.token)).status).toBe(404)
  })

  it('members pay in; only signatories manage members and pay out', async () => {
    const before = await balanceOf(t, lerato.token)
    const c = await t.call('POST', `/v1/societies/${digital}/contributions`, { amount: 50, pin }, lerato.token)
    expect(c.status).toBe(200)
    expect(c.body.balance).toBe(before - 50)
    const d = (await t.call('GET', `/v1/societies/${digital}`, undefined, lerato.token)).body
    expect(d.balance).toBe(73.7)
    expect(d.recent[0]).toMatchObject({ amount: 50, who: 'Lerato Mokhothu' })

    expect((await t.call('POST', `/v1/societies/${digital}/members`, { to: N.palesa }, lerato.token)).status).toBe(403)
    expect((await payout(N.palesa, 10, lerato.token, digital)).status).toBe(403)
    expect((await t.call('POST', `/v1/societies/${digital}/contributions`, { amount: 5, pin: '9999' }, lerato.token)).status).toBe(403)
  })

  it('add, promote and remove members; signatories never drop below the approvals needed', async () => {
    const added = await t.call('POST', `/v1/societies/${molemi}/members`, { to: '+26662103401' }, lerato.token)
    expect(added.body.error.code).toBe('VALIDATION') // Mme is a signatory: demoting would leave 1
    const cafeAdd = await t.call('POST', `/v1/societies/${molemi}/members`, { to: N.cafe }, lerato.token)
    expect(cafeAdd.status).toBe(200)
    expect(cafeAdd.body.members).toHaveLength(5)
    expect((await t.call('POST', `/v1/societies/${molemi}/members`, { to: N.cafe }, lerato.token)).body.error.code).toBe('CONFLICT')

    expect((await t.call('DELETE', `/v1/societies/${molemi}/members/${mme.user.id}`, undefined, lerato.token)).body.error.code).toBe('VALIDATION')
    const promoted = await t.call('POST', `/v1/societies/${molemi}/members`, { to: N.thabo, role: 'signatory' }, lerato.token)
    expect(promoted.body.members.find((m: any) => m.user.id === thabo.user.id).role).toBe('signatory')
    const cafeId = cafeAdd.body.members.find((m: any) => m.user.msisdn === N.cafe).user.id
    expect((await t.call('DELETE', `/v1/societies/${molemi}/members/${cafeId}`, undefined, lerato.token)).body.members).toHaveLength(4)
  })

  it('a payout waits for a second signatory, then pays', async () => {
    const before = await balanceOf(t, palesa.token)
    const p = await payout(N.palesa, 100)
    expect(p.status).toBe(201)
    expect(p.body).toMatchObject({ status: 'pending', amount: 100, approvalsRequired: 2, canDecide: false })
    expect(p.body.approvals).toHaveLength(1)
    expect(p.body.reference).toMatch(/^SOC-\d{6}$/)

    const mmeView = (await t.call('GET', '/v1/societies', undefined, mme.token)).body.find((s: any) => s.id === molemi)
    expect(mmeView.awaitingMe).toBe(1)
    expect((await decide(p.body.id, 'approve', lerato.token)).body.error.code).toBe('CONFLICT')
    expect((await decide(p.body.id, 'approve', palesa.token)).status).toBe(403) // a member, not a signatory

    const ok = await decide(p.body.id, 'approve', mme.token)
    expect(ok.body.status).toBe('paid')
    expect(await balanceOf(t, palesa.token)).toBe(before + 100)
    const d = (await t.call('GET', `/v1/societies/${molemi}`, undefined, lerato.token)).body
    expect(d.balance).toBe(230)
    expect(d.recent[0]).toMatchObject({ amount: -100, who: 'Palesa Letsie' })
  })

  it('one rejection stops a payout; payouts can’t exceed the balance; old ones expire', async () => {
    const r = await payout(N.palesa, 20)
    const rej = await decide(r.body.id, 'reject', mme.token)
    expect(rej.body).toMatchObject({ status: 'rejected', rejectedBy: { id: mme.user.id } })
    expect((await decide(r.body.id, 'approve', thabo.token)).body.error.code).toBe('CONFLICT')

    expect((await payout(N.palesa, 5000)).body.error.code).toBe('VALIDATION')

    const old = await payout(N.palesa, 10)
    await t.server.db.query(`UPDATE society_transfers SET expires_at = now() - interval '1 minute' WHERE id = $1`, [old.body.id])
    expect((await decide(old.body.id, 'approve', mme.token)).body.error.code).toBe('CONFLICT')
    const d = (await t.call('GET', `/v1/societies/${molemi}`, undefined, lerato.token)).body
    expect(d.transfers.find((x: any) => x.id === old.body.id).status).toBe('expired')
  })

  it('a Motšelo shows who paid this month; executives remind the rest', async () => {
    const mine = (await t.call('GET', '/v1/societies', undefined, lerato.token)).body
    const pot = mine.find((s: any) => s.code === '4410')
    expect(pot.contribution).toBe(200)
    const paid = async () => Object.fromEntries((await t.call('GET', `/v1/societies/${pot.id}`, undefined, lerato.token)).body.members.map((m: any) => [m.user.id, m.paidThisMonth]))
    expect(await paid()).toEqual({ [thabo.user.id]: true, [mme.user.id]: true, [lerato.user.id]: false, [palesa.user.id]: false })
    // Only executives remind, and only those who haven't paid (not themselves).
    expect((await t.call('POST', `/v1/societies/${pot.id}/remind`, {}, lerato.token)).status).toBe(403)
    expect((await t.call('POST', `/v1/societies/${pot.id}/remind`, {}, mme.token)).body).toEqual({ reminded: 2 })
    // Less than the contribution doesn't count as paid; topping up to it does.
    await t.call('POST', `/v1/societies/${pot.id}/contributions`, { amount: 150, pin }, lerato.token)
    expect((await paid())[lerato.user.id]).toBe(false)
    await t.call('POST', `/v1/societies/${pot.id}/contributions`, { amount: 50, pin }, lerato.token)
    expect((await paid())[lerato.user.id]).toBe(true)
    expect((await t.call('POST', `/v1/societies/${pot.id}/remind`, {}, mme.token)).body).toEqual({ reminded: 1 })
    // A society without a monthly contribution has no "paid this month".
    expect((await t.call('POST', `/v1/societies/${molemi}/remind`, {}, lerato.token)).body.error.code).toBe('VALIDATION')
  })

  it('the portal creates societies with signatories', async () => {
    const admin = await t.adminLogin()
    expect((await t.call('POST', '/admin/v1/societies', { name: 'EXILE', signatories: [N.lerato], approvalsRequired: 2 }, admin)).body.error.code).toBe('VALIDATION')
    expect((await t.call('POST', '/admin/v1/societies', { name: 'EXILE', code: '7896', signatories: [N.lerato, N.thabo], approvalsRequired: 2 }, admin)).body.error.code).toBe('CONFLICT')
    const c = await t.call('POST', '/admin/v1/societies', { name: 'EXILE', code: '9614', signatories: [N.lerato, N.thabo], approvalsRequired: 2 }, admin)
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ code: '9614', name: 'EXILE', balance: 0, signatories: 2, memberCount: 2 })
    const list = (await t.call('GET', '/admin/v1/societies', undefined, admin)).body
    expect(list.map((s: any) => s.code)).toContain('9614')
    expect((await t.call('GET', `/admin/v1/societies/${c.body.id}`, undefined, admin)).body.members).toHaveLength(2)
    expect((await t.call('GET', '/v1/societies', undefined, thabo.token)).body.map((s: any) => s.name)).toContain('EXILE')
    // A Motšelo needs its monthly amount.
    expect((await t.call('POST', '/admin/v1/societies', { name: 'Pot', kind: 'motselo', signatories: [N.lerato], approvalsRequired: 1 }, admin)).body.error.code).toBe('VALIDATION')
    const m = await t.call('POST', '/admin/v1/societies', { name: 'Pot', kind: 'motselo', contribution: 150, signatories: [N.lerato], approvalsRequired: 1 }, admin)
    expect(m.body).toMatchObject({ kind: 'motselo', contribution: 150 })
  })
})
