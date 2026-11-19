import type { AdminEsProduct, EsContent, EsCover, EsFieldType, EsOption, EsProduct, LocalizedText } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { notFound, validation } from '../errors'
import { fromCents } from '../lib/money'

interface ProductRow {
  code: string
  name: string
  line: EsProduct['line']
  category: EsProduct['category']
  pricing: EsProduct['pricing']
  underwriter: string
  status: 'active' | 'draft' | 'retired'
  extended_member_premium_cents: number | null
  extended_sum_assured_cents: number | null
  extended_package_id: string | null
  ecosure_group: string | null
  tagline: LocalizedText | null
  popular: boolean
}

export interface Product extends EsProduct {
  status: ProductRow['status']
  ecosureGroup: string | null
  packageIds: string[]
  /** Option prices in cents, same order as options. */
  optionCents: number[]
}

/** Products (all statuses unless activeOnly), funeral first, each line in catalogue order (cheapest first). */
export async function loadProducts(q: Queryable, opts: { activeOnly?: boolean; codes?: string[] } = {}): Promise<Product[]> {
  const rows = await q.query<ProductRow>(
    `SELECT code, name, line, category, pricing, underwriter, status, extended_member_premium_cents, extended_sum_assured_cents,
       extended_package_id, ecosure_group, tagline, popular FROM ecosure_products
     WHERE ($1::boolean IS NOT TRUE OR status = 'active') AND ($2::text[] IS NULL OR code = ANY($2))
     ORDER BY CASE line WHEN 'funeral' THEN 0 ELSE 1 END, sort, code`,
    [opts.activeOnly ?? false, opts.codes ?? null],
  )
  if (!rows.length) return []
  const codes = rows.map((r) => r.code)
  const options = await q.query<{
    product_code: string
    label: string
    cover: EsCover | null
    monthly_premium_cents: number
    sum_assured_cents: number | null
    waiting_months: number | null
    beneficiary_required: boolean
    package_id: string | null
  }>(
    `SELECT product_code, label, cover, monthly_premium_cents, sum_assured_cents, waiting_months, beneficiary_required, package_id
     FROM ecosure_product_options WHERE product_code = ANY($1) ORDER BY sort, label`,
    [codes],
  )
  const fields = await q.query<{ product_code: string; label: string; field_type: EsFieldType; required: boolean; choices: string[] }>(
    'SELECT product_code, label, field_type, required, choices FROM ecosure_quote_fields WHERE product_code = ANY($1) ORDER BY sort, label',
    [codes],
  )
  const docs = await q.query<{ product_code: string; label: string }>(
    'SELECT product_code, label FROM ecosure_product_claim_documents WHERE product_code = ANY($1) ORDER BY sort, label',
    [codes],
  )
  return rows.map((r) => {
    const opts = options.filter((o) => o.product_code === r.code)
    return {
      code: r.code,
      name: r.name,
      line: r.line,
      category: r.category,
      pricing: r.pricing,
      underwriter: r.underwriter,
      status: r.status,
      ecosureGroup: r.ecosure_group,
      packageIds: [...opts.map((o) => o.package_id), r.extended_package_id].filter((x): x is string => !!x),
      ...(r.tagline?.en ? { tagline: r.tagline } : {}),
      ...(r.popular ? { popular: true } : {}),
      options: opts.map((o) => {
        const option: EsOption = { label: o.label, monthlyPremium: fromCents(o.monthly_premium_cents) }
        if (o.cover) option.cover = o.cover
        if (o.sum_assured_cents != null) option.sumAssured = fromCents(Number(o.sum_assured_cents))
        if (o.waiting_months != null) option.waitingMonths = o.waiting_months
        if (o.beneficiary_required) option.beneficiaryRequired = true
        return option
      }),
      ...(r.extended_member_premium_cents != null && r.extended_sum_assured_cents != null
        ? { extendedMember: { monthlyPremium: fromCents(Number(r.extended_member_premium_cents)), sumAssured: fromCents(Number(r.extended_sum_assured_cents)) } }
        : {}),
      optionCents: opts.map((o) => o.monthly_premium_cents),
      quoteFields: fields
        .filter((f) => f.product_code === r.code)
        .map((f) => ({ label: f.label, type: f.field_type, required: f.required, choices: f.choices ?? [] })),
      claimDocuments: docs.filter((d) => d.product_code === r.code).map((d) => d.label),
    }
  })
}

/** The public catalogue: active products only, without internal fields. */
export async function catalogue(q: Queryable): Promise<EsProduct[]> {
  return (await loadProducts(q, { activeOnly: true })).map((p) => ({
    code: p.code,
    name: p.name,
    line: p.line,
    category: p.category,
    pricing: p.pricing,
    underwriter: p.underwriter,
    options: p.options,
    ...(p.extendedMember ? { extendedMember: p.extendedMember } : {}),
    ...(p.tagline ? { tagline: p.tagline } : {}),
    ...(p.popular ? { popular: true } : {}),
    quoteFields: p.quoteFields,
    claimDocuments: p.claimDocuments,
  }))
}

/** Portal › EcoSure › Catalogue: every product, any status, with where its prices come from. */
export async function adminProducts(q: Queryable): Promise<AdminEsProduct[]> {
  return (await loadProducts(q)).map(({ optionCents: _cents, ...p }) => p)
}

export async function ecosureContent(q: Queryable): Promise<EsContent> {
  const [r] = await q.query<{ terms: LocalizedText; call_centre: string | null }>('SELECT terms, call_centre FROM ecosure_content WHERE id = 1')
  return { terms: r?.terms ?? { en: '', st: '' }, callCentre: r?.call_centre ?? null }
}

export async function requireProduct(q: Queryable, code: string): Promise<Product> {
  const [p] = await loadProducts(q, { activeOnly: true, codes: [code.trim().toUpperCase()] })
  if (!p) throw notFound(`No EcoSure product ${code}`)
  return p
}

/** A funeral cover whose EcoSure package requires a beneficiary must name one. */
export function requireBeneficiary(p: Product, cover: EsCover, beneficiaryName: string | null): void {
  if (beneficiaryName) return
  if (p.options.find((o) => o.cover === cover)?.beneficiaryRequired) {
    throw validation(`${p.name} ${cover} cover needs a beneficiary. Add who receives the payout`)
  }
}

/** Monthly premium (cents) of a funeral product for a cover type. */
export function coverPremiumCents(p: Product, cover: EsCover): number {
  const i = p.options.findIndex((o) => o.cover === cover)
  if (i < 0) throw notFound(`${p.name} has no ${cover} cover`)
  return p.optionCents[i]
}
