// Loans from a society (Mekhatlo). Contract: shared/api.ts "Loans from the society".
// The executives set the society's terms. A member asks; the other executives approve (never the borrower), and the
// society's wallet pays the borrower through the ledger. Interest is simple and due with the loan on the due date.
// The borrower repays in parts into the society. A sweeper reminds borrowers before the due date and while overdue
// (telling the executives too), and expires loans nobody approved in time.
import {
  loanTotal,
  SOCIETY_LOAN_APPROVAL_HOURS,
  type MoneyResult,
  type SocietyLoan,
  type SocietyLoanBody,
  type SocietyLoanReport,
  type SocietyLoans,
  type SocietyLoanSettings,
  type SocietyLoanStatus,
  type SocietyLoanTermChange,
  type SocietyRepayBody,
  type SocietyRole,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso } from '../lib/time'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { loadSociety, requireRole, roleOf, signatoryIds, type SocietyRow } from './societies'
import { getUsers, toPublicUser, type UserRow } from './users'

type Out = Parameters<Parameters<Ctx['tx']>[0]>[1]

interface LoanRow {
  id: string
  reference: string
  society_id: string
  borrower_id: string
  amount_cents: number
  interest_bp: number
  months: number
  total_cents: number
  repaid_cents: number
  purpose: string | null
  status: SocietyLoanStatus
  rejected_by: string | null
  created_at: Date
  expires_at: Date
  paid_out_at: Date | null
  due_at: Date | null
  repaid_at: Date | null
}

/** Days before the due date that the borrower is reminded, and how often while overdue. */
const REMIND_BEFORE_DAYS = 3
const LATE_EVERY_DAYS = 7

const settingsOf = (s: SocietyRow): SocietyLoanSettings => ({
  enabled: s.loans_enabled,
  interestPercent: s.loan_interest_bp / 100,
  maxMonths: s.loan_max_months,
  ...(s.loan_max_cents ? { maxAmount: fromCents(Number(s.loan_max_cents)) } : {}),
})

/** Who approves a loan: the executives other than the borrower, as many as the society needs (or all of them). */
async function approversFor(q: Queryable, s: SocietyRow, borrowerId: string) {
  const others = (await signatoryIds(q, s.id)).filter((u) => u !== borrowerId)
  return { others, required: Math.min(s.approvals_required, others.length) }
}

async function expireDue(q: Queryable) {
  await q.query(`UPDATE society_loans SET status = 'expired' WHERE status = 'pending' AND expires_at <= now()`)
}

async function toLoans(q: Queryable, rows: LoanRow[], s: SocietyRow, meId: string | null, myRole: SocietyRole | null): Promise<SocietyLoan[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const approvals = await q.query<{ loan_id: string; user_id: string; at: Date }>('SELECT * FROM society_loan_approvals WHERE loan_id = ANY($1) ORDER BY at', [ids])
  const repayments = await q.query<{ loan_id: string; amount_cents: number; at: Date }>('SELECT loan_id, amount_cents, at FROM society_loan_repayments WHERE loan_id = ANY($1) ORDER BY at', [ids])
  const signatories = await signatoryIds(q, s.id)
  const users = await getUsers(q, [...rows.flatMap((r) => [r.borrower_id, r.rejected_by ?? '']), ...approvals.map((a) => a.user_id)].filter(Boolean))
  const pub = (id: string) => toPublicUser(users.get(id)!)
  const now = Date.now()
  return rows.map((r) => {
    const mine = approvals.filter((a) => a.loan_id === r.id)
    const others = signatories.filter((u) => u !== r.borrower_id)
    const total = Number(r.total_cents)
    const repaid = Number(r.repaid_cents)
    const loan: SocietyLoan = {
      id: r.id,
      reference: r.reference,
      borrower: pub(r.borrower_id),
      amount: fromCents(Number(r.amount_cents)),
      months: r.months,
      interestPercent: r.interest_bp / 100,
      total: fromCents(total),
      repaid: fromCents(repaid),
      outstanding: fromCents(total - repaid),
      status: r.status,
      overdue: r.status === 'active' && !!r.due_at && r.due_at.getTime() < now,
      approvals: mine.map((a) => ({ user: pub(a.user_id), at: iso(a.at) })),
      approvalsRequired: Math.min(s.approvals_required, others.length),
      createdAt: iso(r.created_at),
      repayments: repayments.filter((p) => p.loan_id === r.id).map((p) => ({ amount: fromCents(Number(p.amount_cents)), at: iso(p.at) })),
    }
    if (r.purpose) loan.purpose = r.purpose
    if (r.rejected_by) loan.rejectedBy = pub(r.rejected_by)
    if (r.status === 'pending') loan.expiresAt = iso(r.expires_at)
    if (r.paid_out_at) loan.paidOutAt = iso(r.paid_out_at)
    if (r.due_at) loan.dueAt = iso(r.due_at)
    if (r.repaid_at) loan.repaidAt = iso(r.repaid_at)
    if (myRole === 'signatory' && meId && meId !== r.borrower_id) {
      loan.canDecide = r.status === 'pending' && !mine.some((a) => a.user_id === meId)
    }
    return loan
  })
}

