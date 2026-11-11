import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { equalShares } from '../src/services/splits'
import { balanceOf, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let palesa: { token: string; user: any }
let mme: { token: string; user: any }
let cafe: { token: string; user: any }
let group: string
let direct: string

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  palesa = await t.login(N.palesa)
  mme = await t.login(N.mme)
  cafe = await t.login(N.cafe, 'business')
  group = (await t.call('POST', '/v1/chats', { title: 'Dinner crew', memberMsisdns: [N.thabo, N.palesa, N.mme] }, lerato.token)).body.id
  direct = (await t.call('POST', '/v1/chats', { msisdn: N.thabo }, lerato.token)).body.id
})
afterAll(() => t.close())

let n = 0
const split = (body: Record<string, unknown>, token = lerato.token) =>
  t.call('POST', '/v1/splits', { chatId: group, clientId: `split-${n++}`, pin: '1234', ...body }, token)
const approve = (id: string, token: string, amount?: number) => t.call('POST', `/v1/splits/${id}/approve`, { pin: '1234', amount }, token)
const pay = (id: string, token: string, amount?: number) => t.call('POST', `/v1/requests/${id}/pay`, { pin: '1234', amount }, token)
const decline = (id: string, token: string) => t.call('POST', `/v1/requests/${id}/decline`, undefined, token)
const share = (m: any, userId: string) => m.request.split.shares.find((s: any) => s.userId === userId)
const view = async (id: string, token = lerato.token) => (await t.call('GET', '/v1/splits', undefined, token)).body.find((m: any) => m.id === id)
const setBalance = (userId: string, maloti: number) => t.server.db.query('UPDATE users SET balance_cents = $2 WHERE id = $1', [userId, Math.round(maloti * 100)])
const idle = () => t.server.splitSweeper.idle()

