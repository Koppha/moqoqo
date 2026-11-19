import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SimSignalBody } from '../../shared/api'
import { EconetSimSwap, type SimSwapSource } from '../src/gateways/simswap'
import { N, startTestServer, type TestServer } from './helpers'

// The app's SIM watch: the bound phone reports its EcoCash SIM replaced, taken out, or without network. The server
// asks Econet first; otherwise a replaced/removed SIM holds money until the SIM is back or staff clear it, and a
// SIM without network only alerts staff.

const econetSim = (inService = true) => ({ slot: 0, mcc: '651', mnc: '02', carrier: 'Econet Telecom Lesotho', inService })
const otherSim = { slot: 0, mcc: '655', mnc: '01', carrier: 'Vodacom', inService: true }
const body = (signal: SimSignalBody['signal'], sims: SimSignalBody['sims'], extra: Partial<SimSignalBody> = {}): SimSignalBody =>
  ({ signal, since: new Date(Date.now() - 60_000).toISOString(), sims, ...extra })

describe('SIM watch (Econet not connected)', () => {
  let t: TestServer
  let admin: string
  let me: { token: string; user: any }
  const bank = () => t.call('POST', '/v1/bank-transfers', { bankCode: 'SLB', accountNumber: '12345678901', amount: 20, pin: '1234', clientId: crypto.randomUUID() }, me.token)
  const signal = (b: SimSignalBody) => t.call('POST', '/v1/me/sim-signal', b, me.token)

  beforeAll(async () => {
    t = await startTestServer()
    admin = await t.adminLogin()
    me = await t.login(N.lerato)
  })
  afterAll(() => t.close())

  it('a different SIM card in the bound phone holds money leaving EcoCash and tells staff', async () => {
    const r = await signal(body('sim_changed', [otherSim]))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ confirmed: false, held: true, deviceOpen: true })
    expect((await bank()).body.error.code).toBe('RISK_BLOCKED')
    const s = await t.call('GET', `/admin/v1/users/${me.user.id}/sim-swaps`, undefined, admin)
    expect(s.body.events[0]).toMatchObject({ source: 'device', clearedAt: null, detail: expect.stringContaining('different SIM card') })
    const log = await t.call('GET', `/admin/v1/users/${me.user.id}/auth-events`, undefined, admin)
    expect(log.body.some((e: any) => e.kind === 'sim_signal')).toBe(true)
  })

  it('the same SIM card back lifts the hold', async () => {
    const r = await signal(body('sim_ok', [econetSim()]))
    expect(r.body).toMatchObject({ held: false, deviceOpen: false })
    expect((await bank()).status).toBe(201)
    const mine = await t.call('GET', '/v1/me/sim-swap', undefined, me.token)
    expect(mine.body).toMatchObject({ held: false, deviceOpen: false })
  })

  it('a SIM without network only alerts staff (once a day), no hold', async () => {
    const r = await signal(body('no_service', [econetSim(false)], { minutes: 45 }))
    expect(r.body).toMatchObject({ confirmed: false, held: false })
    await signal(body('no_service', [econetSim(false)], { minutes: 50 }))
    const alerts = await t.call('GET', '/admin/v1/risk/alerts?rule=sim_swap', undefined, admin)
    const possible = alerts.body.items.filter((a: any) => a.user.id === me.user.id && /Possible SIM swap/.test(a.detail))
    expect(possible).toHaveLength(1)
    expect((await bank()).status).toBe(201)
  })

  it('staff clearing also clears what the phone reported', async () => {
    await signal(body('sim_removed', []))
    expect((await t.call('GET', '/v1/me/sim-swap', undefined, me.token)).body.held).toBe(true)
    await t.call('POST', `/admin/v1/users/${me.user.id}/sim-swaps/clear`, { note: 'Owner came in with a new SIM and ID' }, admin)
    expect((await t.call('GET', '/v1/me/sim-swap', undefined, me.token)).body).toMatchObject({ held: false, deviceOpen: false })
  })

  it('refuses a bad report', async () => {
    expect((await signal({ signal: 'stolen', since: 'x', sims: [] } as any)).status).toBe(400)
    expect((await t.call('POST', '/v1/me/sim-signal', body('sim_ok', []))).status).toBe(401)
  })
})

describe('SIM watch with Econet connected', () => {
  it('a recent swap on the network is recorded as a network swap (the strongest evidence)', async () => {
    const swappedAt = new Date(Date.now() - 2 * 3_600_000)
    const network: SimSwapSource = { simulated: false, lastSwap: async () => swappedAt }
    const t = await startTestServer({ simSwap: network })
    const me = await t.login(N.thabo)
    const admin = await t.adminLogin()
    const r = await t.call('POST', '/v1/me/sim-signal', body('no_service', [econetSim(false)], { minutes: 40 }), me.token)
    expect(r.body).toMatchObject({ confirmed: true, held: true, deviceOpen: false })
    const s = await t.call('GET', `/admin/v1/users/${me.user.id}/sim-swaps`, undefined, admin)
    expect(s.body.events[0]).toMatchObject({ source: 'network', swappedAt: swappedAt.toISOString() })
    await t.close()
  })
})

describe('Econet SIM swap API adapter', () => {
  const cfg = { url: 'https://econet.test/sim-swap/v1/', key: 'k', header: 'Authorization', cacheSeconds: 300, timeoutMs: 1000 }

  it('asks retrieve-date with the number and reads latestSimChange; caches the answer', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ latestSimChange: '2026-11-12T08:30:00Z' }), { status: 200 })
    }) as unknown as typeof fetch
    const a = new EconetSimSwap(cfg, fetcher)
    expect((await a.lastSwap(null as any, '+26662000021'))?.toISOString()).toBe('2026-11-12T08:30:00.000Z')
    await a.lastSwap(null as any, '+26662000021')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://econet.test/sim-swap/v1/retrieve-date')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ phoneNumber: '+26662000021' })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })

  it('no swap on record = null; an error answer throws (the caller falls back)', async () => {
    const none = new EconetSimSwap(cfg, (async () => new Response('{"latestSimChange":null}')) as unknown as typeof fetch)
    expect(await none.lastSwap(null as any, '+26662000021')).toBeNull()
    const down = new EconetSimSwap(cfg, (async () => new Response('oops', { status: 503 })) as unknown as typeof fetch)
    await expect(down.lastSwap(null as any, '+26662000021')).rejects.toThrow('503')
  })
})