function report(loans: SocietyLoan[]): SocietyLoanReport {
  const out = loans.filter((l) => l.status === 'active' || l.status === 'repaid')
  const active = loans.filter((l) => l.status === 'active')
  const late = active.filter((l) => l.overdue)
  const cents = (xs: number[]) => fromCents(xs.reduce((a, x) => a + Math.round(x * 100), 0))
  return {
    outstanding: cents(active.map((l) => l.outstanding)),
    overdue: cents(late.map((l) => l.outstanding)),
    overdueCount: late.length,
    activeCount: active.length,
    lentTotal: cents(out.map((l) => l.amount)),
    interestTotal: cents(out.map((l) => l.total - l.amount)),
    repaidTotal: cents(out.map((l) => l.repaid)),
  }
}

// ---------- members and executives ----------

export async function societyLoans(q: Queryable, me: UserRow | null, societyId: string): Promise<SocietyLoans> {
  await expireDue(q)
  // me null: the portal, which sees everything as an executive would (without deciding).
  const role: SocietyRole = me ? await requireRole(q, societyId, me, 'member') : 'signatory'
  const s = await loadSociety(q, societyId)
  const rows = await q.query<LoanRow>(
    `SELECT * FROM society_loans WHERE society_id = $1 ${role === 'signatory' ? '' : 'AND borrower_id = $2'}
     ORDER BY (status = 'pending') DESC, (status = 'active') DESC, created_at DESC LIMIT 200`,
    role === 'signatory' ? [societyId] : [societyId, me!.id],
  )
  const loans = await toLoans(q, rows, s, me?.id ?? null, role)
  await expireTerms(q)
  const terms = role === 'signatory' ? await pendingTerms(q, s, me?.id ?? null) : undefined
  return { settings: settingsOf(s), ...(terms ? { pendingTerms: terms } : {}), loans, ...(role === 'signatory' ? { report: report(loans) } : {}) }
}

interface TermRow {
  id: string
  society_id: string
  proposed_by: string
  enabled: boolean
  interest_bp: number
  max_months: number
  max_cents: number | null
  approved_by: string[]
  created_at: Date
  expires_at: Date
}

const termsText = (enabled: boolean, bp: number, months: number, maxCents: number | null) =>
  enabled ? `Loans on: ${bp / 100}% interest a month, up to ${months} months${maxCents ? `, at most ${formatM(maxCents)}` : ''}.` : 'Loans off.'

/** Proposals waiting longer than payouts do are dropped. */
async function expireTerms(q: Queryable) {
  await q.query(`UPDATE society_loan_term_changes SET status = 'expired', decided_at = now() WHERE status = 'pending' AND expires_at <= now()`)
}

async function pendingTerms(q: Queryable, s: SocietyRow, meId: string | null): Promise<SocietyLoanTermChange | undefined> {
  const [c] = await q.query<TermRow>(`SELECT * FROM society_loan_term_changes WHERE society_id = $1 AND status = 'pending'`, [s.id])
  if (!c) return undefined
  const users = await getUsers(q, [c.proposed_by, ...c.approved_by])
  return {
    id: c.id,
    settings: { enabled: c.enabled, interestPercent: c.interest_bp / 100, maxMonths: c.max_months, ...(c.max_cents ? { maxAmount: fromCents(Number(c.max_cents)) } : {}) },
    proposedBy: toPublicUser(users.get(c.proposed_by)!),
    approvals: c.approved_by.map((u) => toPublicUser(users.get(u)!)),
    approvalsRequired: Math.min(s.approvals_required, (await signatoryIds(q, s.id)).length),
    createdAt: iso(c.created_at),
    expiresAt: iso(c.expires_at),
    canDecide: !!meId && !c.approved_by.includes(meId),
  }
}

