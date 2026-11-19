import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpEcosurePackages, parsePackages, type EcosurePackage } from '../src/gateways/ecosurePackages'
import { N, startTestServer, type TestServer } from './helpers'

// EcoSure's package list is the source of the funeral packages: names, prices, cover terms, new and dropped tiers.
// Policies already sold keep their premium; a failed sync keeps the last good catalogue. The words around the
// packages (taglines, most popular, Ts&Cs, call centre) are set in the portal.

const raw = (id: string, group: string, coverType: 'SC' | 'FC', premium: number, over: Record<string, unknown> = {}) => ({
  productPackageId: id, packageName: id, productName: 'Hollard Insurance', packageGroup: group, coverType,
  category: group.startsWith('FAMILY_EXT_') ? 'EXTENDED' : 'IMMEDIATE', status: 'ACTIVE', country: { countryCode: 'LS' },
  sumAssured: 30000.0, premiumPerMember: premium, promotionalTariff: 0.0, waitingPeriod: coverType === 'SC' ? 3 : 0,
  beneficiaryMandatory: coverType === 'SC', rating: 1, ...over,
})

// The live list on 2026-11-19 (Standard and Lite tiers; Basic and Premium are left out here on purpose).
const LIVE = () => [
  raw('L0008', 'LITE', 'SC', 20, { packageName: 'Lite', sumAssured: 10000.0, beneficiaryMandatory: false, rating: 1 }),
  raw('M0001', 'FAMILY_LITE', 'FC', 30, { packageName: 'EcoSure Lite Family', sumAssured: 10000.0, rating: 5 }),
  raw('L00010', 'STANDARD', 'SC', 60, { packageName: 'Standard', rating: 3 }),
  raw('M0003', 'FAMILY_STANDARD', 'FC', 84, { packageName: 'EcoSure Standard Family', rating: 7 }),
  raw('M0007', 'FAMILY_EXT_STANDARD', 'FC', 60, { packageName: 'EcoSure Standard Extended', rating: 11 }),
]

let live: unknown[] = []
let down = false
const source = { packages: async (): Promise<EcosurePackage[]> => { if (down) throw new Error('connect ECONNREFUSED'); return parsePackages({ packages: live }) } }

let t: TestServer
let admin: string
const products = async () => (await t.call('GET', '/v1/ecosure/products')).body
const find = async (code: string) => (await products()).find((p: any) => p.code === code)
const sync = async () => (await t.server.ecosureSync.sync())!

