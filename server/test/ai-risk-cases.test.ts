import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, chatByTitle, N, startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string
let lerato: { token: string; user: any }
let mme: { token: string; user: any }
let chatId: string
const ids: Record<string, string> = {}

/** What the AI case summary sent to the model. */
const prompts: any[] = []
const fakeModel = {
  async create(params: any) {
    prompts.push(params)
    return {
      id: 'msg_test', type: 'message', role: 'assistant', model: params.model, stop_reason: 'end_turn', stop_sequence: null, usage: {},
      content: [{ type: 'text', text: 'What happened: the customer sent most of the balance to C1.\nRed flags:\n- emptied the wallet\nCheck next:\n- call the customer' }],
    } as any
  },
}

const send = (amount: number) =>
  t.call('POST', '/v1/payments/send', { chatId, toUserId: mme.user.id, amount, pin: '1234', kind: 'money', clientId: crypto.randomUUID() }, lerato.token)
/** A payment straight through the ledger (rules, score, surveillance all see it). */
const pay = (from: string, to: string, amount: number, kind: 'send' | 'merchant' = 'send') =>
  t.server.ctx.tx((q) => t.server.ctx.ledger.transfer(q, { kind, fromUserId: ids[from], toUserId: ids[to], amountCents: Math.round(amount * 100) }))
const setModel = (key: string, mode: string, params: Record<string, number>, note = 'Test change') =>
  t.call('PUT', `/admin/v1/ai/models/${key}`, { mode, params, note }, admin)
const balance = (who: string, maloti: number) => t.server.db.query('UPDATE users SET balance_cents = $2 WHERE id = $1', [ids[who], maloti * 100])
const alerts = async () => (await t.call('GET', '/admin/v1/risk/alerts?pageSize=100', undefined, admin)).body.items as any[]
const decisions = async (q = '') => (await t.call('GET', `/admin/v1/ai/decisions?pageSize=100${q}`, undefined, admin)).body
const caseOf = async (msisdn: string) => {
  const list = (await t.call('GET', '/admin/v1/cases?status=active&pageSize=100', undefined, admin)).body.items as any[]
  const c = list.find((x) => x.user.msisdn === msisdn)
  return c ? (await t.call('GET', `/admin/v1/cases/${c.id}`, undefined, admin)).body : null
}

beforeAll(async () => {
  t = await startTestServer({ assistantModel: fakeModel })
  admin = await t.adminLogin()
  lerato = await t.login(N.lerato)
  mme = await t.login(N.mme)
  chatId = (await chatByTitle(t, lerato.token, 'Mme')).id
  for (const [k, msisdn] of Object.entries({ lerato: N.lerato, mme: N.mme, thabo: N.thabo, palesa: N.palesa, cafe: N.cafe })) {
    const [u] = await t.server.db.query<{ id: string }>('SELECT id FROM users WHERE msisdn = $1', [msisdn])
    ids[k] = u.id
  }
  await t.server.db.query('UPDATE users SET kyc_tier = 2 WHERE id = ANY($1)', [Object.values(ids)])
})
afterAll(() => t.close())