async function applyTerms(q: Queryable, out: Out, s: SocietyRow, c: TermRow, by: UserRow) {
  await q.query(
    'UPDATE societies SET loans_enabled = $2, loan_interest_bp = $3, loan_max_months = $4, loan_max_cents = $5 WHERE id = $1',
    [s.id, c.enabled, c.interest_bp, c.max_months, c.max_cents],
  )
  await q.query(`UPDATE society_loan_term_changes SET status = 'applied', decided_by = $2, decided_at = now() WHERE id = $1`, [c.id, by.id])
  out.notify({
    userIds: (await signatoryIds(q, s.id)).filter((u) => u !== by.id),
    category: 'money',
    title: `${s.name}: new loan terms`,
    body: `The new loan terms apply now. ${termsText(c.enabled, c.interest_bp, c.max_months, c.max_cents == null ? null : Number(c.max_cents))}`,
    data: { screen: 'society' },
  })
}

/**
 * An executive proposes new loan terms. The proposer counts as one approval; when the society needs more, the other
 * executives approve or reject before anything changes.
 */
export async function setLoanSettings(ctx: Ctx, me: UserRow, societyId: string, body: SocietyLoanSettings): Promise<SocietyLoans> {
  await requireRole(ctx.db, societyId, me, 'signatory')
  const bp = Math.round(body.interestPercent * 100)
  if (bp < 0 || bp > 10000) throw validation('Interest is 0% to 100% a month')
  if (!Number.isInteger(body.maxMonths) || body.maxMonths < 1 || body.maxMonths > 24) throw validation('The longest loan is 1 to 24 months')
  // A society's largest loan is a cap, not a payment: the single-payment limit doesn't apply to it.
  const maxCents = body.maxAmount ? Math.round(body.maxAmount * 100) : null
  if (maxCents !== null && !(maxCents > 0)) throw validation('The largest loan must be more than M0')
  await expireTerms(ctx.db)
  await ctx.tx(async (q, out) => {
    const s = await loadSociety(q, societyId, true)
    const [waiting] = await q.query('SELECT 1 FROM society_loan_term_changes WHERE society_id = $1 AND status = $2', [societyId, 'pending'])
    if (waiting) throw conflict('A change to the loan terms is waiting for approval. Approve or reject it first')
    const [c] = await q.query<TermRow>(
      `INSERT INTO society_loan_term_changes (id, society_id, proposed_by, enabled, interest_bp, max_months, max_cents, approved_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9)) RETURNING *`,
      [newId(), societyId, me.id, body.enabled, bp, body.maxMonths, maxCents, [me.id], SOCIETY_LOAN_APPROVAL_HOURS],
    )
    const signatories = await signatoryIds(q, societyId)
    if (Math.min(s.approvals_required, signatories.length) <= 1) return applyTerms(q, out, s, c, me)
    out.notify({
      userIds: signatories.filter((u) => u !== me.id),
      category: 'money',
      title: `${s.name}: approve new loan terms`,
      body: `${me.name} proposes new loan terms. ${termsText(body.enabled, bp, body.maxMonths, maxCents)} Approve or reject in Society (Mekhatlo).`,
      data: { screen: 'society' },
    })
  })
  return societyLoans(ctx.db, me, societyId)
}

