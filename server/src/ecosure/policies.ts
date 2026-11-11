// EcoSure funeral policies: buy, change, members, premiums (from the wallet into the EcoSure system wallet).
import {
  ECOSURE_DEPENDANT_LIMIT,
  ECOSURE_GRACE_DAYS,
  type EsAddMemberBody,
  type EsBuyBody,
  type EsBuyResult,
  type EsCover,
  type EsMember,
  type EsPayBody,
  type EsPayment,
  type EsPayResult,
  type EsPolicy,
  type EsPolicyLookup,
  type EsPolicyStatus,
  type EsRelationship,
  type EsUpdatePolicyBody,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { MAX_TRANSACTION_CENTS, formatM, fromCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { moneyResult } from '../services/money'
import { checkPin } from '../services/pins'
import { displayName, requireWallet, type UserRow } from '../services/users'
import { addMonths, firstName, formatDate, isDate, notify, todayMaseru, ecosureAccount } from './account'
import { coverPremiumCents, loadProducts, requireProduct, type Product } from './catalogue'

export interface PolicyRow {
  id: string
  number: string
  holder_id: string
  product_code: string
  product_name: string
  line: 'funeral' | 'short_term'
  cover: EsCover
  premium_cents: number
  id_number: string
  full_name: string
  dob: string
  gender: 'female' | 'male'
  beneficiary_name: string | null
  beneficiary_msisdn: string | null
  paid_until: string
  cancelled_at: Date | null
  created_at: Date
  holder_msisdn: string | null
  holder_name: string
  status: EsPolicyStatus
  sponsor_name: string | null
}

/** Derived status; $1 is today's date (Maseru). */
export const POLICY_STATUS_SQL = `CASE WHEN p.cancelled_at IS NOT NULL THEN 'cancelled'
  WHEN p.paid_until >= $1::date THEN 'active'
  WHEN p.paid_until + ${ECOSURE_GRACE_DAYS} >= $1::date THEN 'grace'
  ELSE 'lapsed' END`

/** Policy rows; `where` may use $2… for `params` ($1 is today). */
export function policyRows(q: Queryable, where: string, params: unknown[] = [], tail = 'ORDER BY p.created_at DESC, p.number DESC'): Promise<PolicyRow[]> {
  return q.query<PolicyRow>(
    `SELECT p.id, p.number, p.holder_id, p.product_code, pr.name AS product_name, pr.line, p.cover, p.premium_cents,
       p.id_number, p.full_name, p.dob::text AS dob, p.gender, p.beneficiary_name, p.beneficiary_msisdn,
       p.paid_until::text AS paid_until, p.cancelled_at, p.created_at, u.msisdn AS holder_msisdn, u.name AS holder_name,
       ${POLICY_STATUS_SQL} AS status,
       (SELECT COALESCE(s.business_name, s.name) FROM ecosure_sponsorships sp JOIN users s ON s.id = sp.sponsor_id
         WHERE sp.policy_id = p.id AND sp.status = 'active' ORDER BY sp.updated_at DESC LIMIT 1) AS sponsor_name
     FROM ecosure_policies p JOIN ecosure_products pr ON pr.code = p.product_code JOIN users u ON u.id = p.holder_id
     WHERE ${where} ${tail}`,
    [todayMaseru(), ...params],
  )
}

interface MemberRow {
  id: string
  policy_id: string
  name: string
  relationship: EsRelationship
  dob: string | null
}

export async function toPolicies(q: Queryable, rows: PolicyRow[]): Promise<EsPolicy[]> {
  if (!rows.length) return []
  const members = await q.query<MemberRow>(
    `SELECT id, policy_id, name, relationship, dob::text AS dob FROM ecosure_members
     WHERE policy_id = ANY($1) AND removed_at IS NULL ORDER BY (relationship = 'main') DESC, created_at, name`,
    [rows.map((r) => r.id)],
  )
  return rows.map((r) => {
    const p: EsPolicy = {
      id: r.id,
      number: r.number,
      productCode: r.product_code,
      packageName: r.product_name,
      cover: r.cover,
      premium: fromCents(r.premium_cents),
      status: r.status,
      nextDue: r.paid_until,
      holder: { name: r.full_name, idNumber: r.id_number, dob: r.dob, gender: r.gender, msisdn: r.holder_msisdn ?? '' },
      members: members
        .filter((m) => m.policy_id === r.id)
        .map((m) => {
          const member: EsMember = { id: m.id, name: m.name, relationship: m.relationship }
          if (m.dob) member.dob = m.dob
          return member
        }),
      createdAt: iso(r.created_at),
    }
    if (r.beneficiary_name) {
      p.beneficiary = { name: r.beneficiary_name }
      if (r.beneficiary_msisdn) p.beneficiary.msisdn = r.beneficiary_msisdn
    }
    if (r.sponsor_name) p.sponsoredBy = { name: r.sponsor_name }
    return p
  })
}

export async function loadPolicy(q: Queryable, id: string): Promise<EsPolicy> {
  const [p] = await toPolicies(q, await policyRows(q, 'p.id = $2', [id]))
  if (!p) throw notFound('Policy not found')
  return p
}

export const myPolicies = async (q: Queryable, me: UserRow) => toPolicies(q, await policyRows(q, 'p.holder_id = $2', [me.id]))

/** The caller's own policy (404 for anyone else's). `lock` takes a row lock first (inside a transaction). */
export async function requireOwnPolicy(q: Queryable, me: UserRow, id: string, lock = false): Promise<PolicyRow> {
  if (lock) await q.query('SELECT id FROM ecosure_policies WHERE id = $1 FOR UPDATE', [id])
  const [r] = await policyRows(q, 'p.id = $2', [id])
  if (!r || r.holder_id !== me.id) throw notFound('Policy not found')
  return r
}

export function toLookup(r: PolicyRow): EsPolicyLookup {
  return {
    number: r.number,
    holderFirstName: firstName(r.full_name),
    packageName: r.product_name,
    cover: r.cover,
    premium: fromCents(r.premium_cents),
    nextDue: r.paid_until,
    status: r.status,
  }
}

const coverName = (c: EsCover) => (c === 'family' ? 'Family' : 'Single')

function requireNotCancelled(r: PolicyRow) {
  if (r.status === 'cancelled') throw conflict(`Policy ${r.number} is cancelled`)
}

function requireFuneral(p: Product): Product {
  if (p.line !== 'funeral') throw validation(`${p.name} can't be bought here. Ask for a quote instead`)
  return p
}

function cleanText(v: string | undefined, max: number, field: string): string | null {
  const s = v?.trim()
  if (!s) return null
  if (s.length > max) throw validation(`${field} must be at most ${max} characters`)
  return s
}

function parseDob(dob: string | undefined, field: string): string | null {
  if (dob === undefined || dob === '') return null
  if (!isDate(dob)) throw validation(`${field} must be a date like 1990-05-31`)
  if (dob > todayMaseru()) throw validation(`${field} can't be in the future`)
  return dob
}

async function openFuneralPolicy(q: Queryable, holderId: string): Promise<string | null> {
  const [r] = await q.query<{ number: string }>(
    `SELECT p.number FROM ecosure_policies p JOIN ecosure_products pr ON pr.code = p.product_code
     WHERE p.holder_id = $1 AND pr.line = 'funeral' AND p.cancelled_at IS NULL LIMIT 1`,
    [holderId],
  )
  return r?.number ?? null
}

// ---------- payments ----------

interface PaymentRow {
  id: string
  receipt: string
  policy_number: string
  full_name: string
  amount_cents: number
  months: number
  payer_name: string
  payer_business: string | null
  created_at: Date
}

const PAYMENT_SELECT = `SELECT pay.id, pay.receipt, p.number AS policy_number, p.full_name, pay.amount_cents, pay.months,
    u.name AS payer_name, u.business_name AS payer_business, pay.created_at
  FROM ecosure_payments pay JOIN ecosure_policies p ON p.id = pay.policy_id JOIN users u ON u.id = pay.payer_id`

const toPayment = (r: PaymentRow): EsPayment => ({
  id: r.id,
  receipt: r.receipt,
  policyNumber: r.policy_number,
  holderFirstName: firstName(r.full_name),
  amount: fromCents(r.amount_cents),
  months: r.months,
  payerName: displayName({ name: r.payer_name, business_name: r.payer_business }),
  createdAt: iso(r.created_at),
})

/** Paid by me or for my policies, newest first. */
export async function myPayments(q: Queryable, me: UserRow): Promise<EsPayment[]> {
  const rows = await q.query<PaymentRow>(`${PAYMENT_SELECT} WHERE pay.payer_id = $1 OR p.holder_id = $1 ORDER BY pay.created_at DESC, pay.receipt DESC LIMIT 200`, [
    me.id,
  ])
  return rows.map(toPayment)
}

/** Premium from the payer's wallet into the EcoSure wallet, plus the payment row. Inside a transaction. */
async function takePremium(ctx: Ctx, q: Queryable, out: Outbox, payer: UserRow, policyId: string, number: string, amountCents: number, months: number) {
  const es = await ecosureAccount(q)
  const result = await ctx.ledger.transfer(q, { kind: 'ecosure', fromUserId: payer.id, toUserId: es.id, amountCents, label: `EcoSure premium · ${number}` })
  for (const [userId, cents] of result.balances) out.balance(userId, cents)
  const [row] = await q.query<{ id: string }>(
    'INSERT INTO ecosure_payments (id, policy_id, payer_id, amount_cents, months, transaction_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [newId(), policyId, payer.id, amountCents, months, result.tx.id],
  )
  const [payment] = await q.query<PaymentRow>(`${PAYMENT_SELECT} WHERE pay.id = $1`, [row.id])
  return { result, payment: toPayment(payment) }
}

// ---------- buy ----------

export async function buy(ctx: Ctx, me: UserRow, body: EsBuyBody): Promise<EsBuyResult> {
  if (body.acceptedTerms !== true) throw validation('Please accept the terms and conditions')
  const product = requireFuneral(await requireProduct(ctx.db, body.productCode))
  const premiumCents = coverPremiumCents(product, body.cover)
  const fullName = cleanText(body.fullName, 80, 'fullName')
  if (!fullName || fullName.length < 2) throw validation('fullName is required')
  const idNumber = cleanText(body.idNumber, 30, 'idNumber')
  if (!idNumber) throw validation('idNumber is required')
  const dob = parseDob(body.dob, 'dob')
  if (!dob) throw validation('dob is required')
  const beneficiaryName = cleanText(body.beneficiaryName, 80, 'beneficiaryName')
  const beneficiaryMsisdn = body.beneficiaryMsisdn?.trim() ? normalizeMsisdn(body.beneficiaryMsisdn, 'beneficiaryMsisdn') : null
  if (beneficiaryMsisdn && !beneficiaryName) throw validation('beneficiaryName is required with beneficiaryMsisdn')
  const existing = await openFuneralPolicy(ctx.db, me.id)
  if (existing) throw conflict(`You already have EcoSure funeral cover (${existing}). Change your package instead`)
  await checkPin(ctx.db, me, body.pin)

  const { id, payment, money } = await ctx.tx(async (q, out) => {
    const [{ number }] = await q.query<{ number: string }>(`SELECT 'ES-' || lpad(nextval('ecosure_policy_number_seq')::text, 6, '0') AS number`)
    const paidUntil = addMonths(todayMaseru(), 1)
    const id = newId()
    await q.query(
      `INSERT INTO ecosure_policies (id, number, holder_id, product_code, cover, premium_cents, id_number, full_name, dob, gender,
         beneficiary_name, beneficiary_msisdn, paid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, number, me.id, product.code, body.cover, premiumCents, idNumber, fullName, dob, body.gender, beneficiaryName, beneficiaryMsisdn, paidUntil],
    )
    await q.query(`INSERT INTO ecosure_members (id, policy_id, name, relationship, dob) VALUES ($1, $2, $3, 'main', $4)`, [newId(), id, fullName, dob])
    const { result, payment } = await takePremium(ctx, q, out, me, id, number, premiumCents, 1)
    // The ledger holds the buyer's wallet lock from here on, so a concurrent second purchase sees this one.
    const [{ n }] = await q.query<{ n: number }>(
      `SELECT count(*) AS n FROM ecosure_policies p JOIN ecosure_products pr ON pr.code = p.product_code
       WHERE p.holder_id = $1 AND pr.line = 'funeral' AND p.cancelled_at IS NULL`,
      [me.id],
    )
    if (n > 1) throw conflict('You already have EcoSure funeral cover. Change your package instead')
    const message = await notify(
      q,
      out,
      me.id,
      `Welcome to EcoSure. Your ${product.name} ${coverName(body.cover)} cover ${number} has started. ` +
        `Next premium ${formatM(premiumCents)} due ${formatDate(paidUntil)}.
Receipt ${payment.receipt} · ${formatM(premiumCents)}`,
    )
    return { id, payment, money: await moneyResult(q, me, result, message) }
  })
  return { policy: await loadPolicy(ctx.db, id), payment, money }
}

// ---------- change ----------

export async function updatePolicy(ctx: Ctx, me: UserRow, id: string, body: EsUpdatePolicyBody): Promise<EsPolicy> {
  await ctx.tx(async (q, out) => {
    const r = await requireOwnPolicy(q, me, id, true)
    requireNotCancelled(r)
    let productCode = r.product_code
    let premiumCents = r.premium_cents
    let changedPackage: Product | null = null
    if (body.productCode !== undefined && body.productCode.trim().toUpperCase() !== r.product_code) {
      changedPackage = requireFuneral(await requireProduct(q, body.productCode))
      productCode = changedPackage.code
      premiumCents = coverPremiumCents(changedPackage, r.cover)
    }
    let beneficiaryName = r.beneficiary_name
    let beneficiaryMsisdn = r.beneficiary_msisdn
    if (body.beneficiaryName !== undefined) {
      beneficiaryName = cleanText(body.beneficiaryName, 80, 'beneficiaryName')
      if (!beneficiaryName) beneficiaryMsisdn = null
    }
    if (body.beneficiaryMsisdn !== undefined) {
      beneficiaryMsisdn = body.beneficiaryMsisdn.trim() ? normalizeMsisdn(body.beneficiaryMsisdn, 'beneficiaryMsisdn') : null
    }
    if (beneficiaryMsisdn && !beneficiaryName) throw validation('beneficiaryName is required with beneficiaryMsisdn')
    await q.query(
      'UPDATE ecosure_policies SET product_code = $2, premium_cents = $3, beneficiary_name = $4, beneficiary_msisdn = $5 WHERE id = $1',
      [id, productCode, premiumCents, beneficiaryName, beneficiaryMsisdn],
    )
    if (changedPackage) {
      await notify(
        q,
        out,
        me.id,
        `Your EcoSure cover ${r.number} is now ${changedPackage.name} ${coverName(r.cover)} cover. ` +
          `The new premium of ${formatM(premiumCents)} applies from your next payment, due ${formatDate(r.paid_until)}.`,
      )
    }
  })
  return loadPolicy(ctx.db, id)
}

export async function migratePolicy(ctx: Ctx, me: UserRow, id: string, cover: EsCover): Promise<EsPolicy> {
  await ctx.tx(async (q, out) => {
    const r = await requireOwnPolicy(q, me, id, true)
    requireNotCancelled(r)
    if (r.cover === cover) throw validation(`This policy is already ${coverName(cover)} cover`)
    const [product] = await loadProducts(q, { codes: [r.product_code] })
    const premiumCents = coverPremiumCents(product, cover)
    await q.query('UPDATE ecosure_policies SET cover = $2, premium_cents = $3 WHERE id = $1', [id, cover, premiumCents])
    let removed = 0
    if (cover === 'single') {
      removed = (
        await q.query(
          `UPDATE ecosure_members SET removed_at = now() WHERE policy_id = $1 AND relationship <> 'main' AND removed_at IS NULL RETURNING id`,
          [id],
        )
      ).length
    }
    await notify(
      q,
      out,
      me.id,
      `Your EcoSure cover ${r.number} is now ${product.name} ${coverName(cover)} cover` +
        (removed ? ` (${removed} dependant${removed === 1 ? '' : 's'} removed from cover)` : '') +
        `. The new premium of ${formatM(premiumCents)} applies from your next payment, due ${formatDate(r.paid_until)}.`,
    )
  })
  return loadPolicy(ctx.db, id)
}

export async function addMember(ctx: Ctx, me: UserRow, id: string, body: EsAddMemberBody): Promise<EsPolicy> {
  const name = cleanText(body.name, 80, 'name')
  if (!name) throw validation('name is required')
  const dob = parseDob(body.dob, 'dob')
  await ctx.tx(async (q) => {
    const r = await requireOwnPolicy(q, me, id, true)
    requireNotCancelled(r)
    if (r.cover !== 'family') throw validation('Dependants can only be added to Family cover. Change to Family cover first')
    if (ECOSURE_DEPENDANT_LIMIT !== null) {
      const [{ n }] = await q.query<{ n: number }>(
        `SELECT count(*) AS n FROM ecosure_members WHERE policy_id = $1 AND relationship <> 'main' AND removed_at IS NULL`,
        [id],
      )
      if (n >= ECOSURE_DEPENDANT_LIMIT) throw conflict(`Family cover allows up to ${ECOSURE_DEPENDANT_LIMIT} dependants`)
    }
    await q.query('INSERT INTO ecosure_members (id, policy_id, name, relationship, dob) VALUES ($1, $2, $3, $4, $5)', [newId(), id, name, body.relationship, dob])
  })
  return loadPolicy(ctx.db, id)
}

export async function removeMember(ctx: Ctx, me: UserRow, id: string, memberId: string): Promise<EsPolicy> {
  await ctx.tx(async (q) => {
    const r = await requireOwnPolicy(q, me, id, true)
    requireNotCancelled(r)
    const [m] = await q.query<{ relationship: EsRelationship }>(
      'SELECT relationship FROM ecosure_members WHERE id = $1 AND policy_id = $2 AND removed_at IS NULL',
      [memberId, id],
    )
    if (!m) throw notFound('Member not found on this policy')
    if (m.relationship === 'main') throw validation("The main member can't be removed")
    if (r.cover !== 'family') throw validation('Only Family cover has dependants')
    await q.query('UPDATE ecosure_members SET removed_at = now() WHERE id = $1', [memberId])
  })
  return loadPolicy(ctx.db, id)
}

// ---------- lookup & pay (anyone can pay any policy) ----------

/** "ES-101", "es000101" → "ES-000101"; null when it isn't a policy number. */
export function parsePolicyNumber(ref: string): string | null {
  const m = /^ES-?(\d{1,9})$/i.exec(ref.trim())
  return m ? `ES-${m[1].padStart(6, '0')}` : null
}

export async function findPolicy(q: Queryable, ref: string): Promise<PolicyRow> {
  const number = parsePolicyNumber(ref)
  if (number) {
    const [r] = await policyRows(q, 'p.number = $2', [number])
    if (!r) throw notFound(`No EcoSure policy ${number}`)
    return r
  }
  if (!/\d/.test(ref)) throw validation('Enter a policy number like ES-000101 or a phone number')
  const holder = await requireWallet(q, normalizeMsisdn(ref, 'ref'))
  const [r] = await policyRows(
    q,
    'p.holder_id = $2 AND p.cancelled_at IS NULL',
    [holder.id],
    `ORDER BY (pr.line = 'funeral') DESC, p.created_at DESC LIMIT 1`,
  )
  if (!r) throw notFound(`${holder.msisdn} has no EcoSure policy`)
  return r
}

export const lookup = async (q: Queryable, ref: string): Promise<EsPolicyLookup> => toLookup(await findPolicy(q, ref))

export async function payPremium(ctx: Ctx, me: UserRow, body: EsPayBody): Promise<EsPayResult> {
  const number = parsePolicyNumber(body.policyNumber)
  if (!number) throw validation('policyNumber must be like ES-000101')
  const months = body.months ?? 1
  const pre = await findPolicy(ctx.db, number)
  requireNotCancelled(pre)
  if (pre.premium_cents * months > MAX_TRANSACTION_CENTS) throw new AppError('LIMIT_EXCEEDED', 'That is more than you can pay at once. Pay fewer months')
  await checkPin(ctx.db, me, body.pin)

  return ctx.tx(async (q, out) => {
    await q.query('SELECT id FROM ecosure_policies WHERE id = $1 FOR UPDATE', [pre.id])
    const [r] = await policyRows(q, 'p.id = $2', [pre.id])
    requireNotCancelled(r)
    const amountCents = r.premium_cents * months
    const { result, payment } = await takePremium(ctx, q, out, me, r.id, r.number, amountCents, months)
    // Lapsed cover restarts from today; otherwise the months continue from the date already paid up to.
    const base = r.status === 'lapsed' ? todayMaseru() : r.paid_until
    const paidUntil = addMonths(base, months)
    await q.query('UPDATE ecosure_policies SET paid_until = $2 WHERE id = $1', [r.id, paidUntil])
    const forWhom = r.holder_id === me.id ? '' : ` (${firstName(r.full_name)})`
    const message = await notify(
      q,
      out,
      me.id,
      `Payment received. Receipt ${payment.receipt} · ${formatM(amountCents)} for EcoSure cover ${r.number}${forWhom}. ` +
        `Paid up to ${formatDate(paidUntil)}.`,
    )
    if (r.holder_id !== me.id) {
      await notify(
        q,
        out,
        r.holder_id,
        `${displayName(me)} paid ${formatM(amountCents)} towards your EcoSure cover ${r.number}. Paid up to ${formatDate(paidUntil)}.`,
      )
    }
    return { payment, money: await moneyResult(q, me, result, message) }
  })
}
