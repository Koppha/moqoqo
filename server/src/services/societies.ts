// Society (Mekhatlo): group wallets with members and signatories. Contract: shared/api.ts "Society".
// The society's money sits in its own system wallet (users.kind = 'system'), so every movement goes through the
// ledger with KYC and risk checks. A payout needs approvalsRequired signatories; the requester counts as one, and a
// single rejection stops it. Pending payouts expire after SOCIETY_APPROVAL_HOURS. A Motšelo is a society with a
// monthly contribution: members see who has paid this month and executives can remind the rest.
import {
  SOCIETY_APPROVAL_HOURS,
  type AddSocietyMemberBody,
  type AdminSociety,
  type CreateSocietyBody,
  type MoneyResult,
  type SocietyContributionBody,
  type SocietyDetail,
  type SocietyKind,
  type SocietyMember,
  type SocietyRole,
  type SocietySummary,
  type SocietyTransfer,
  type SocietyTransferBody,
  type SocietyTransferStatus,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { newId, randomDigits } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso, startOfMaseruMonth } from '../lib/time'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { getUsers, requireByNumberOrUsername, toPublicUser, type UserRow } from './users'

export interface SocietyRow {
  id: string
  code: string
  name: string
  kind: SocietyKind
  contribution_cents: number | null
  loans_enabled: boolean
  loan_interest_bp: number
  loan_max_months: number
  loan_max_cents: number | null
  wallet_user_id: string
  approvals_required: number
  created_at: Date
  balance_cents: number
}

interface TransferRow {
  id: string
  reference: string
  society_id: string
  requested_by: string
  to_user_id: string
  amount_cents: number
  note: string | null
  status: SocietyTransferStatus
  rejected_by: string | null
  created_at: Date
  expires_at: Date
}

const SOCIETY_SELECT = `SELECT s.*, w.balance_cents FROM societies s JOIN users w ON w.id = s.wallet_user_id`

/** Pending payouts past their time become expired (read paths call this first). */
async function expireDue(q: Queryable) {
  await q.query(`UPDATE society_transfers SET status = 'expired', decided_at = now() WHERE status = 'pending' AND expires_at <= now()`)
}

export async function loadSociety(q: Queryable, id: string, lock = false): Promise<SocietyRow> {
  const [s] = await q.query<SocietyRow>(`${SOCIETY_SELECT} WHERE s.id = $1 ${lock ? 'FOR UPDATE OF s' : ''}`, [id])
  if (!s) throw notFound('Society not found')
  return { ...s, balance_cents: Number(s.balance_cents) }
}

export async function roleOf(q: Queryable, societyId: string, userId: string): Promise<SocietyRole | null> {
  const [m] = await q.query<{ role: SocietyRole }>('SELECT role FROM society_members WHERE society_id = $1 AND user_id = $2', [societyId, userId])
  return m?.role ?? null
}

export async function requireRole(q: Queryable, societyId: string, me: UserRow, need: SocietyRole): Promise<SocietyRole> {
  const role = await roleOf(q, societyId, me.id)
  // Not a member reads as not found, so society names don't leak.
  if (!role) throw notFound('Society not found')
  if (need === 'signatory' && role !== 'signatory') throw forbidden('Only the society’s signatories can do this')
  return role
}

export async function signatoryIds(q: Queryable, societyId: string): Promise<string[]> {
  const rows = await q.query<{ user_id: string }>(`SELECT user_id FROM society_members WHERE society_id = $1 AND role = 'signatory'`, [societyId])
  return rows.map((r) => r.user_id)
}