describe('AI governance', () => {
  it('registers every model with what it decides, who oversees it, and its provider', async () => {
    const models = (await t.call('GET', '/admin/v1/ai/models', undefined, admin)).body
    expect(models.map((m: any) => m.key)).toEqual(['fraud_score', 'aml_surveillance', 'case_summary', 'churn_risk', 'assistant'])
    const score = models.find((m: any) => m.key === 'fraud_score')
    expect(score).toMatchObject({ version: 0, mode: 'active', params: { flagAt: 60, blockAt: 0, caseAt: 80 }, available: true })
    expect(models.find((m: any) => m.key === 'case_summary')).toMatchObject({ available: true, provider: expect.stringContaining('Anthropic') })
  })

  it('makes every change a new version with who and why, and refuses bad values', async () => {
    expect((await setModel('fraud_score', 'active', { flagAt: 500 })).status).toBe(400)
    expect((await t.call('PUT', '/admin/v1/ai/models/fraud_score', { mode: 'active', params: {}, note: '' }, admin)).status).toBe(400)
    expect((await setModel('case_summary', 'shadow', {})).status).toBe(400) // an LLM summary has no shadow mode
    const r = await setModel('fraud_score', 'active', { flagAt: 65 }, 'Fewer false alarms')
    expect(r.body).toMatchObject({ version: 1, params: { flagAt: 65, blockAt: 0, caseAt: 80 }, changedBy: ADMIN.email, note: 'Fewer false alarms' })
    const versions = (await t.call('GET', '/admin/v1/ai/models/fraud_score/versions', undefined, admin)).body
    expect(versions[0]).toMatchObject({ version: 1, changedBy: ADMIN.email })
    const audit = (await t.call('GET', '/admin/v1/audit', undefined, admin)).body
    expect(JSON.stringify(audit)).toContain('ai.model')

    await t.createSupportAdmin('support@test.local', 'support-pass-123')
    const support = await t.adminLogin('support@test.local', 'support-pass-123')
    expect((await t.call('PUT', '/admin/v1/ai/models/fraud_score', { mode: 'off', params: {}, note: 'nope' }, support)).status).toBe(403)
    expect((await t.call('GET', '/admin/v1/ai/models', undefined, support)).status).toBe(200)
  })
})

describe('behavioural fraud score', () => {
  it('scores every payment and logs it with its reasons', async () => {
    expect((await send(1)).status).toBe(200)
    const d = (await decisions('&model=fraud_score')).items[0]
    expect(d).toMatchObject({ model: 'fraud_score', version: 1, outcome: 'allow', shadow: false, transactionRef: expect.any(String), amount: 1 })
  })

  it('flags a payment that empties the wallet, explains why, and opens a case', async () => {
    await setModel('fraud_score', 'active', { flagAt: 10, blockAt: 0, caseAt: 10 })
    await balance('lerato', 600)
    expect((await send(600)).status).toBe(200)
    const a = (await alerts()).find((x) => x.rule === 'behaviour_score')
    expect(a).toMatchObject({ action: 'flagged', user: { msisdn: N.lerato }, caseRef: expect.stringMatching(/^CASE-\d{6}$/) })
    expect(a.score).toBeGreaterThanOrEqual(15)
    const d = (await decisions('&model=fraud_score&outcome=flag')).items[0]
    expect(d.id).toBe(a.decisionId)
    expect(d.reasons.some((r: any) => r.feature === 'drains_balance' && r.points === 15)).toBe(true)
    expect(d.summary).toMatch(/^Score \d+/)
  })

  it('in shadow mode logs the score without acting', async () => {
    await setModel('fraud_score', 'shadow', { flagAt: 10, blockAt: 10 })
    await balance('lerato', 600)
    const before = (await alerts()).length
    expect((await send(600)).status).toBe(200)
    expect((await alerts()).length).toBe(before)
    expect((await decisions('&model=fraud_score')).items[0]).toMatchObject({ shadow: true, outcome: 'block' })
  })

  it('blocks at the block score, and the block is logged and reviewed in a case', async () => {
    await setModel('fraud_score', 'active', { flagAt: 10, blockAt: 10, caseAt: 10 })
    await balance('lerato', 600)
    const r = await send(600)
    expect(r.body.error.code).toBe('RISK_BLOCKED')
    await new Promise((res) => setTimeout(res, 100))
    expect((await alerts()).find((x) => x.rule === 'behaviour_score' && x.action === 'blocked')).toMatchObject({ caseRef: expect.any(String) })
    expect((await decisions('&model=fraud_score&outcome=block')).items.some((d: any) => !d.shadow && d.transactionRef === null)).toBe(true)
    await setModel('fraud_score', 'active', { flagAt: 60, blockAt: 0, caseAt: 80 }, 'Back to the defaults')
  })
})