export async function decideLoanTerms(ctx: Ctx, me: UserRow, changeId: string, approve: boolean, pin: string): Promise<SocietyLoans> {
  await expireTerms(ctx.db)
  const [pre] = await ctx.db.query<TermRow & { status: string }>('SELECT * FROM society_loan_term_changes WHERE id = $1', [changeId])
  if (!pre) throw notFound('Change not found')
  await requireRole(ctx.db, pre.society_id, me, 'signatory')
  if (pre.status !== 'pending') throw conflict(`This change is already ${pre.status}`)
  if (pre.approved_by.includes(me.id)) throw conflict(pre.proposed_by === me.id ? 'Another executive must approve your change' : 'You already approved this change')
  await checkPin(ctx.db, me, pin)
  await ctx.tx(async (q, out) => {
    const [c] = await q.query<TermRow & { status: string }>('SELECT * FROM society_loan_term_changes WHERE id = $1 FOR UPDATE', [changeId])
    if (c.status !== 'pending') throw conflict(`This change is already ${c.status}`)
    const s = await loadSociety(q, c.society_id, true)
    if (!approve) {
      await q.query(`UPDATE society_loan_term_changes SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [c.id, me.id])
      out.notify({ userIds: [c.proposed_by], category: 'money', title: s.name, body: `${me.name} rejected your change to the loan terms.`, data: { screen: 'society' } })
      return
    }
    const approved = [...c.approved_by, me.id]
    await q.query('UPDATE society_loan_term_changes SET approved_by = $2 WHERE id = $1', [c.id, approved])
    if (approved.length >= Math.min(s.approvals_required, (await signatoryIds(q, s.id)).length)) await applyTerms(q, out, s, { ...c, approved_by: approved }, me)
  })
  return societyLoans(ctx.db, me, pre.society_id)
}

export async function askForLoan(ctx: Ctx, me: UserRow, societyId: string, body: SocietyLoanBody): Promise<SocietyLoan> {
  await requireRole(ctx.db, societyId, me, 'member')
  const s = await loadSociety(ctx.db, societyId)
  if (!s.loans_enabled) throw validation('This society doesn’t give loans. Ask an executive to switch them on')
  const amountCents = paymentCents(body.amount)
  if (!Number.isInteger(body.months) || body.months < 1 || body.months > s.loan_max_months) throw validation(`Choose 1 to ${s.loan_max_months} months`)
  if (s.loan_max_cents && amountCents > Number(s.loan_max_cents)) throw validation(`The largest loan is ${formatM(Number(s.loan_max_cents))}`)
  if (amountCents > s.balance_cents) throw validation(`The society has ${formatM(s.balance_cents)}`)
  const { others, required } = await approversFor(ctx.db, s, me.id)
  if (required < 1) throw validation('Another executive must approve your loan. Add one first')
  const purpose = body.purpose?.trim().slice(0, 60) || null
  await checkPin(ctx.db, me, body.pin)
  const totalCents = Math.round(loanTotal(amountCents / 100, s.loan_interest_bp / 100, body.months) * 100)
  const id = await ctx.tx(async (q, out) => {
    const [dup] = await q.query<{ id: string }>('SELECT id FROM society_loans WHERE borrower_id = $1 AND client_id = $2', [me.id, body.clientId])
    if (dup) return dup.id
    const [open] = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM society_loans WHERE society_id = $1 AND borrower_id = $2 AND status IN ('pending', 'active')`,
      [societyId, me.id],
    )
    if (open.n > 0) throw conflict('You already have a loan from this society. Repay it first')
    const [l] = await q.query<{ id: string; reference: string }>(
      `INSERT INTO society_loans (id, society_id, borrower_id, amount_cents, interest_bp, months, total_cents, purpose, client_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(hours => $10)) RETURNING id, reference`,
      [newId(), societyId, me.id, amountCents, s.loan_interest_bp, body.months, totalCents, purpose, body.clientId, SOCIETY_LOAN_APPROVAL_HOURS],
    )
    out.notify({
      userIds: others,
      category: 'money',
      title: `${s.name}: approve a loan`,
      body: `${me.name} asks to borrow ${formatM(amountCents)} for ${body.months} month${body.months === 1 ? '' : 's'} (${formatM(totalCents)} to repay)${purpose ? `: ${purpose}` : ''}. Approve or reject it in Society (Mekhatlo).`,
      data: { screen: 'society' },
    })
    return l.id
  })
  return loanById(ctx.db, me, id)
}

async function loanById(q: Queryable, me: UserRow, id: string): Promise<SocietyLoan> {
  const [r] = await q.query<LoanRow>('SELECT * FROM society_loans WHERE id = $1', [id])
  if (!r) throw notFound('Loan not found')
  const s = await loadSociety(q, r.society_id)
  const [loan] = await toLoans(q, [r], s, me.id, await roleOf(q, s.id, me.id))
  return loan
}

async function payOut(ctx: Ctx, q: Queryable, out: Out, s: SocietyRow, l: LoanRow) {
  if (Number(l.amount_cents) > s.balance_cents) throw new AppError('INSUFFICIENT_FUNDS', `The society has only ${formatM(s.balance_cents)}`)
  const result = await ctx.ledger.transfer(q, {
    kind: 'send',
    fromUserId: s.wallet_user_id,
    toUserId: l.borrower_id,
    amountCents: Number(l.amount_cents),
    label: `${s.name} · loan ${l.reference}`,
    note: l.purpose,
  })
  for (const [userId, cents] of result.balances) out.balance(userId, cents)
  await q.query(
    `UPDATE society_loans SET status = 'active', transaction_id = $2, paid_out_at = now(), due_at = now() + make_interval(months => months) WHERE id = $1`,
    [l.id, result.tx.id],
  )
  const [due] = await q.query<{ due_at: Date }>('SELECT due_at FROM society_loans WHERE id = $1', [l.id])
  out.notify({
    userIds: [l.borrower_id],
    category: 'money',
    title: `${s.name}: loan approved`,
    body: `${l.reference}: ${formatM(Number(l.amount_cents))} is in your wallet. Repay ${formatM(Number(l.total_cents))} by ${due.due_at.toISOString().slice(0, 10)} in Society (Mekhatlo).`,
    data: { screen: 'society' },
  })
}

export async function decideLoan(ctx: Ctx, me: UserRow, loanId: string, approve: boolean, pin: string): Promise<SocietyLoan> {
  await expireDue(ctx.db)
  const [pre] = await ctx.db.query<LoanRow>('SELECT * FROM society_loans WHERE id = $1', [loanId])
  if (!pre) throw notFound('Loan not found')
  await requireRole(ctx.db, pre.society_id, me, 'signatory')
  if (pre.borrower_id === me.id) throw forbidden('You can’t approve or reject your own loan')
  if (pre.status !== 'pending') throw conflict(`This loan is already ${pre.status}`)
  await checkPin(ctx.db, me, pin)
  await ctx.tx(async (q, out) => {
    const [l] = await q.query<LoanRow>('SELECT * FROM society_loans WHERE id = $1 FOR UPDATE', [loanId])
    if (l.status !== 'pending') throw conflict(`This loan is already ${l.status}`)
    const s = await loadSociety(q, l.society_id, true)
    if (!approve) {
      await q.query(`UPDATE society_loans SET status = 'rejected', rejected_by = $2 WHERE id = $1`, [l.id, me.id])
      out.notify({ userIds: [l.borrower_id], category: 'money', title: s.name, body: `${me.name} rejected your loan ${l.reference} (${formatM(Number(l.amount_cents))}).`, data: { screen: 'society' } })
      return
    }
    const [added] = await q.query('INSERT INTO society_loan_approvals (loan_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [l.id, me.id])
    if (!added) throw conflict('You already approved this loan')
    const [{ n }] = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM society_loan_approvals WHERE loan_id = $1', [l.id])
    const { required } = await approversFor(q, s, l.borrower_id)
    if (n >= required) await payOut(ctx, q, out, s, l)
  })
  return loanById(ctx.db, me, loanId)
}

export async function repayLoan(ctx: Ctx, me: UserRow, loanId: string, body: SocietyRepayBody): Promise<MoneyResult> {
  const [pre] = await ctx.db.query<LoanRow>('SELECT * FROM society_loans WHERE id = $1', [loanId])
  if (!pre || pre.borrower_id !== me.id) throw notFound('Loan not found')
  if (pre.status !== 'active') throw conflict(pre.status === 'repaid' ? 'This loan is already repaid' : `This loan is ${pre.status}`)
  const amountCents = paymentCents(body.amount)
  const owed = Number(pre.total_cents) - Number(pre.repaid_cents)
  if (amountCents > owed) throw validation(`You owe ${formatM(owed)}`)
  await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    const [l] = await q.query<LoanRow>('SELECT * FROM society_loans WHERE id = $1 FOR UPDATE', [loanId])
    const left = Number(l.total_cents) - Number(l.repaid_cents)
    if (l.status !== 'active' || amountCents > left) throw conflict(`You owe ${formatM(left)}`)
    const s = await loadSociety(q, l.society_id)
    const result = await ctx.ledger.transfer(q, { kind: 'send', fromUserId: me.id, toUserId: s.wallet_user_id, amountCents, label: `${s.name} · repay ${l.reference}`, note: null })
    for (const [userId, cents] of result.balances) out.balance(userId, cents)
    await q.query('INSERT INTO society_loan_repayments (id, loan_id, amount_cents, transaction_id) VALUES ($1, $2, $3, $4)', [newId(), l.id, amountCents, result.tx.id])
    const done = amountCents === left
    await q.query(
      `UPDATE society_loans SET repaid_cents = repaid_cents + $2, status = CASE WHEN $3 THEN 'repaid' ELSE status END, repaid_at = CASE WHEN $3 THEN now() ELSE repaid_at END WHERE id = $1`,
      [l.id, amountCents, done],
    )
    if (done) {
      out.notify({
        userIds: (await signatoryIds(q, s.id)).filter((u) => u !== me.id),
        category: 'money',
        title: s.name,
        body: `${me.name} repaid loan ${l.reference} in full (${formatM(Number(l.total_cents))}).`,
        data: { screen: 'society' },
      })
    }
    return moneyResult(q, me, result)
  })
}