async function toTransfers(q: Queryable, rows: TransferRow[], s: SocietyRow, meId: string | null, myRole: SocietyRole | null): Promise<SocietyTransfer[]> {
  if (!rows.length) return []
  const approvals = await q.query<{ transfer_id: string; user_id: string; at: Date }>(
    'SELECT * FROM society_approvals WHERE transfer_id = ANY($1) ORDER BY at',
    [rows.map((r) => r.id)],
  )
  const users = await getUsers(q, [...new Set([...rows.flatMap((r) => [r.requested_by, r.to_user_id, r.rejected_by ?? '']), ...approvals.map((a) => a.user_id)].filter(Boolean))])
  const pub = (id: string) => toPublicUser(users.get(id)!)
  return rows.map((r) => {
    const mine = approvals.filter((a) => a.transfer_id === r.id)
    const t: SocietyTransfer = {
      id: r.id,
      reference: r.reference,
      to: pub(r.to_user_id),
      amount: fromCents(Number(r.amount_cents)),
      status: r.status,
      requestedBy: pub(r.requested_by),
      approvals: mine.map((a) => ({ user: pub(a.user_id), at: iso(a.at) })),
      approvalsRequired: s.approvals_required,
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
    }
    if (r.note) t.note = r.note
    if (r.rejected_by) t.rejectedBy = pub(r.rejected_by)
    if (myRole === 'signatory' && meId) t.canDecide = r.status === 'pending' && !mine.some((a) => a.user_id === meId)
    return t
  })
}

async function summaries(q: Queryable, rows: (SocietyRow & { role: SocietyRole })[], meId: string): Promise<SocietySummary[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const counts = await q.query<{ society_id: string; n: number }>('SELECT society_id, count(*)::int AS n FROM society_members WHERE society_id = ANY($1) GROUP BY society_id', [ids])
  const waiting = await q.query<{ society_id: string; n: number }>(
    `SELECT t.society_id, count(*)::int AS n FROM society_transfers t
     WHERE t.society_id = ANY($1) AND t.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM society_approvals a WHERE a.transfer_id = t.id AND a.user_id = $2)
     GROUP BY t.society_id`,
    [ids, meId],
  )
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    ...(r.contribution_cents ? { contribution: fromCents(Number(r.contribution_cents)) } : {}),
    balance: fromCents(Number(r.balance_cents)),
    myRole: r.role,
    memberCount: counts.find((c) => c.society_id === r.id)?.n ?? 0,
    awaitingMe: r.role === 'signatory' ? waiting.find((w) => w.society_id === r.id)?.n ?? 0 : 0,
  }))
}

/** Members who paid at least the monthly contribution into the society this Maseru month. */
async function paidThisMonth(q: Queryable, s: SocietyRow): Promise<Set<string>> {
  const rows = await q.query<{ from_user_id: string }>(
    `SELECT from_user_id FROM transactions WHERE to_user_id = $1 AND from_user_id IS NOT NULL AND created_at >= $2
     GROUP BY from_user_id HAVING sum(amount_cents) >= $3`,
    [s.wallet_user_id, startOfMaseruMonth(), s.contribution_cents],
  )
  return new Set(rows.map((r) => r.from_user_id))
}

// ---------- members' view ----------

export async function mySocieties(q: Queryable, me: UserRow): Promise<SocietySummary[]> {
  await expireDue(q)
  const rows = await q.query<SocietyRow & { role: SocietyRole }>(
    `SELECT s.*, w.balance_cents, m.role FROM societies s JOIN users w ON w.id = s.wallet_user_id
     JOIN society_members m ON m.society_id = s.id AND m.user_id = $1 ORDER BY s.name`,
    [me.id],
  )
  return summaries(q, rows, me.id)
}

