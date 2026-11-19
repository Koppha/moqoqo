// EcoSure's policy manager: its package list is the source of funeral prices and cover terms.
//   GET {url}  (e.g. http://10.3.10.162:15224/ecosure-policy-manager/api/v2/packages?countryCode=LS&category=CUSTOM)
//   → { packages: [{ productPackageId, packageName, packageGroup, coverType: 'SC'|'FC', category: 'IMMEDIATE'|'EXTENDED',
//        sumAssured, premiumPerMember, waitingPeriod, beneficiaryMandatory, status, country: { countryCode } … }] }
// No auth on the internal endpoint today. Tests pass their own `EcosurePackageSource`.

export interface EcosurePackage {
  productPackageId: string
  packageName: string
  packageGroup: string
  coverType: string
  category: string
  status: string
  countryCode: string | null
  sumAssured: number
  premiumPerMember: number
  promotionalTariff: number | null
  /** Months, as far as we know (EcoSure to confirm the unit). */
  waitingPeriod: number
  beneficiaryMandatory: boolean
  /** EcoSure's display order. */
  rating: number | null
}

export interface EcosurePackageSource {
  packages(): Promise<EcosurePackage[]>
}

export class HttpEcosurePackages implements EcosurePackageSource {
  constructor(private readonly cfg: { url: string; timeoutMs: number }, private readonly fetchFn: typeof fetch = fetch) {}

  async packages(): Promise<EcosurePackage[]> {
    const res = await this.fetchFn(this.cfg.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.cfg.timeoutMs) })
    if (!res.ok) throw new Error(`EcoSure packages: HTTP ${res.status}`)
    return parsePackages(await res.json())
  }
}

/** Reads EcoSure's response; rows without an id, a group or a positive premium are dropped. */
export function parsePackages(body: unknown): EcosurePackage[] {
  const list = (body as { packages?: unknown })?.packages
  if (!Array.isArray(list)) throw new Error('EcoSure packages: no "packages" list in the response')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : NaN)
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return list.flatMap((raw): EcosurePackage[] => {
    const p = raw as Record<string, unknown>
    const pkg: EcosurePackage = {
      productPackageId: str(p.productPackageId),
      packageName: str(p.packageName),
      packageGroup: str(p.packageGroup).toUpperCase(),
      coverType: str(p.coverType).toUpperCase(),
      category: str(p.category).toUpperCase(),
      status: str(p.status).toUpperCase(),
      countryCode: str((p.country as Record<string, unknown> | null)?.countryCode) || null,
      sumAssured: num(p.sumAssured),
      premiumPerMember: num(p.premiumPerMember),
      promotionalTariff: Number.isFinite(num(p.promotionalTariff)) ? num(p.promotionalTariff) : null,
      waitingPeriod: Number.isFinite(num(p.waitingPeriod)) ? Math.max(0, Math.round(num(p.waitingPeriod))) : 0,
      beneficiaryMandatory: p.beneficiaryMandatory === true,
      rating: Number.isFinite(num(p.rating)) ? num(p.rating) : null,
    }
    if (!pkg.productPackageId || !pkg.packageGroup || !(pkg.premiumPerMember > 0) || !(pkg.sumAssured > 0)) return []
    return [pkg]
  })
}
