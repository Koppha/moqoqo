import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let lerato: { token: string; user: any }
let thabo: { token: string; user: any }
let mme: { token: string; user: any }
let palesa: { token: string; user: any }
let admin: string
let cause: any

const pin = '1234'
let n = 0
const give = (amount: number, token: string, extra: object = {}) =>
  t.call('POST', `/v1/causes/${cause.id}/donate`, { amount, pin, clientId: `d-${n++}`, ...extra }, token)
const view = async (token: string) => (await t.call('GET', `/v1/causes/${cause.code}`, undefined, token)).body

beforeAll(async () => {
  t = await startTestServer()
  lerato = await t.login(N.lerato)
  thabo = await t.login(N.thabo)
  mme = await t.login(N.mme)
  palesa = await t.login(N.palesa)
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('donate', () => {
  it('a verified person starts a cause with a code to share', async () => {
    const body = { title: 'Ntate Mohapi’s funeral', description: 'Help the family with the funeral costs on Saturday.', target: 1000 }
    expect((await t.call('POST', '/v1/causes', body, palesa.token)).status).toBe(403) // KYC tier 1
    expect((await t.call('POST', '/v1/causes', { ...body, target: 999999 }, lerato.token)).body.error.code).toBe('VALIDATION')
    const r = await t.call('POST', '/v1/causes', body, lerato.token)
    expect(r.status).toBe(201)
    cause = r.body
    expect(cause).toMatchObject({ title: body.title, target: 1000, raised: 0, status: 'open', mine: true, balance: 0, code: expect.stringMatching(/^[A-Z0-9]{6}$/) })
  })

  it('anyone with the code gives from their wallet, by name or anonymously', async () => {
    const before = await balanceOf(t, thabo.token)
    expect((await give(100, thabo.token, { note: 'Robala ka khotso' })).status).toBe(200)
    expect(await balanceOf(t, thabo.token)).toBe(before - 100)
    await give(50, mme.token, { anonymous: true })
    const v = await view(thabo.token) // any signed-in person, by code (lower case works too)
    expect((await t.call('GET', `/v1/causes/${cause.code.toLowerCase()}`, undefined, thabo.token)).status).toBe(200)
    expect(v).toMatchObject({ raised: 150, donorCount: 2, myTotal: 100, mine: false })
    expect(v.balance).toBeUndefined() // only the organiser sees what is left in the cause
    expect(v.donations.map((d: any) => [d.name, d.amount])).toEqual([[null, 50], [thabo.user.name, 100]])
    expect(v.donations[1].note).toBe('Robala ka khotso')
    expect((await t.call('GET', '/v1/causes', undefined, thabo.token)).body.supported.map((c: any) => c.id)).toEqual([cause.id])
    expect((await t.call('GET', '/v1/causes', undefined, lerato.token)).body.mine.map((c: any) => c.id)).toEqual([cause.id])
  })

  it('shares the cause in a chat as a card with live progress', async () => {
    const chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
    const m = await t.call('POST', `/v1/causes/${cause.id}/share`, { chatId }, lerato.token)
    expect(m.status).toBe(201)
    expect(m.body).toMatchObject({ kind: 'cause', cause: { code: cause.code, raised: 150, target: 1000 } })
    // Not in that chat: no posting there.
    expect((await t.call('POST', `/v1/causes/${cause.id}/share`, { chatId }, palesa.token)).status).toBeGreaterThanOrEqual(403)
    await give(25, mme.token)
    const msgs = (await t.call('GET', `/v1/chats/${chatId}/messages?limit=5`, undefined, mme.token)).body
    expect(msgs.find((x: any) => x.kind === 'cause').cause.raised).toBe(175)
  })

  it('only the organiser withdraws, up to what the cause holds', async () => {
    expect((await t.call('POST', `/v1/causes/${cause.id}/withdraw`, { amount: 10, pin }, thabo.token)).status).toBe(403)
    expect((await t.call('POST', `/v1/causes/${cause.id}/withdraw`, { amount: 500, pin }, lerato.token)).body.error.code).toBe('VALIDATION')
    const before = await balanceOf(t, lerato.token)
    expect((await t.call('POST', `/v1/causes/${cause.id}/withdraw`, { amount: 100, pin }, lerato.token)).status).toBe(200)
    expect(await balanceOf(t, lerato.token)).toBe(before + 100)
    expect((await view(lerato.token)).balance).toBe(75)
  })

  it('staff can put a cause on hold; the organiser can close it', async () => {
    expect((await t.call('POST', `/admin/v1/causes/${cause.id}/suspend`, { reason: ' ' }, admin)).body.error.code).toBe('VALIDATION')
    const held = await t.call('POST', `/admin/v1/causes/${cause.id}/suspend`, { reason: 'Checking the family’s details' }, admin)
    expect(held.body).toMatchObject({ status: 'suspended', statusReason: 'Checking the family’s details' })
    expect((await give(10, thabo.token)).body.error.code).toBe('CONFLICT')
    expect((await t.call('POST', `/v1/causes/${cause.id}/withdraw`, { amount: 10, pin }, lerato.token)).body.error.code).toBe('CONFLICT')
    await t.call('POST', `/admin/v1/causes/${cause.id}/reopen`, {}, admin)
    expect((await give(10, thabo.token)).status).toBe(200)

    expect((await t.call('POST', `/v1/causes/${cause.id}/close`, {}, thabo.token)).status).toBe(403)
    expect((await t.call('POST', `/v1/causes/${cause.id}/close`, {}, lerato.token)).body.status).toBe('closed')
    expect((await give(10, thabo.token)).body.error.code).toBe('CONFLICT')
    // Closed, the organiser can still take out what is left.
    expect((await t.call('POST', `/v1/causes/${cause.id}/withdraw`, { amount: 85, pin }, lerato.token)).status).toBe(200)
  })

  it('the portal sets the limits', async () => {
    const s = (await t.call('GET', '/admin/v1/donate-settings', undefined, admin)).body
    expect(s).toEqual({ enabled: true, minKycTier: 2, maxTarget: 50000, maxOpenPerUser: 3 })
    await t.call('PUT', '/admin/v1/donate-settings', { ...s, minKycTier: 1 }, admin)
    expect((await t.call('POST', '/v1/causes', { title: 'School trip', description: 'Grade 7 trip to Maseru museum.', target: 300 }, palesa.token)).status).toBe(201)
    await t.call('PUT', '/admin/v1/donate-settings', { ...s, enabled: false }, admin)
    expect((await t.call('POST', '/v1/causes', { title: 'Another', description: 'Another good cause here.', target: 300 }, palesa.token)).body.error.code).toBe('VALIDATION')
  })
})
