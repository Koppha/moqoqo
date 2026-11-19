// Portal-defined services: storage, the rules a definition must follow, quotes and submissions.
import { z } from 'zod'
import {
  checkServiceValues,
  phoneNetwork,
  serviceAmount,
  serviceFee,
  type LocalizedText,
  type ServiceBody,
  type ServiceDef,
  type ServiceFieldError,
  type ServiceQuote,
  type ServiceRequest,
  type ServiceResult,
  type ServiceValues,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { requireOwnUploads, markUsed } from '../ecosure/uploads'
import { AppError, notFound, validation } from '../errors'
import { newId, randomDigits } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso } from '../lib/time'
import { checkPin } from './pins'
import { checkServiceImage } from './branding'
import { feesAccount } from './tariff'
import { toTransactions } from './transactions'
import type { UserRow } from './users'
import { openJson, sealJson } from '../lib/vault'

interface ServiceRow {
  id: string
  code: string
  name: LocalizedText
  description: LocalizedText
  icon: string
  color: string
  placement: ServiceDef['placement']
  sort: number
  enabled: boolean
  executor: ServiceDef['executor']
  fields: ServiceDef['fields']
  fee: ServiceDef['fee']
  limits: ServiceDef['limits']
  confirm_name: boolean
  image: string | null
  category: string | null
}

const toDef = (r: ServiceRow): ServiceDef => ({
  id: r.id, code: r.code, name: r.name, description: r.description, icon: r.icon, color: r.color, placement: r.placement,
  sort: r.sort, enabled: r.enabled, executor: r.executor, fields: r.fields, fee: r.fee, limits: r.limits, confirmName: r.confirm_name,
  ...(r.image ? { image: r.image } : {}),
  ...(r.category ? { category: r.category } : {}),
})

export async function listServices(q: Queryable, opts: { enabledOnly: boolean }): Promise<ServiceDef[]> {
  const rows = await q.query<ServiceRow>(`SELECT * FROM services WHERE ($1::boolean IS FALSE OR enabled) ORDER BY placement, sort, id`, [opts.enabledOnly])
  return rows.map(toDef)
}

export async function requireService(q: Queryable, id: string, opts: { enabledOnly: boolean }): Promise<ServiceDef> {
  const [r] = await q.query<ServiceRow>('SELECT * FROM services WHERE id = $1', [id])
  if (!r || (opts.enabledOnly && !r.enabled)) throw notFound('This service is not available')
  return toDef(r)
}

// ---------- definitions (portal) ----------

const zText = (max: number) => z.object({ en: z.string().trim().min(1).max(max), st: z.string().trim().min(1).max(max) })
const zOptText = (max: number) => z.object({ en: z.string().trim().max(max), st: z.string().trim().max(max) })
const zMoney = z.number().min(0).max(100_000)

const zField = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'keys are lowercase letters, digits and _'),
  type: z.enum(['text', 'number', 'phone', 'amount', 'select', 'date', 'checkbox', 'image']),
  label: zText(80),
  hint: zOptText(200).optional(),
  required: z.boolean(),
  minLength: z.number().int().min(0).max(500).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
  pattern: z.string().max(200).optional(),
  patternMessage: zOptText(120).optional(),
  networks: z.array(z.enum(['econet', 'vodacom'])).max(2).optional(),
  ownNumber: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.object({ value: z.string().trim().min(1).max(40), label: zText(80), amount: zMoney.optional() })).max(50).optional(),
  showOnReceipt: z.boolean().optional(),
})

export const zServiceBody = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,20}$/, 'code: 2–20 capital letters, digits, - or _'),
  name: zText(40),
  description: zOptText(120),
  icon: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'icon: an Ionicons name like phone-portrait'),
  image: z.string().max(200).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color: like #16A34A'),
  placement: z.enum(['send', 'services', 'me', 'bills']),
  sort: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  executor: z.enum(['ecocash_transfer', 'airtime', 'bundle', 'request', 'bill']),
  category: z.string().max(40).optional(),
  fields: z.array(zField).min(1).max(20),
  fee: z.object({ fixed: zMoney, percent: z.number().min(0).max(20), min: zMoney.optional(), max: zMoney.optional() }),
  limits: z.object({ min: zMoney, max: zMoney }),
  confirmName: z.boolean(),
})