// ---------- reminders ----------

/** Expires unapproved loans; reminds borrowers before the due date and every week while overdue. */
export async function sweepLoans(ctx: Ctx) {
  await expireDue(ctx.db)
  const soon = await ctx.db.query<LoanRow & { society_name: string }>(
    `SELECT l.*, s.name AS society_name FROM society_loans l JOIN societies s ON s.id = l.society_id
     WHERE l.status = 'active' AND NOT l.reminded_due AND l.due_at > now() AND l.due_at <= now() + make_interval(days => $1)`,
    [REMIND_BEFORE_DAYS],
  )
  const late = await ctx.db.query<LoanRow & { society_name: string }>(
    `SELECT l.*, s.name AS society_name FROM society_loans l JOIN societies s ON s.id = l.society_id
     WHERE l.status = 'active' AND l.due_at <= now() AND (l.reminded_late_at IS NULL OR l.reminded_late_at <= now() - make_interval(days => $1))`,
    [LATE_EVERY_DAYS],
  )
  if (!soon.length && !late.length) return { soon: 0, late: 0 }
  await ctx.tx(async (q, out) => {
    for (const l of soon) {
      const owed = Number(l.total_cents) - Number(l.repaid_cents)
      out.notify({
        userIds: [l.borrower_id],
        category: 'money',
        title: `${l.society_name}: loan due soon`,
        body: `${l.reference}: ${formatM(owed)} is due by ${l.due_at!.toISOString().slice(0, 10)}. Repay in Society (Mekhatlo).`,
        data: { screen: 'society' },
      })
      await q.query('UPDATE society_loans SET reminded_due = true WHERE id = $1', [l.id])
    }
    for (const l of late) {
      const owed = Number(l.total_cents) - Number(l.repaid_cents)
      const borrower = (await getUsers(q, [l.borrower_id])).get(l.borrower_id)
      out.notify({ userIds: [l.borrower_id], category: 'money', title: `${l.society_name}: loan overdue`, body: `${l.reference}: ${formatM(owed)} was due on ${l.due_at!.toISOString().slice(0, 10)}. Please repay in Society (Mekhatlo).`, data: { screen: 'society' } })
      out.notify({
        userIds: (await signatoryIds(q, l.society_id)).filter((u) => u !== l.borrower_id),
        category: 'money',
        title: `${l.society_name}: loan overdue`,
        body: `${borrower?.name ?? 'A member'} still owes ${formatM(owed)} on ${l.reference} (due ${l.due_at!.toISOString().slice(0, 10)}).`,
        data: { screen: 'society' },
      })
      await q.query('UPDATE society_loans SET reminded_late_at = now() WHERE id = $1', [l.id])
    }
  })
  return { soon: soon.length, late: late.length }
}

export function createLoanSweeper(ctx: Ctx, everyMs = 60 * 60_000) {
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    start() {
      if (timer) return
      timer = setInterval(() => {
        sweepLoans(ctx).catch((err) => ctx.log.warn({ err: (err as Error).message }, 'loan sweep failed'))
      }, everyMs)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