/** meId null: the portal's view (as a signatory, without "can decide"). */
export async function societyDetail(q: Queryable, id: string, meId: string | null): Promise<SocietyDetail> {
  await expireDue(q)
  const s = await loadSociety(q, id)
  const role: SocietyRole = meId ? (await roleOf(q, id, meId)) ?? 'member' : 'signatory'
  const [summary] = await summaries(q, [{ ...s, role }], meId ?? '')
  const memberRows = await q.query<{ user_id: string; role: SocietyRole; added_at: Date }>(
    `SELECT m.user_id, m.role, m.added_at FROM society_members m JOIN users u ON u.id = m.user_id WHERE m.society_id = $1
     ORDER BY m.role DESC, u.name`,
    [id],
  )
  const users = await getUsers(q, memberRows.map((m) => m.user_id))
  const paid = s.contribution_cents ? await paidThisMonth(q, s) : null
  const members: SocietyMember[] = memberRows.map((m) => ({
    user: toPublicUser(users.get(m.user_id)!),
    role: m.role,
    addedAt: iso(m.added_at),
    ...(paid ? { paidThisMonth: paid.has(m.user_id) } : {}),
  }))
  const transferRows = await q.query<TransferRow>(
    `SELECT * FROM society_transfers WHERE society_id = $1 ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 30`,
    [id],
  )
  const txs = await q.query<{ id: string; reference: string; amount_cents: number; from_user_id: string | null; to_user_id: string | null; label: string | null; note: string | null; created_at: Date }>(
    `SELECT * FROM transactions WHERE from_user_id = $1 OR to_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [s.wallet_user_id],
  )
  const others = await getUsers(q, txs.map((t) => (t.from_user_id === s.wallet_user_id ? t.to_user_id : t.from_user_id)).filter((x): x is string => !!x))
  const recent = txs.map((t) => {
    const out = t.from_user_id === s.wallet_user_id
    const other = others.get((out ? t.to_user_id : t.from_user_id) ?? '')
    return {
      id: t.id,
      reference: t.reference,
      amount: fromCents(Number(t.amount_cents)) * (out ? -1 : 1),
      // The society's name is already on the screen: show the note, or what kind of movement it was.
      label: t.note ?? (out ? 'Payment' : 'Contribution'),
      who: other ? other.business_name || other.name : '',
      at: iso(t.created_at),
    }
  })
  return { ...summary, approvalsRequired: s.approvals_required, members, transfers: await toTransfers(q, transferRows, s, meId, role), recent }
}

export async function requireMemberDetail(q: Queryable, me: UserRow, id: string): Promise<SocietyDetail> {
  await requireRole(q, id, me, 'member')
  return societyDetail(q, id, me.id)
}

// ---------- signatories: members ----------

export async function addMember(ctx: Ctx, me: UserRow, id: string, body: AddSocietyMemberBody): Promise<SocietyDetail> {
  await requireRole(ctx.db, id, me, 'signatory')
  const s = await loadSociety(ctx.db, id)
  const user = await requireByNumberOrUsername(ctx.db, body.to)
  if (user.kind !== 'person') throw validation('Choose a person’s wallet')
  const role: SocietyRole = body.role ?? 'member'
  const current = await roleOf(ctx.db, id, user.id)
  if (current === role) throw conflict(`${user.name} is already a ${role}`)
  if (current === 'signatory' && role === 'member') {
    const signatories = await signatoryIds(ctx.db, id)
    if (signatories.length - 1 < s.approvals_required) throw validation(`The society needs at least ${s.approvals_required} signatories`)
  }
  await ctx.tx(async (q, out) => {
    await q.query(
      `INSERT INTO society_members (society_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (society_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [id, user.id, role, me.id],
    )
    out.notify({
      userIds: [user.id],
      category: 'money',
      title: s.name,
      body: current ? `${me.name} made you a ${role} of ${s.name}.` : `${me.name} added you to ${s.name} (society ${s.code}). Open Society (Mekhatlo) in EcoCash Super App to see it.`,
      data: { screen: 'society' },
    })
  })
  return societyDetail(ctx.db, id, me.id)
}