/** Rules beyond the shape: unique keys, exactly one amount for money services, working patterns, etc. */
export function checkDefinition(def: ServiceBody): void {
  const keys = new Set<string>()
  for (const f of def.fields) {
    if (keys.has(f.key)) throw validation(`Two fields use the key "${f.key}"`)
    keys.add(f.key)
    if (f.pattern) {
      try {
        new RegExp(f.pattern)
      } catch {
        throw validation(`"${f.label.en}": the pattern is not a valid regular expression`)
      }
    }
    if (f.type === 'select' && !f.options?.length) throw validation(`"${f.label.en}": a list needs at least one choice`)
    if (f.type === 'image' && def.executor !== 'request') throw validation('Photos can only be asked for in request services (e.g. Update KYC)')
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) throw validation(`"${f.label.en}": min is more than max`)
  }
  const priced = def.fields.filter((f) => f.type === 'amount' || (f.type === 'select' && f.options?.some((o) => o.amount !== undefined)))
  if (def.executor === 'request') {
    if (priced.length) throw validation('Request services move no money: remove the amount or the prices')
    return
  }
  if (priced.length !== 1) throw validation('A money service needs exactly one amount field, or one list with prices')
  if (def.limits.min > def.limits.max || def.limits.max <= 0) throw validation('Limits: min must be at most max, and max more than 0')
  if (def.fee.min !== undefined && def.fee.max !== undefined && def.fee.min > def.fee.max) throw validation('Fee: min is more than max')
  if ((def.executor === 'airtime' || def.executor === 'bundle') && !def.fields.some((f) => f.type === 'phone')) {
    throw validation('Airtime and bundles need a phone number field')
  }
  if (def.executor === 'bill' && !def.fields.some((f) => f.required && (f.type === 'text' || f.type === 'number'))) {
    throw validation('A bill payment needs a required account or policy number field (text or number)')
  }
  if (def.placement === 'bills' && !def.category) throw validation('Choose the Pay bill category this biller goes in')
}