describe('split bill', () => {
  it('spreads spare cents to the first shares', () => {
    expect(equalShares(1000, 3)).toEqual([334, 333, 333])
    expect(equalShares(200, 2)).toEqual([100, 100])
  })

  it('each person approves; approval collects right away; the organiser’s cut counts as paid', async () => {
    const r = await split({
      method: 'equal',
      total: 100,
      note: 'Dinner',
      participants: [{ userId: thabo.user.id }, { userId: lerato.user.id }, { userId: mme.user.id }],
    })
    expect(r.status).toBe(201)
    expect(r.body.request).toMatchObject({ kind: 'split', amount: 100, paid: 33.34, status: 'pending', split: { method: 'equal', mode: 'organiser' } })
    expect(r.body.request.split.shares.map((s: any) => [s.userId, s.amount, s.status])).toEqual([
      [lerato.user.id, 33.34, 'paid'],
      [thabo.user.id, 33.33, 'awaiting'],
      [mme.user.id, 33.33, 'awaiting'],
    ])
    expect(share(r.body, thabo.user.id).approveBy).toBeTruthy()

    const before = await balanceOf(t, lerato.token)
    const a = await approve(r.body.id, thabo.token)
    expect(a.status).toBe(200)
    expect(share(a.body, thabo.user.id)).toMatchObject({ status: 'paid', paid: 33.33 })
    expect((await approve(r.body.id, thabo.token)).body.error.code).toBe('CONFLICT')
    expect((await decline(r.body.id, thabo.token)).body.error.code).toBe('CONFLICT')

    // Paying now with the PIN (before approving) also settles it.
    const p = await pay(r.body.id, mme.token)
    expect(p.body.transaction).toMatchObject({ kind: 'request', amount: -33.33 })
    expect(p.body.message.request).toMatchObject({ status: 'paid', paid: 100 })
    await idle()
    expect(await balanceOf(t, lerato.token)).toBeCloseTo(before + 66.66, 2)
  })

  it('short balance: takes what it can above the floor, then collects as money arrives', async () => {
    await setBalance(palesa.user.id, 50) // floor M20 → M30 to spare
    const r = await split({ method: 'specific', note: 'Groceries', participants: [{ userId: palesa.user.id, amount: 80 }] })
    const a = await approve(r.body.id, palesa.token)
    expect(share(a.body, palesa.user.id)).toMatchObject({ status: 'collecting', paid: 30, amount: 80 })
    expect(share(a.body, palesa.user.id).collectUntil).toBeTruthy()
    expect(await balanceOf(t, palesa.token)).toBe(20)

    // Money arrives: Thabo sends Palesa M40 → M40 collected straight away (M20 floor kept).
    const chat = (await t.call('POST', '/v1/chats', { msisdn: N.palesa }, thabo.token)).body.id
    const sent = await t.call('POST', '/v1/payments/send', { chatId: chat, toUserId: palesa.user.id, amount: 40, pin: '1234', kind: 'money', clientId: 'top-1' }, thabo.token)
    expect(sent.status).toBe(200)
    await idle()
    expect(share(await view(r.body.id), palesa.user.id)).toMatchObject({ status: 'collecting', paid: 70 })
    expect(await balanceOf(t, palesa.token)).toBe(20)

    // The sweeper is the backstop when money arrived some other way.
    await setBalance(palesa.user.id, 100)
    await t.server.splitSweeper.sweep()
    const done = await view(r.body.id)
    expect(share(done, palesa.user.id)).toMatchObject({ status: 'paid', paid: 80 })
    expect(done.request.status).toBe('paid')
    expect(await balanceOf(t, palesa.token)).toBe(90)
  })

  it('decline: the organiser moves it to someone else, or covers it', async () => {
    const r = await split({ method: 'equal', total: 60, participants: [{ userId: lerato.user.id }, { userId: thabo.user.id }, { userId: palesa.user.id }] })
    const d = await decline(r.body.id, thabo.token)
    expect(share(d.body, thabo.user.id).status).toBe('declined')
    expect(d.body.request.status).toBe('pending')

    // Only the organiser decides; only for problem shares; not to someone already in it.
    const resolve = (userId: string, body: any, token = lerato.token) => t.call('POST', `/v1/splits/${r.body.id}/shares/${userId}/resolve`, body, token)
    expect((await resolve(thabo.user.id, { action: 'cover' }, palesa.token)).status).toBe(403)
    expect((await resolve(palesa.user.id, { action: 'cover' })).body.error.code).toBe('CONFLICT')
    expect((await resolve(thabo.user.id, { action: 'reassign', userId: palesa.user.id })).body.error.code).toBe('VALIDATION')

    const moved = await resolve(thabo.user.id, { action: 'reassign', userId: mme.user.id })
    expect(moved.status).toBe(200)
    expect(share(moved.body, thabo.user.id).status).toBe('reassigned')
    expect(share(moved.body, mme.user.id)).toMatchObject({ status: 'awaiting', amount: 20 })

    await decline(r.body.id, palesa.token)
    // The money comes to the organiser, so covering moves nothing.
    const before = await balanceOf(t, lerato.token)
    const covered = await resolve(palesa.user.id, { action: 'cover' })
    expect(share(covered.body, palesa.user.id).status).toBe('covered')
    expect(await balanceOf(t, lerato.token)).toBe(before)

    await approve(r.body.id, mme.token)
    expect((await view(r.body.id)).request.status).toBe('paid')
  })

  it('not approved in time counts as declined; reminders go out first', async () => {
    const r = await split({ method: 'equal', total: 20, participants: [{ userId: thabo.user.id }] })
    await t.server.db.query(`UPDATE split_shares SET created_at = now() - interval '2 hours' WHERE message_id = $1`, [r.body.id])
    await t.server.splitSweeper.sweep()
    const [{ reminders }] = await t.server.db.query<{ reminders: number }>('SELECT reminders FROM split_shares WHERE message_id = $1', [r.body.id])
    expect(reminders).toBe(1)

    await t.server.db.query(`UPDATE split_shares SET approve_by = now() - interval '1 minute' WHERE message_id = $1`, [r.body.id])
    expect((await approve(r.body.id, thabo.token)).body.error.code).toBe('CONFLICT')
    await t.server.splitSweeper.sweep()
    const m = await view(r.body.id)
    expect(share(m, thabo.user.id).status).toBe('expired')
    expect(m.request.status).toBe('pending') // waits for the organiser
  })

  it('collection deadline: what is unpaid lapses back to the organiser', async () => {
    await setBalance(palesa.user.id, 20)
    const r = await split({ method: 'specific', participants: [{ userId: palesa.user.id, amount: 50 }] })
    await approve(r.body.id, palesa.token)
    await t.server.db.query(`UPDATE split_shares SET collect_until = now() - interval '1 minute' WHERE message_id = $1`, [r.body.id])
    await t.server.splitSweeper.sweep()
    expect(share(await view(r.body.id), palesa.user.id)).toMatchObject({ status: 'lapsed', paid: 0 })
  })

  it('limits: tier 1 share cap, most owed across splits, largest share', async () => {
    expect((await split({ method: 'specific', participants: [{ userId: thabo.user.id, amount: 600 }] })).body.error.code).toBe('VALIDATION')
    const big = await split({ method: 'specific', participants: [{ userId: palesa.user.id, amount: 300 }] })
    const refused = await approve(big.body.id, palesa.token) // Palesa is KYC tier 1: M200
    expect(refused.body.error.code).toBe('VALIDATION')
    expect(refused.body.error.message).toContain('Pay your share now')

    await setBalance(thabo.user.id, 0) // nothing collected, so it all stays owed
    for (let i = 0; i < 2; i++) {
      const s = await split({ method: 'specific', participants: [{ userId: thabo.user.id, amount: 450 }] })
      expect((await approve(s.body.id, thabo.token)).status).toBe(200)
    }
    const third = await split({ method: 'specific', participants: [{ userId: thabo.user.id, amount: 450 }] })
    expect((await approve(third.body.id, thabo.token)).body.error.message).toContain('at most M1,000.00')
    await setBalance(thabo.user.id, 3200)
    await t.server.splitSweeper.sweep()
  })

  it('pay to another subscriber: the organiser’s cut and every share go to them', async () => {
    const payeeBefore = await balanceOf(t, mme.token)
    const r = await split({
      method: 'equal',
      total: 40,
      participants: [{ userId: lerato.user.id }, { userId: thabo.user.id }],
      payTo: { subscriber: N.mme },
    })
    expect(r.body.request).toMatchObject({ toUserId: mme.user.id, split: { mode: 'subscriber', payee: { id: mme.user.id, name: 'Mme' } } })
    expect(await balanceOf(t, mme.token)).toBe(payeeBefore + 20)
    await approve(r.body.id, thabo.token)
    await idle()
    expect(await balanceOf(t, mme.token)).toBe(payeeBefore + 40)
    // The payee can't also share it; money that went to them can't be refunded by the organiser.
    expect((await split({ method: 'equal', total: 10, participants: [{ userId: mme.user.id }], payTo: { subscriber: N.mme } })).body.error.code).toBe('VALIDATION')
  })

  it('merchant: the organiser covers the bill now, or the merchant receives each share', async () => {
    const cafeBefore = await balanceOf(t, cafe.token)
    const cover = await split({
      method: 'equal',
      total: 90,
      participants: [{ userId: lerato.user.id }, { userId: thabo.user.id }, { userId: mme.user.id }],
      payTo: { merchantCode: '1001', organiserCovers: true },
    })
    expect(cover.body.request).toMatchObject({ toUserId: lerato.user.id, split: { mode: 'merchant_cover', payee: { name: 'Ha Abia Cafe' } } })
    expect(await balanceOf(t, cafe.token)).toBe(cafeBefore + 90)

    const direct = await split({
      method: 'specific',
      participants: [{ userId: lerato.user.id, amount: 10 }, { userId: thabo.user.id, amount: 15 }],
      payTo: { merchantCode: '1001', organiserCovers: false },
    })
    expect(direct.body.request).toMatchObject({ toUserId: cafe.user.id, split: { mode: 'merchant_direct' } })
    expect(await balanceOf(t, cafe.token)).toBe(cafeBefore + 100)
    await approve(direct.body.id, thabo.token)
    await idle()
    expect(await balanceOf(t, cafe.token)).toBe(cafeBefore + 115)

    expect((await split({ method: 'enter', participants: [{ userId: thabo.user.id }], payTo: { merchantCode: '1001', organiserCovers: true } })).body.error.code).toBe('VALIDATION')
  })

  it('cancel: stops collection; refunds only when the money came to the organiser', async () => {
    const r = await split({ method: 'equal', total: 30, participants: [{ userId: thabo.user.id }, { userId: mme.user.id }] })
    await approve(r.body.id, thabo.token)
    const thaboBefore = await balanceOf(t, thabo.token)
    expect((await t.call('POST', `/v1/splits/${r.body.id}/cancel`, { pin: '1234' }, thabo.token)).status).toBe(403)
    const c = await t.call('POST', `/v1/splits/${r.body.id}/cancel`, { pin: '1234', refund: true }, lerato.token)
    expect(c.status).toBe(200)
    expect(c.body.request).toMatchObject({ status: 'cancelled', paid: 0 })
    expect(share(c.body, mme.user.id).status).toBe('cancelled')
    expect(await balanceOf(t, thabo.token)).toBe(thaboBefore + 15)
    expect((await approve(r.body.id, mme.token)).body.error.code).toBe('CONFLICT')

    const sub = await split({ method: 'equal', total: 10, participants: [{ userId: thabo.user.id }], payTo: { subscriber: N.mme } })
    expect((await t.call('POST', `/v1/splits/${sub.body.id}/cancel`, { pin: '1234', refund: true }, lerato.token)).body.error.code).toBe('VALIDATION')
  })

  it('members enter their own amount when approving; outsiders and bad input are refused; history', async () => {
    const r = await split({ method: 'enter', participants: [{ userId: lerato.user.id }, { userId: thabo.user.id }] })
    expect(r.body.request).toMatchObject({ amount: 0, paid: 0 })
    expect((await approve(r.body.id, thabo.token)).body.error.code).toBe('VALIDATION')
    const a = await approve(r.body.id, thabo.token, 42.5)
    expect(share(a.body, thabo.user.id)).toMatchObject({ amount: 42.5, paid: 42.5, status: 'paid' })

    expect((await split({ method: 'equal', total: 10, participants: [{ userId: lerato.user.id }] })).body.error.code).toBe('VALIDATION')
    expect((await split({ method: 'equal', participants: [{ userId: thabo.user.id }] })).body.error.code).toBe('VALIDATION')
    expect((await split({ method: 'equal', total: 10, participants: [{ userId: thabo.user.id }], pin: '9999' })).status).toBe(403)

    const d = await t.call('POST', '/v1/splits', { chatId: direct, clientId: 'd-1', pin: '1234', method: 'equal', total: 20, participants: [{ userId: lerato.user.id }, { userId: thabo.user.id }] }, lerato.token)
    expect(d.status).toBe(201)
    expect((await approve(d.body.id, palesa.token)).status).toBe(404) // not in that chat
    const mine = (await t.call('GET', '/v1/splits', undefined, lerato.token)).body
    expect(mine[0].id).toBe(d.body.id)
    const page = (await t.call('GET', `/v1/chats/${direct}/messages`, undefined, thabo.token)).body
    expect(page.at(-1).request.split.shares).toHaveLength(2)
  })

  it('the portal edits the limits', async () => {
    const admin = await t.adminLogin()
    const s = (await t.call('GET', '/admin/v1/split-settings', undefined, admin)).body
    expect(s).toMatchObject({ approvalHours: 48, maxShare: 500, balanceFloor: 20 })
    expect((await t.call('PUT', '/admin/v1/split-settings', { ...s, maxShareTier1: 900 }, admin)).body.error.code).toBe('VALIDATION')
    const saved = await t.call('PUT', '/admin/v1/split-settings', { ...s, balanceFloor: 50, reminderHours: [24, 1] }, admin)
    expect(saved.body).toMatchObject({ balanceFloor: 50, reminderHours: [1, 24] })
    expect((await t.call('GET', '/v1/split-settings', undefined, thabo.token)).body.balanceFloor).toBe(50)
  })
})
