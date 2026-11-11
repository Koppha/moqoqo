import type { EsCover, EsFieldType, EsProduct } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { notFound } from '../errors'
import { fromCents } from '../lib/money'

interface ProductRow {
  code: string
  name: string
  line: EsProduct['line']
  category: EsProduct['category']
  pricing: EsProduct['pricing']
  underwriter: string
  status: 'active' | 'draft' | 'retired'
}

export interface Product extends EsProduct {
  status: ProductRow['status']
  /** Option prices in cents, same order as options. */
  optionCents: number[]
}

/** Products (all statuses unless activeOnly), funeral first, each line in catalogue order (cheapest first). */
export async function loadProducts(q: Queryable, opts: { activeOnly?: boolean; codes?: string[] } = {}): Promise<Product[]> {
  const rows = await q.query<ProductRow>(
    `SELECT code, name, line, category, pricing, underwriter, status FROM ecosure_products
     WHERE ($1::boolean IS NOT TRUE OR status = 'active') AND ($2::text[] IS NULL OR code = ANY($2))
     ORDER BY CASE line WHEN 'funeral' THEN 0 ELSE 1 END, sort, code`,
    [opts.activeOnly ?? false, opts.codes ?? null],
  )
  if (!rows.length) return []
  const codes = rows.map((r) => r.code)
  const options = await q.query<{ product_code: string; label: string; cover: EsCover | null; monthly_premium_cents: number }>(
    'SELECT product_code, label, cover, monthly_premium_cents FROM ecosure_product_options WHERE product_code = ANY($1) ORDER BY sort, label',
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
      options: opts.map((o) => {
        const option: EsProduct['options'][number] = { label: o.label, monthlyPremium: fromCents(o.monthly_premium_cents) }
        if (o.cover) option.cover = o.cover
        return option
      }),
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
    quoteFields: p.quoteFields,
    claimDocuments: p.claimDocuments,
  }))
}

export async function requireProduct(q: Queryable, code: string): Promise<Product> {
  const [p] = await loadProducts(q, { activeOnly: true, codes: [code.trim().toUpperCase()] })
  if (!p) throw notFound(`No EcoSure product ${code}`)
  return p
}

/** Monthly premium (cents) of a funeral product for a cover type. */
export function coverPremiumCents(p: Product, cover: EsCover): number {
  const i = p.options.findIndex((o) => o.cover === cover)
  if (i < 0) throw notFound(`${p.name} has no ${cover} cover`)
  return p.optionCents[i]
}