describe('financial crime cases', () => {
  let c: any

  it('gathers the wallet\'s alerts, history and payments in one case', async () => {
    c = await caseOf(N.lerato)
    expect(c).toMatchObject({ status: 'open', priority: expect.any(String), frozen: false, wallet: { status: 'active', kycTier: 2 } })
    expect(c.alerts.length).toBeGreaterThanOrEqual(2)
    expect(c.alertCount).toBe(c.alerts.length)
    expect(c.events[0]).toMatchObject({ kind: 'created', actor: 'system' })
    expect(c.transactions.some((x: any) => x.flagged && x.direction === 'out')).toBe(true)
  })

  it('is assigned, investigated and noted, all in its history', async () => {
    const r = await t.call('PATCH', `/admin/v1/cases/${c.id}`, { assignedTo: ADMIN.email, status: 'investigating', note: 'Called the customer' }, admin)
    expect(r.body).toMatchObject({ status: 'investigating', assignedTo: ADMIN.email })
    expect(r.body.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['assign', 'status', 'note']))
    const mine = (await t.call('GET', '/admin/v1/cases?mine=1', undefined, admin)).body
    expect(mine.items.map((x: any) => x.id)).toContain(c.id)
    expect((await t.call('PATCH', `/admin/v1/cases/${c.id}`, { assignedTo: 'nobody@nowhere.ls' }, admin)).status).toBe(400)
  })

  it('freezes the wallet (signed out at once) and unfreezes it', async () => {
    const f = await t.call('POST', `/admin/v1/cases/${c.id}/freeze`, { frozen: true, note: 'Protect the funds' }, admin)
    expect(f.body).toMatchObject({ frozen: true, wallet: { status: 'suspended' } })
    expect((await t.call('GET', '/v1/me', undefined, lerato.token)).status).toBe(401)
    const u = await t.call('POST', `/admin/v1/cases/${c.id}/freeze`, { frozen: false, note: 'Customer verified at the shop' }, admin)
    expect(u.body).toMatchObject({ frozen: false, wallet: { status: 'active' } })
    lerato = await t.login(N.lerato)
  })

  it('writes an AI summary without sending names or numbers to the model', async () => {
    const r = await t.call('POST', `/admin/v1/cases/${c.id}/summary`, undefined, admin)
    expect(r.status).toBe(200)
    expect(r.body.summary).toMatchObject({ text: expect.stringContaining('What happened'), by: `AI summary for ${ADMIN.email}` })
    const sent = JSON.stringify(prompts.at(-1).messages)
    for (const secret of ['Lerato', 'Mme', N.lerato, N.mme, N.lerato.slice(4)]) expect(sent).not.toContain(secret)
    const facts = JSON.parse(prompts.at(-1).messages[0].content[0].text)
    expect(facts.payments.every((p: any) => /^C\d+$/.test(p.counterparty) || p.counterparty === 'outside EcoCash')).toBe(true)
    expect((await decisions('&model=case_summary')).total).toBe(1)

    await setModel('case_summary', 'off', {}, 'Paused by compliance')
    expect((await t.call('POST', `/admin/v1/cases/${c.id}/summary`, undefined, admin)).status).toBe(403)
    await setModel('case_summary', 'active', {}, 'Resumed')
  })

  it('records the suspicious transaction report, then closes as fraud, reviewing every alert', async () => {
    expect((await t.call('POST', `/admin/v1/cases/${c.id}/str`, { reference: 'FIU-2026-0042' }, admin)).body.strRef).toBe('FIU-2026-0042')
    const r = await t.call('POST', `/admin/v1/cases/${c.id}/close`, { outcome: 'fraud', note: 'Customer confirmed a scam call' }, admin)
    expect(r.body).toMatchObject({ status: 'closed_fraud', openAlerts: 0, closedAt: expect.any(String) })
    expect(r.body.alerts.every((a: any) => a.status === 'fraud')).toBe(true)
    expect((await t.call('PATCH', `/admin/v1/cases/${c.id}`, { note: 'late' }, admin)).status).toBe(409)
    // The model's accuracy now counts the confirmed fraud.
    const score = (await t.call('GET', '/admin/v1/ai/models', undefined, admin)).body.find((m: any) => m.key === 'fraud_score')
    expect(score.stats.confirmedFraud).toBeGreaterThanOrEqual(1)
    expect(score.stats.precision).toBe(1)
    expect(score.stats.scoreBuckets).toHaveLength(10)
    const stats = (await t.call('GET', '/admin/v1/cases/stats', undefined, admin)).body
    expect(stats.closedLast30).toBe(1)
  })

  it('can be opened by staff, one active case per wallet', async () => {
    const r = await t.call('POST', '/admin/v1/cases', { msisdn: N.palesa, title: 'Customer reported a scam call', note: 'Walk-in at Maseru shop' }, admin)
    expect(r.body).toMatchObject({ status: 'open', user: { msisdn: N.palesa }, title: 'Customer reported a scam call' })
    expect((await t.call('POST', '/admin/v1/cases', { msisdn: N.palesa, title: 'Again', note: '' }, admin)).status).toBe(409)
    expect((await t.call('POST', '/admin/v1/cases', { msisdn: '+26662999999', title: 'Nobody', note: '' }, admin)).status).toBe(404)
  })
})