export async function removeMember(ctx: Ctx, me: UserRow, id: string, userId: string): Promise<SocietyDetail> {
  await requireRole(ctx.db, id, me, 'signatory')
  const s = await loadSociety(ctx.db, id)
  const role = await roleOf(ctx.db, id, userId)
  if (!role) throw notFound('That person is not a member')
  if (role === 'signatory' && (await signatoryIds(ctx.db, id)).length - 1 < s.approvals_required) {
    throw validation(`The society needs at least ${s.approvals_required} signatories. Add another signatory first`)
  }
  await ctx.tx(async (q, out) => {
    await q.query('DELETE FROM society_members WHERE society_id = $1 AND user_id = $2', [id, userId])
    if (userId !== me.id) out.notify({ userIds: [userId], category: 'money', title: s.name, body: `${me.name} removed you from ${s.name}.` })
  })
  return societyDetail(ctx.db, id, me.id)
}

/** Executives remind members who haven't paid this month's contribution. */
export async function remindUnpaid(ctx: Ctx, me: UserRow, id: string): Promise<{ reminded: number }> {
  await requireRole(ctx.db, id, me, 'signatory')
  const s = await loadSociety(ctx.db, id)
  if (!s.contribution_cents) throw validation('This society has no monthly contribution')
  const paid = await paidThisMonth(ctx.db, s)
  const members = await ctx.db.query<{ user_id: string }>('SELECT user_id FROM society_members WHERE society_id = $1', [id])
  const unpaid = members.map((m) => m.user_id).filter((u) => !paid.has(u) && u !== me.id)
  if (unpaid.length) {
    await ctx.tx(async (_q, out) => {
      out.notify({
        userIds: unpaid,
        category: 'money',
        title: s.name,
        body: `${me.name} reminds you: this month's ${formatM(Number(s.contribution_cents))} is due. Pay in from Society (Mekhatlo).`,
        data: { screen: 'society' },
      })
    })
  }
  return { reminded: unpaid.length }
}

// ---------- money in ----------

export async function contribute(ctx: Ctx, me: UserRow, id: string, body: SocietyContributionBody): Promise<MoneyResult> {
  await requireRole(ctx.db, id, me, 'member')
  const s = await loadSociety(ctx.db, id)
  const amountCents = paymentCents(body.amount)
  const note = body.note?.trim().slice(0, 60) || null
  await checkPin(ctx.db, me, body.pin)
  return ctx.tx(async (q, out) => {
    const result = await ctx.ledger.transfer(q, { kind: 'send', fromUserId: me.id, toUserId: s.wallet_user_id, amountCents, label: `${s.name} · contribution`, note })
    for (const [userId, cents] of result.balances) out.balance(userId, cents)
    return moneyResult(q, me, result)
  })
}

// ---------- signatories: payouts ----------

async function pay(ctx: Ctx, q: Queryable, out: Parameters<Parameters<Ctx['tx']>[0]>[1], s: SocietyRow, t: TransferRow) {
  const result = await ctx.ledger.transfer(q, {
    kind: 'send',
    fromUserId: s.wallet_user_id,
    toUserId: t.to_user_id,
    amountCents: Number(t.amount_cents),
    label: `${s.name} · ${t.reference}`,
    note: t.note,
  })
  for (const [userId, cents] of result.balances) out.balance(userId, cents)
  await q.query(`UPDATE society_transfers SET status = 'paid', decided_at = now(), transaction_id = $2 WHERE id = $1`, [t.id, result.tx.id])
  out.notify({
    userIds: [t.requested_by],
    category: 'money',
    title: s.name,
    body: `${t.reference}: ${formatM(Number(t.amount_cents))} was approved and paid.`,
    data: { screen: 'society' },
  })
}