export async function saveService(q: Queryable, id: string | null, body: ServiceBody): Promise<ServiceDef> {
  checkDefinition(body)
  await checkServiceImage(q, body.image)
  if (body.category) {
    const [c] = await q.query('SELECT 1 FROM bill_categories WHERE id = $1', [body.category])
    if (!c) throw validation('That Pay bill category does not exist')
  }
  const values = [
    body.image ?? null,
    body.code, JSON.stringify(body.name), JSON.stringify(body.description), body.icon, body.color, body.placement, body.sort, body.enabled,
    body.executor, JSON.stringify(body.fields), JSON.stringify(body.fee), JSON.stringify(body.limits), body.confirmName,
    body.category ?? null,
  ]
  if (id) {
    const [r] = await q.query<ServiceRow>(
      `UPDATE services SET image=$2, code=$3, name=$4, description=$5, icon=$6, color=$7, placement=$8, sort=$9, enabled=$10, executor=$11,
         fields=$12, fee=$13, limits=$14, confirm_name=$15, category=$16, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...values],
    )
    if (!r) throw notFound('Service not found')
    return toDef(r)
  }
  const [r] = await q.query<ServiceRow>(
    `INSERT INTO services (id, image, code, name, description, icon, color, placement, sort, enabled, executor, fields, fee, limits, confirm_name, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [`svc-${newId().slice(0, 8)}`, ...values],
  )
  return toDef(r)
}

// ---------- customer side ----------

const ERROR_TEXT: Record<ServiceFieldError, string> = {
  required: 'is required',
  tooShort: 'is too short',
  tooLong: 'is too long',
  pattern: 'is not in the right format',
  number: 'must be a number',
  tooSmall: 'is too small',
  tooBig: 'is too big',
  phone: 'must be a Lesotho number',
  network: 'is on the wrong network',
  option: 'must be one of the choices',
  date: 'must be a date',
}

/** Label → value as the customer sees them (English; the app shows its own language). */
function lines(def: ServiceDef, values: ServiceValues): { label: string; value: string }[] {
  return def.fields
    .filter((f) => f.showOnReceipt !== false && values[f.key])
    .map((f) => {
      const v = values[f.key].trim()
      const value =
        f.type === 'amount' ? formatM(Math.round(Number(v) * 100))
          : f.type === 'select' ? f.options?.find((o) => o.value === v)?.label.en ?? v
            : f.type === 'checkbox' ? (v === 'true' ? 'Yes' : 'No')
              : f.type === 'image' ? 'Photo attached'
                : v
      return { label: f.label.en, value }
    })
}

/** Only the service's own fields, trimmed. */
function clean(def: ServiceDef, values: ServiceValues): ServiceValues {
  const out: ServiceValues = {}
  for (const f of def.fields) if (typeof values[f.key] === 'string' && values[f.key].trim()) out[f.key] = values[f.key].trim().slice(0, 500)
  return out
}

interface Priced {
  values: ServiceValues
  amountCents: number
  feeCents: number
  recipientName?: string
}

async function price(ctx: Ctx, def: ServiceDef, raw: ServiceValues): Promise<Priced> {
  const values = clean(def, raw)
  const errors = checkServiceValues(def, values)
  const first = Object.entries(errors)[0]
  if (first) {
    const f = def.fields.find((x) => x.key === first[0])!
    throw validation(first[1] === 'pattern' && f.patternMessage?.en ? `${f.label.en}: ${f.patternMessage.en}` : `${f.label.en} ${ERROR_TEXT[first[1]]}`)
  }
  if (def.executor === 'request') return { values, amountCents: 0, feeCents: 0 }
  const amount = serviceAmount(def, values)
  if (amount === null) throw validation('Choose an amount')
  const amountCents = paymentCents(amount)
  if (amountCents < def.limits.min * 100) throw validation(`The least you can send is ${formatM(def.limits.min * 100)}`)
  if (amountCents > def.limits.max * 100) throw new AppError('LIMIT_EXCEEDED', `The most you can send is ${formatM(def.limits.max * 100)}`)
  const feeCents = Math.round(serviceFee(def.fee, amountCents / 100) * 100)
  const recipientName = def.confirmName ? (await ctx.services.lookupName(def.code, values)) ?? undefined : undefined
  return { values, amountCents, feeCents, recipientName }
}

export async function quote(ctx: Ctx, id: string, raw: ServiceValues): Promise<ServiceQuote> {
  const def = await requireService(ctx.db, id, { enabledOnly: true })
  const p = await price(ctx, def, raw)
  const q: ServiceQuote = { amount: fromCents(p.amountCents), fee: fromCents(p.feeCents), total: fromCents(p.amountCents + p.feeCents), lines: lines(def, p.values) }
  if (p.recipientName) q.recipientName = p.recipientName
  return q
}

/** Who or what the money went to, for the statement line. */
function target(def: ServiceDef, values: ServiceValues): string {
  const f = def.fields.find((x) => x.type === 'phone' || (x.type === 'text' && x.key !== 'reference')) ?? def.fields.find((x) => x.type === 'select')
  if (!f || !values[f.key]) return ''
  if (f.type === 'select') return f.options?.find((o) => o.value === values[f.key])?.label.en ?? values[f.key]
  const v = values[f.key]
  return phoneNetwork(v) ? v.replace(/\D/g, '').slice(-8) : v
}

export async function submit(ctx: Ctx, me: UserRow, id: string, body: { values: ServiceValues; pin: string; clientId: string }, opts: { pinConfirmed?: boolean } = {}): Promise<ServiceResult> {
  const [done] = await ctx.db.query<{ result: ServiceResult }>('SELECT result FROM service_submissions WHERE user_id = $1 AND client_id = $2', [me.id, body.clientId])
  if (done) return done.result
  const def = await requireService(ctx.db, id, { enabledOnly: true })
  const p = await price(ctx, def, body.values)
  if (!opts.pinConfirmed) await checkPin(ctx.db, me, body.pin)
  const shown = lines(def, p.values)

  if (def.executor === 'request') {
    const files = def.fields.filter((f) => f.type === 'image' && p.values[f.key]).map((f) => ({ key: f.key, label: f.label.en, uploadId: p.values[f.key] }))
    return ctx.tx(async (q) => {
      await requireOwnUploads(q, me.id, files.map((f) => ({ label: f.label, uploadId: f.uploadId })))
      await markUsed(q, files.map((f) => f.uploadId))
      const [{ n }] = await q.query<{ n: string }>(`SELECT nextval('service_request_seq') AS n`)
      const reference = `SR-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`
      const reqId = newId()
      await q.query(
        `INSERT INTO service_requests (id, reference, user_id, service_id, service_name, lines, files) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        // What the customer entered (ID numbers, addresses) is sealed at rest (DATA_KEYS).
        [reqId, reference, me.id, def.id, JSON.stringify(def.name), JSON.stringify(sealJson(shown)), JSON.stringify(files)],
      )
      const request = await loadRequest(q, reqId)
      const result: ServiceResult = { reference, request, lines: shown }
      await q.query(
        `INSERT INTO service_submissions (id, user_id, client_id, service_id, reference, request_id, result) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId(), me.id, body.clientId, def.id, reference, reqId, JSON.stringify(result)],
      )
      return result
    })
  }

  const reference = `SV${randomDigits(10)}`
  const to = target(def, p.values)
  const label = [def.name.en, to].filter(Boolean).join(' · ')
  return ctx.tx(async (q, out) => {
    const main = await ctx.ledger.transfer(q, { kind: 'service', fromUserId: me.id, toUserId: null, amountCents: p.amountCents, label })
    const balances = new Map(main.balances)
    if (p.feeCents > 0) {
      const fees = await feesAccount(q)
      const fee = await ctx.ledger.transfer(q, { kind: 'fee', fromUserId: me.id, toUserId: fees.id, amountCents: p.feeCents, label: `${def.name.en} fee` })
      for (const [k, v] of fee.balances) balances.set(k, v)
    }
    // Inside the transaction on purpose: if EcoCash refuses, the debit above is rolled back.
    await ctx.services.execute({ code: def.code, executor: def.executor as Exclude<ServiceDef['executor'], 'request'>, amountCents: p.amountCents, values: p.values, reference })
    for (const [userId, cents] of balances) out.balance(userId, cents)
    const [transaction] = await toTransactions(q, [main.tx], me.id)
    const result: ServiceResult = {
      reference,
      balance: fromCents(balances.get(me.id)),
      transaction,
      lines: [...(p.recipientName ? [{ label: 'Name', value: p.recipientName }] : []), ...shown, ...(p.feeCents ? [{ label: 'Fee', value: formatM(p.feeCents) }] : [])],
    }
    await q.query(
      `INSERT INTO service_submissions (id, user_id, client_id, service_id, reference, amount_cents, fee_cents, transaction_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId(), me.id, body.clientId, def.id, reference, p.amountCents, p.feeCents, main.tx.id, JSON.stringify(result)],
    )
    return result
  })
}

// ---------- requests (e.g. Update KYC) ----------

export interface RequestRow {
  id: string
  reference: string
  user_id: string
  service_id: string | null
  service_name: LocalizedText
  lines: { label: string; value: string }[]
  files: { key: string; label: string; uploadId: string }[]
  status: ServiceRequest['status']
  note: string | null
  created_at: Date
  updated_at: Date
}

export function toRequest(r: RequestRow): ServiceRequest {
  const s: ServiceRequest = {
    id: r.id, reference: r.reference, serviceId: r.service_id ?? '', serviceName: r.service_name, status: r.status, lines: openJson<RequestRow['lines']>(r.lines),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  }
  if (r.note) s.note = r.note
  return s
}

export async function loadRequest(q: Queryable, id: string): Promise<ServiceRequest> {
  const [r] = await q.query<RequestRow>('SELECT * FROM service_requests WHERE id = $1', [id])
  if (!r) throw notFound('Request not found')
  return toRequest(r)
}

export async function myRequests(q: Queryable, me: UserRow): Promise<ServiceRequest[]> {
  return (await q.query<RequestRow>('SELECT * FROM service_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [me.id])).map(toRequest)
}
