// EcoSure quotes: fixed-price products are priced at once; quoted (short-term) products wait for staff to price them.
import { ECOSURE_QUOTE_VALID_DAYS, type EsQuote, type EsQuoteBody } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents, toCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import type { UserRow } from '../services/users'
import { formatDate, notify } from './account'
import { requireProduct } from './catalogue'
import { markUsed, requireOwnUploads } from './uploads'

const MAX_PREMIUM_CENTS = 1_000_000 * 100

export type QuoteStatus = EsQuote['status']
/** 'expired' is derived from expires_at. */
export const QUOTE_STATUS_SQL = `CASE WHEN q.status = 'priced' AND q.expires_at < now() THEN 'expired' ELSE q.status END`

interface QuoteRow {
  id: string
  reference: string
  user_id: string | null
  product_code: string
  product_name: string
  option_label: string | null
  monthly_premium_cents: number | null
  answers: Record<string, string>
  contact_name: string | null
  msisdn: string | null
  status: QuoteStatus
  expires_at: Date | null
  created_at: Date
}

const QUOTE_SELECT = `SELECT q.id, q.reference, q.user_id, q.product_code, pr.name AS product_name, q.option_label, q.monthly_premium_cents,
    q.answers, q.contact_name, q.msisdn, ${QUOTE_STATUS_SQL} AS status, q.expires_at, q.created_at
  FROM ecosure_quotes q JOIN ecosure_products pr ON pr.code = q.product_code`

export type AdminQuote = EsQuote & { contactName?: string; msisdn?: string; answers: Record<string, string> }

async function toQuotes(q: Queryable, rows: QuoteRow[]): Promise<AdminQuote[]> {
  if (!rows.length) return []
  const docs = await q.query<{ quote_id: string; label: string; file_name: string }>(
    `SELECT d.quote_id, d.label, u.file_name FROM ecosure_quote_documents d JOIN ecosure_uploads u ON u.id = d.upload_id
     WHERE d.quote_id = ANY($1) ORDER BY d.sort, d.label`,
    [rows.map((r) => r.id)],
  )
  return rows.map((r) => {
    const quote: AdminQuote = {
      reference: r.reference,
      productCode: r.product_code,
      productName: r.product_name,
      status: r.status,
      documents: docs.filter((d) => d.quote_id === r.id).map((d) => ({ label: d.label, fileName: d.file_name })),
      createdAt: iso(r.created_at),
      answers: typeof r.answers === 'string' ? JSON.parse(r.answers) : (r.answers ?? {}),
    }
    if (r.option_label) quote.option = r.option_label
    if (r.monthly_premium_cents != null) quote.monthlyPremium = fromCents(r.monthly_premium_cents)
    if (r.expires_at) quote.expiresAt = iso(r.expires_at)
    if (r.contact_name) quote.contactName = r.contact_name
    if (r.msisdn) quote.msisdn = r.msisdn
    return quote
  })
}

/** The customer's view (no contact details or answers). */
const toCustomer = (a: AdminQuote): EsQuote => {
  const quote: EsQuote = { reference: a.reference, productCode: a.productCode, productName: a.productName, status: a.status, documents: a.documents, createdAt: a.createdAt }
  if (a.option) quote.option = a.option
  if (a.monthlyPremium !== undefined) quote.monthlyPremium = a.monthlyPremium
  if (a.expiresAt) quote.expiresAt = a.expiresAt
  return quote
}

export async function myQuotes(q: Queryable, me: UserRow): Promise<EsQuote[]> {
  return (await toQuotes(q, await q.query<QuoteRow>(`${QUOTE_SELECT} WHERE q.user_id = $1 ORDER BY q.created_at DESC, q.reference DESC`, [me.id]))).map(toCustomer)
}

async function loadQuote(q: Queryable, where: string, param: string): Promise<AdminQuote> {
  const [quote] = await toQuotes(q, await q.query<QuoteRow>(`${QUOTE_SELECT} WHERE ${where}`, [param]))
  if (!quote) throw notFound('Quote not found')
  return quote
}