export async function createTransfer(ctx: Ctx, me: UserRow, id: string, body: SocietyTransferBody): Promise<SocietyTransfer> {
  await requireRole(ctx.db, id, me, 'signatory')
  const s = await loadSociety(ctx.db, id)
  const amountCents = paymentCents(body.amount)
  const to = await requireByNumberOrUsername(ctx.db, body.to)
  if (to.kind !== 'person') throw validation('Choose a person’s or merchant’s wallet')
  if (amountCents > s.balance_cents) throw validation(`The society has ${formatM(s.balance_cents)}`)
  const note = body.note?.trim().slice(0, 60) || null
  await checkPin(ctx.db, me, body.pin)
  const transferId = await ctx.tx(async (q, out) => {
    const [dup] = await q.query<{ id: string }>('SELECT id FROM society_transfers WHERE requested_by = $1 AND client_id = $2', [me.id, body.clientId])
    if (dup) return dup.id
    const [t] = await q.query<TransferRow>(
      `INSERT INTO society_transfers (id, society_id, requested_by, to_user_id, amount_cents, note, client_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8)) RETURNING *`,
      [newId(), id, me.id, to.id, amountCents, note, body.clientId, SOCIETY_APPROVAL_HOURS],
    )
    await q.query('INSERT INTO society_approvals (transfer_id, user_id) VALUES ($1, $2)', [t.id, me.id])
    if (s.approvals_required <= 1) {
      await pay(ctx, q, out, await loadSociety(q, id, true), t)
    } else {
      out.notify({
        userIds: (await signatoryIds(q, id)).filter((u) => u !== me.id),
        category: 'money',
        title: `${s.name}: approve a payment`,
        body: `${me.name} wants to pay ${formatM(amountCents)} to ${to.business_name || to.name}${note ? ` (${note})` : ''}. Approve or reject it in Society (Mekhatlo).`,
        data: { screen: 'society' },
      })
    }
    return t.id
  })
  return transferById(ctx.db, me, transferId)
}

async function transferById(q: Queryable, me: UserRow, transferId: string): Promise<SocietyTransfer> {
  const [t] = await q.query<TransferRow>('SELECT * FROM society_transfers WHERE id = $1', [transferId])
  if (!t) throw notFound('Payment not found')
  const s = await loadSociety(q, t.society_id)
  const [one] = await toTransfers(q, [t], s, me.id, await roleOf(q, s.id, me.id))
  return one
}

export async function decideTransfer(ctx: Ctx, me: UserRow, transferId: string, approve: boolean, pin: string): Promise<SocietyTransfer> {
  await expireDue(ctx.db)
  const [pre] = await ctx.db.query<TransferRow>('SELECT * FROM society_transfers WHERE id = $1', [transferId])
  if (!pre) throw notFound('Payment not found')
  await requireRole(ctx.db, pre.society_id, me, 'signatory')
  if (pre.status !== 'pending') throw conflict(`This payment is already ${pre.status}`)
  await checkPin(ctx.db, me, pin)
  await ctx.tx(async (q, out) => {
    const [t] = await q.query<TransferRow>('SELECT * FROM society_transfers WHERE id = $1 FOR UPDATE', [transferId])
    if (t.status !== 'pending') throw conflict(`This payment is already ${t.status}`)
    const s = await loadSociety(q, t.society_id, true)
    if (!approve) {
      await q.query(`UPDATE society_transfers SET status = 'rejected', rejected_by = $2, decided_at = now() WHERE id = $1`, [t.id, me.id])
      out.notify({ userIds: [t.requested_by], category: 'money', title: s.name, body: `${me.name} rejected ${t.reference} (${formatM(Number(t.amount_cents))}).`, data: { screen: 'society' } })
      return
    }
    const [added] = await q.query('INSERT INTO society_approvals (transfer_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [t.id, me.id])
    if (!added) throw conflict('You already approved this payment')
    const [{ n }] = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM society_approvals WHERE transfer_id = $1', [t.id])
    if (n >= s.approvals_required) {
      if (Number(t.amount_cents) > s.balance_cents) throw new AppError('INSUFFICIENT_FUNDS', `The society has only ${formatM(s.balance_cents)}`)
      await pay(ctx, q, out, s, t)
    }
  })
  return transferById(ctx.db, me, transferId)
}

// ---------- portal ----------

export async function adminSocieties(q: Queryable): Promise<AdminSociety[]> {
  const rows = await q.query<SocietyRow & { members: number; signatories: number }>(
    `${SOCIETY_SELECT.replace('SELECT s.*', `SELECT s.*, (SELECT count(*)::int FROM society_members m WHERE m.society_id = s.id) AS members,
       (SELECT count(*)::int FROM society_members m WHERE m.society_id = s.id AND m.role = 'signatory') AS signatories`)} ORDER BY s.name`,
  )
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    ...(r.contribution_cents ? { contribution: fromCents(Number(r.contribution_cents)) } : {}),
    balance: fromCents(Number(r.balance_cents)),
    memberCount: r.members,
    signatories: r.signatories,
    approvalsRequired: r.approvals_required,
    createdAt: iso(r.created_at),
  }))
}