beforeAll(async () => {
  t = await startTestServer({ ecosurePackages: source })
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('EcoSure package list', () => {
  it('reads the policy manager response and drops broken rows', async () => {
    const body = { packages: [raw('L00010', 'STANDARD', 'SC', 60), raw('', 'BASIC', 'SC', 40), raw('BAD', 'LITE', 'SC', 0)] }
    expect(parsePackages(body)).toEqual([expect.objectContaining({ productPackageId: 'L00010', countryCode: 'LS', premiumPerMember: 60, beneficiaryMandatory: true })])
    expect(() => parsePackages({ error: 'nope' })).toThrow(/packages/)
    const http = new HttpEcosurePackages({ url: 'http://ecosure.test/packages', timeoutMs: 1000 }, (async () => new Response(JSON.stringify(body))) as typeof fetch)
    expect(await http.packages()).toHaveLength(1)
  })

  it('EcoSure decides which packages are on sale, their names and prices', async () => {
    live = [
      ...LIVE(),
      raw('L0020', 'GOLD', 'SC', 150, { packageName: 'Gold', sumAssured: 80000.0, rating: 20 }),
      raw('M0020', 'FAMILY_GOLD', 'FC', 210, { packageName: 'EcoSure Gold Family', sumAssured: 80000.0, rating: 21 }),
      raw('L0009', 'BASIC', 'SC', 999, { status: 'INACTIVE' }),
      raw('Z0002', 'PREMIUM', 'SC', 999, { country: { countryCode: 'ZW' } }),
      raw('Q0001', 'ODD', 'XX', 10, { packageName: 'Odd one' }),
    ]
    const r = await sync()
    expect(r).toMatchObject({ ok: true, packages: 8, skipped: ['Q0001 Odd one'] })
    const funeral = (await products()).filter((p: any) => p.line === 'funeral')
    // Basic and Premium aren't on EcoSure's list: off sale. Gold is new, after the others, named by EcoSure.
    expect(funeral.map((p: any) => [p.code, p.name])).toEqual([['FUN-LITE', 'EcoSure Lite'], ['FUN-STD', 'EcoSure Standard'], ['FUN-GOLD', 'EcoSure Gold']])
    const gold = funeral[2]
    expect(gold.options).toEqual([
      { label: 'Family cover', cover: 'family', monthlyPremium: 210, sumAssured: 80000, waitingMonths: 0 },
      { label: 'Single cover', cover: 'single', monthlyPremium: 150, sumAssured: 80000, waitingMonths: 3, beneficiaryRequired: true },
    ])
    expect(gold.claimDocuments.length).toBeGreaterThan(0)
    expect(gold.extendedMember).toBeUndefined()
    expect((await find('FUN-STD')).extendedMember).toEqual({ monthlyPremium: 60, sumAssured: 30000 })
    expect((await sync()).updated).toBe(0) // nothing changed the second time
  })

  it('a cover EcoSure stops selling comes off sale; a returning tier comes back', async () => {
    live = [...LIVE().filter((p) => p.productPackageId !== 'L0008'), raw('L0009', 'BASIC', 'SC', 40, { packageName: 'Basic', sumAssured: 20000.0, rating: 2 })]
    await sync()
    expect((await find('FUN-LITE')).options.map((o: any) => o.cover)).toEqual(['family'])
    const basic = await find('FUN-BASIC')
    expect(basic.options.map((o: any) => [o.cover, o.monthlyPremium])).toEqual([['single', 40]])
    expect(await find('FUN-GOLD')).toBeUndefined()
  })

  it('a beneficiary is required where EcoSure says so; sold policies keep their premium', async () => {
    live = LIVE()
    await sync()
    const lerato = await t.login(N.lerato)
    const body = {
      productCode: 'FUN-STD', cover: 'single', idNumber: '0101199012345', fullName: 'Lerato Mokhothu', dob: '1990-01-01',
      gender: 'female', acceptedTerms: true, pin: '1234',
    }
    const r = await t.call('POST', '/v1/ecosure/policies', body, lerato.token)
    expect(r.body.error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('beneficiary') })
    const ok = await t.call('POST', '/v1/ecosure/policies', { ...body, beneficiaryName: 'Mme Mokhothu' }, lerato.token)
    expect(ok.status).toBe(201)
    expect(ok.body.policy).toMatchObject({ premium: 60 })

    live = LIVE().map((p) => (p.productPackageId === 'L00010' ? { ...p, premiumPerMember: 70 } : p))
    await sync()
    expect((await find('FUN-STD')).options.find((o: any) => o.cover === 'single').monthlyPremium).toBe(70)
    const mine = (await t.call('GET', '/v1/ecosure/policies', undefined, lerato.token)).body
    expect(mine[0]).toMatchObject({ premium: 60 })
  })

  it('a failed sync keeps the catalogue, and staff see it in the portal', async () => {
    down = true
    expect(await sync()).toMatchObject({ ok: false, error: expect.stringContaining('ECONNREFUSED') })
    expect((await find('FUN-STD')).options.find((o: any) => o.cover === 'single').monthlyPremium).toBe(70)
    const cat = (await t.call('GET', '/admin/v1/ecosure/catalogue', undefined, admin)).body
    expect(cat.sync).toMatchObject({ ok: false, error: expect.stringContaining('ECONNREFUSED') })
    expect(cat.products.find((p: any) => p.code === 'FUN-STD')).toMatchObject({ status: 'active', ecosureGroup: 'STANDARD', packageIds: ['M0003', 'L00010', 'M0007'] })
    expect(cat.products.find((p: any) => p.code === 'FUN-PREM')).toMatchObject({ status: 'retired' })
    down = false
    expect((await t.call('POST', '/admin/v1/ecosure/catalogue/sync', {}, admin)).body.sync).toMatchObject({ ok: true })
  })

  it('taglines, most popular, Ts&Cs and the call centre come from the portal', async () => {
    expect((await find('FUN-STD'))).toMatchObject({ popular: true, tagline: { en: 'Our most popular cover' } })
    const r = await t.call('PATCH', '/admin/v1/ecosure/products/FUN-LITE', { popular: true, tagline: { en: 'Start here', st: 'Qala mona' } }, admin)
    expect(r.status).toBe(200)
    expect(await find('FUN-LITE')).toMatchObject({ popular: true, tagline: { en: 'Start here', st: 'Qala mona' } })
    expect((await find('FUN-STD')).popular).toBeUndefined() // one most popular package
    await t.call('PATCH', '/admin/v1/ecosure/products/FUN-LITE', { tagline: null }, admin)
    expect((await find('FUN-LITE')).tagline).toBeUndefined()

    expect((await t.call('GET', '/v1/ecosure/content')).body).toMatchObject({ terms: { en: expect.stringContaining('LNIG Hollard') }, callCentre: null })
    const put = await t.call('PUT', '/admin/v1/ecosure/content', { terms: { en: 'New terms', st: '' }, callCentre: '8000 1234' }, admin)
    expect(put.status).toBe(200)
    expect((await t.call('GET', '/v1/ecosure/content')).body).toEqual({ terms: { en: 'New terms', st: '' }, callCentre: '8000 1234' })
    const lerato = await t.login(N.lerato)
    expect((await t.call('PUT', '/admin/v1/ecosure/content', { terms: { en: 'x', st: '' }, callCentre: null }, lerato.token)).status).toBe(401)
  })
})