const expiryDate = (expiresAt: string) => formatDate(new Date(new Date(expiresAt).getTime() + 2 * 3600_000).toISOString().slice(0, 10))

export async function createQuote(ctx: Ctx, me: UserRow, body: EsQuoteBody): Promise<EsQuote> {
  if (body.consent !== true) throw validation('Please agree that EcoSure may use these details to prepare your quote')
  const product = await requireProduct(ctx.db, body.productCode)
  if (product.line === 'funeral') throw validation('Funeral cover is bought directly; no quote is needed')

  // Option: required when the product has options (SME business size).
  let optionLabel: string | null = null
  let premiumCents: number | null = null
  if (product.options.length) {
    const i = product.options.findIndex((o) => o.label === body.option)
    if (i < 0) throw validation(`option must be one of ${product.options.map((o) => o.label).join(', ')}`)
    optionLabel = product.options[i].label
    premiumCents = product.pricing === 'fixed' ? product.optionCents[i] : null
  } else if (body.option) {
    throw validation(`${product.name} has no options`)
  }
  if (product.pricing === 'fixed' && premiumCents == null) throw validation('option is required')

  // Answers (non-document fields).
  const answerFields = product.quoteFields.filter((f) => f.type !== 'document')
  const answers: Record<string, string> = {}
  for (const label of Object.keys(body.answers)) {
    if (!answerFields.some((f) => f.label === label)) throw validation(`"${label}" is not a question for ${product.name}`)
  }
  for (const f of answerFields) {
    const raw = (body.answers[f.label] ?? '').trim()
    if (!raw) {
      if (f.required) throw validation(`Please answer "${f.label}"`)
      continue
    }
    if (raw.length > 500) throw validation(`"${f.label}" must be at most 500 characters`)
    switch (f.type) {
      case 'number': {
        const n = raw.replace(/[\s,]/g, '').replace(/^M/i, '')
        if (!/^\d+(\.\d+)?$/.test(n)) throw validation(`"${f.label}" must be a number`)
        answers[f.label] = n
        break
      }
      case 'yes_no': {
        const v = raw.toLowerCase()
        if (v !== 'yes' && v !== 'no') throw validation(`"${f.label}" must be Yes or No`)
        answers[f.label] = v === 'yes' ? 'Yes' : 'No'
        break
      }
      case 'choice': {
        const choice = f.choices.find((c) => c.toLowerCase() === raw.toLowerCase())
        if (!choice) throw validation(`"${f.label}" must be one of ${f.choices.join(', ')}`)
        answers[f.label] = choice
        break
      }
      default:
        answers[f.label] = raw
    }
  }

  // Documents.
  const docFields = product.quoteFields.filter((f) => f.type === 'document')
  const docs = Object.entries(body.documents).map(([label, uploadId]) => ({ label, uploadId }))
  for (const d of docs) if (!docFields.some((f) => f.label === d.label)) throw validation(`"${d.label}" is not a document for ${product.name}`)
  const missing = docFields.filter((f) => f.required && !body.documents[f.label]).map((f) => f.label)
  if (missing.length) throw validation(`Please add: ${missing.join(', ')}`)

  // Contact: required for staff-priced quotes.
  const contactName = body.contactName?.trim().slice(0, 80) || null
  const msisdn = body.msisdn?.trim() ? normalizeMsisdn(body.msisdn, 'msisdn') : null
  if (product.pricing === 'quoted' && (!contactName || !msisdn)) throw validation('A contact name and number are needed so EcoSure can send your quote')

  const id = await ctx.tx(async (q, out) => {
    await requireOwnUploads(q, me.id, docs)
    const id = newId()
    const priced = premiumCents != null
    const [{ reference, expires_at }] = await q.query<{ reference: string; expires_at: Date | null }>(
      `INSERT INTO ecosure_quotes (id, user_id, product_code, option_label, monthly_premium_cents, answers, contact_name, msisdn, consent, status, priced_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9,
         CASE WHEN $10::boolean THEN now() END, CASE WHEN $10::boolean THEN now() + make_interval(days => $11) END)
       RETURNING reference, expires_at`,
      [id, me.id, product.code, optionLabel, premiumCents, JSON.stringify(answers), contactName, msisdn, priced ? 'priced' : 'submitted', priced, ECOSURE_QUOTE_VALID_DAYS],
    )
    for (const d of docs) {
      await q.query('INSERT INTO ecosure_quote_documents (quote_id, label, upload_id, sort) VALUES ($1, $2, $3, $4)', [
        id,
        d.label,
        d.uploadId,
        docFields.findIndex((f) => f.label === d.label),
      ])
    }
    await markUsed(
      q,
      docs.map((d) => d.uploadId),
    )
    const what = `${product.name}${optionLabel ? ` (${optionLabel})` : ''}`
    await notify(
      q,
      out,
      me.id,
      priced
        ? `Your EcoSure quote ${reference} for ${what}: ${formatM(premiumCents!)} a month, valid until ${expiryDate(iso(expires_at))}.`
        : `We received your quote request ${reference} for ${what}. EcoSure will send you the price here.`,
    )
    return id
  })
  return toCustomer(await loadQuote(ctx.db, 'q.id = $1', id))
}