export async function createSociety(q: Queryable, body: CreateSocietyBody): Promise<AdminSociety> {
  const name = body.name.trim()
  if (name.length < 2 || name.length > 60) throw validation('The name is 2 to 60 characters')
  if (body.approvalsRequired < 1) throw validation('At least 1 approval is needed')
  const signatories: UserRow[] = []
  for (const raw of body.signatories) {
    const u = await getUserByMsisdn(q, raw)
    if (signatories.some((x) => x.id === u.id)) throw validation(`${u.name} is listed twice`)
    signatories.push(u)
  }
  if (signatories.length < body.approvalsRequired) throw validation(`Add at least ${body.approvalsRequired} signatories, one for each approval`)
  const contributionCents = body.contribution ? paymentCents(body.contribution) : null
  if (body.kind === 'motselo' && !contributionCents) throw validation('A Motšelo needs the amount each member pays a month')
  const { id } = await openSociety(q, {
    name,
    code: body.code,
    kind: body.kind ?? 'society',
    contributionCents,
    approvalsRequired: body.approvalsRequired,
    signatoryIds: signatories.map((u) => u.id),
    walletMsisdn: null,
  })
  return (await adminSocieties(q)).find((s) => s.id === id)!
}

/**
 * Creates the society, its wallet and its signatories (portal registration, or an approved application once its
 * Mokhatlo SIM is collected: walletMsisdn is then the SIM's number). code: 4 digits, generated when absent.
 */
export async function openSociety(
  q: Queryable,
  o: { name: string; code?: string; kind: SocietyKind; contributionCents: number | null; approvalsRequired: number; signatoryIds: string[]; walletMsisdn: string | null },
): Promise<{ id: string; code: string }> {
  let code = o.code?.trim()
  if (code && !/^\d{4}$/.test(code)) throw validation('The society code is 4 digits')
  if (code && (await q.query('SELECT 1 FROM societies WHERE code = $1', [code])).length) throw conflict(`Code ${code} is taken`)
  for (let i = 0; !code && i < 50; i++) {
    const c = randomDigits(4)
    if (!(await q.query('SELECT 1 FROM societies WHERE code = $1', [c])).length) code = c
  }
  if (!code) throw conflict('No free society code; enter one')
  if (o.walletMsisdn && (await q.query('SELECT 1 FROM users WHERE msisdn = $1', [o.walletMsisdn])).length) {
    throw conflict(`${o.walletMsisdn} already has a wallet. Check the SIM number`)
  }
  const id = newId()
  const walletId = newId()
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, kyc_tier) VALUES ($1, $2, $3, 'merchant', 'system', false, $3, 2)`,
    [walletId, o.walletMsisdn, o.name],
  )
  await q.query(
    'INSERT INTO societies (id, code, name, wallet_user_id, approvals_required, kind, contribution_cents) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, code, o.name, walletId, o.approvalsRequired, o.kind, o.contributionCents],
  )
  for (const u of o.signatoryIds) await q.query(`INSERT INTO society_members (society_id, user_id, role) VALUES ($1, $2, 'signatory')`, [id, u])
  return { id, code }
}

async function getUserByMsisdn(q: Queryable, raw: string): Promise<UserRow> {
  const msisdn = normalizeMsisdn(raw)
  const [u] = await q.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (!u) throw notFound(`No EcoCash Super App wallet for ${raw}`)
  return u
}