describe('transaction surveillance', () => {
  it('finds structuring, pass-through and dormant wallets, once a day each, and opens cases', async () => {
    await setModel('aml_surveillance', 'active', { structuringAmount: 1000, structuringCount: 3, passThroughMin: 2000, passThroughPercent: 80, dormantDays: 90, dormantAmount: 2000 })
    for (const who of ['lerato', 'mme', 'thabo', 'palesa']) await balance(who, 9000)

    // Mme receives M3,000 and sends nearly all of it on to a merchant.
    await pay('lerato', 'mme', 3000)
    const [{ v }] = await t.server.db.query<{ v: string }>(`SELECT sum(amount_cents) AS v FROM transactions WHERE to_user_id = $1 AND created_at > now() - interval '1 day'`, [ids.mme])
    await pay('mme', 'cafe', Math.ceil((Number(v) * 0.9) / 100), 'merchant')
    // Palesa pays three times just under M1,000.
    for (let i = 0; i < 3; i++) await pay('palesa', 'cafe', 950, 'merchant')
    // Thabo paid last 200 days ago, and today pays out M2,500.
    await pay('thabo', 'cafe', 10, 'merchant')
    await t.server.db.query(`UPDATE transactions SET created_at = created_at - interval '200 days' WHERE from_user_id = $1`, [ids.thabo])
    await pay('thabo', 'cafe', 2500, 'merchant')

    expect(await t.server.surveillance.sweep()).toBeGreaterThanOrEqual(3)
    const raised = (await alerts()).filter((a) => ['structuring', 'pass_through', 'dormant_reactivation'].includes(a.rule))
    expect(raised.find((a) => a.rule === 'pass_through')).toMatchObject({ user: { msisdn: N.mme }, severity: 'high', caseRef: expect.any(String) })
    expect(raised.find((a) => a.rule === 'structuring')).toMatchObject({ user: { msisdn: N.palesa } })
    expect(raised.find((a) => a.rule === 'dormant_reactivation')).toMatchObject({ user: { msisdn: N.thabo }, detail: expect.stringContaining('200 days') })
    // Palesa's alert joined the case staff opened for her.
    const palesa = await caseOf(N.palesa)
    expect(palesa.title).toBe('Customer reported a scam call')
    expect(palesa.alerts.some((a: any) => a.rule === 'structuring')).toBe(true)

    expect(await t.server.surveillance.sweep()).toBe(0)
  })

  it('in shadow mode only logs what it found', async () => {
    await setModel('aml_surveillance', 'shadow', {})
    await t.server.db.query(`DELETE FROM ai_decisions WHERE model = 'aml_surveillance'`)
    const before = (await alerts()).length
    expect(await t.server.surveillance.sweep()).toBe(0)
    expect((await alerts()).length).toBe(before)
    expect((await decisions('&model=aml_surveillance')).items.every((d: any) => d.shadow)).toBe(true)
    expect((await decisions('&model=aml_surveillance')).total).toBeGreaterThanOrEqual(3)
  })
})
