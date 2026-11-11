import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildStatement } from '../src/services/statement'
import { getUser } from '../src/services/users'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
const day = (offset = 0) => new Date(Date.now() + 2 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10)
const money = (m: number) => `M${m.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  const mme = await t.login(N.mme)
  const chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
  await t.call('POST', '/v1/payments/send', { chatId, toUserId: mme.user.id, amount: 25.5, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, lerato.token)
})
afterAll(() => t.close())

const statement = (query: string, token = lerato.token) => t.call('GET', `/v1/me/statement?${query}`, undefined, token)
/** The HTML page (t.call parses JSON). */
const page = async (url: string, token = lerato.token) => {
  const res = await t.server.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('text/html')
  return res.body
}

describe('account statement', () => {
  it('balances: opening + in − out = closing, and today closes on the balance now', async () => {
    const user = (await getUser(t.server.db, lerato.user.id))!
    const s = await buildStatement(t.server.db, user, day(-365), day())
    expect(s.lines.length).toBeGreaterThan(0)
    expect(s.openingCents + s.inCents - s.outCents).toBe(s.closingCents)
    expect(s.closingCents / 100).toBe(await balanceOf(t, lerato.token))
    expect(s.lines.at(-1)!.balanceCents).toBe(s.closingCents)
    expect(s.lines.at(-1)).toMatchObject({ cents: -2550, description: 'Sent to Mme' })
    // A period that ended yesterday closes where today's opens.
    const before = await buildStatement(t.server.db, user, day(-365), day(-1))
    expect((await buildStatement(t.server.db, user, day(), day())).openingCents).toBe(before.closingCents)
  })

  it('renders the A4 page in English or Sesotho', async () => {
    const html = await page(`/v1/me/statement?from=${day(-30)}&to=${day()}`)
    expect(html).toContain('Account statement')
    expect(html).toContain('Lerato Mokhothu')
    expect(html).toContain('Sent to Mme')
    expect(html).toContain(money(await balanceOf(t, lerato.token)))
    expect(await page(`/v1/me/statement?from=${day()}&to=${day()}&lang=st`)).toContain('Setatemente sa akhaonto')
  })

  it('checks the period', async () => {
    expect((await statement(`from=${day()}&to=${day(-1)}`)).body.error.code).toBe('VALIDATION')
    expect((await statement(`from=${day()}&to=${day(1)}`)).body.error.code).toBe('VALIDATION')
    expect((await statement(`from=${day(-400)}&to=${day()}`)).body.error.code).toBe('VALIDATION')
    expect((await statement('from=yesterday&to=today')).body.error.code).toBe('VALIDATION')
    expect((await statement(`from=${day()}`)).status).toBe(400)
  })

  it("staff print anyone's statement; customers can't use the staff route", async () => {
    const admin = await t.adminLogin()
    expect(await page(`/admin/v1/users/${lerato.user.id}/statement?from=${day(-7)}&to=${day()}`, admin)).toContain('Sent to Mme')
    expect((await t.call('GET', `/admin/v1/users/${lerato.user.id}/statement?from=${day()}&to=${day()}`, undefined, lerato.token)).status).toBe(401)
  })
})