// ---------- back office ----------

export async function adminQuotes(q: Queryable, status: QuoteStatus | null, page: number, pageSize: number) {
  const where = `($1::text IS NULL OR ${QUOTE_STATUS_SQL} = $1)`
  const [{ total }] = await q.query<{ total: number }>(`SELECT count(*) AS total FROM ecosure_quotes q WHERE ${where}`, [status])
  const rows = await q.query<QuoteRow>(`${QUOTE_SELECT} WHERE ${where} ORDER BY q.created_at DESC, q.reference DESC LIMIT $2 OFFSET $3`, [
    status,
    pageSize,
    (page - 1) * pageSize,
  ])
  return { items: await toQuotes(q, rows), total, page, pageSize }
}

export async function quoteDocumentUploadId(q: Queryable, reference: string, index: number): Promise<string> {
  const docs = await q.query<{ upload_id: string }>(
    `SELECT d.upload_id FROM ecosure_quote_documents d JOIN ecosure_quotes q ON q.id = d.quote_id WHERE q.reference = $1 ORDER BY d.sort, d.label`,
    [reference],
  )
  const doc = docs[index]
  if (!doc) throw notFound('Document not found')
  return doc.upload_id
}

/** Staff price a submitted quote; the customer is told in the EcoSure chat. */
export async function priceQuote(q: Queryable, out: Outbox, reference: string, monthlyPremium: number): Promise<{ quote: EsQuote; detail: string }> {
  const cents = toCents(monthlyPremium, 'monthlyPremium')
  if (cents <= 0) throw validation('monthlyPremium must be greater than 0')
  if (cents > MAX_PREMIUM_CENTS) throw new AppError('LIMIT_EXCEEDED', 'monthlyPremium is too large')
  const [row] = await q.query<{ id: string; status: string; user_id: string | null }>('SELECT id, status, user_id FROM ecosure_quotes WHERE reference = $1 FOR UPDATE', [
    reference,
  ])
  if (!row) throw notFound('Quote not found')
  if (row.status !== 'submitted') throw conflict(`Quote ${reference} is already ${row.status}`)
  const [{ expires_at }] = await q.query<{ expires_at: Date }>(
    `UPDATE ecosure_quotes SET status = 'priced', monthly_premium_cents = $2, priced_at = now(), expires_at = now() + make_interval(days => $3)
     WHERE id = $1 RETURNING expires_at`,
    [row.id, cents, ECOSURE_QUOTE_VALID_DAYS],
  )
  const quote = await loadQuote(q, 'q.id = $1', row.id)
  if (row.user_id) {
    await notify(
      q,
      out,
      row.user_id,
      `Your EcoSure quote ${reference} for ${quote.productName} is ready: ${formatM(cents)} a month, valid until ${expiryDate(iso(expires_at))}. ` +
        `Open EcoSure to see it.`,
    )
  }
  return { quote: toCustomer(quote), detail: `${reference} · ${formatM(cents)}` }
}

