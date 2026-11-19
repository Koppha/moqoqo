// Spending insights: a person's money out for a month, grouped by what it was for, beside the month before.
// The app shows it (GET /v1/insights), the EcoCash Assistant answers questions with it (get_spending tool) and posts
// last month's summary in its chat early each month (createInsightSweeper). Read-only: nothing here moves money.
import type { SpendingCategory, SpendingInsights, SpendingLine } from '../../../shared/api'
import { SPENDING_CATEGORIES } from '../../../shared/api'
import { ensureAssistantChat, assistantAccount } from '../assistant/account'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { validation } from '../errors'
import { formatM, fromCents } from '../lib/money'
import { postMessage } from './chats'
import type { UserRow } from './users'

/** Lesotho is UTC+2 all year (no DST). */
const MASERU_OFFSET_MS = 2 * 3_600_000

/** "2026-11" for the Lesotho month `now` falls in, or `back` months before it. */
export function maseruMonth(now = new Date(), back = 0): string {
  const local = new Date(now.getTime() + MASERU_OFFSET_MS)
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - back, 1))
  return d.toISOString().slice(0, 7)
}

/** UTC start and end of a Lesotho month ("2026-11"). */
export function monthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw validation('month is like 2026-11')
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  return { from: new Date(Date.UTC(y, mo, 1) - MASERU_OFFSET_MS), to: new Date(Date.UTC(y, mo + 1, 1) - MASERU_OFFSET_MS) }
}

const previousMonth = (month: string) => {
  const { from } = monthRange(month)
  return maseruMonth(new Date(from.getTime() + MASERU_OFFSET_MS), 1)
}

interface Row {
  kind: string
  amount_cents: string | number
  out: boolean
  cp_kind: 'person' | 'system' | null
  cp_role: string | null
  cp_biller: string | null
  cp_code: string | null
  cp_name: string | null
  society: boolean
}

const BILLER_CATEGORY: Record<string, SpendingCategory> = {
  lec: 'electricity', wasco: 'water', school: 'school', airtime: 'airtime', burial: 'society', ecosure: 'insurance', fees: 'fees',
}

/** What a payment out was for, from its ledger kind and who received it. */
export function categorize(r: Pick<Row, 'kind' | 'cp_kind' | 'cp_role' | 'cp_biller' | 'cp_code' | 'society'> & { cp_name?: string | null }): SpendingCategory {
  if (r.kind === 'fee') return 'fees'
  if (r.kind === 'ecosure') return 'insurance'
  if (r.kind === 'withdraw' || r.kind === 'cashout' || r.kind === 'atm') return 'cash'
  if (r.kind === 'service') return 'airtime'
  if (r.society) return 'society'
  if (r.cp_kind === 'system') return (r.cp_biller && BILLER_CATEGORY[r.cp_biller]) || 'other'
  if (r.cp_role === 'merchant' || r.kind === 'tap' || r.kind === 'qr' || r.kind === 'merchant') {
    // Merchants have no type yet: a taxi is one whose code (TAXI-0042) or business name ("Taxi · Ntate Mokoena") says so.
    return r.cp_code?.toUpperCase().startsWith('TAXI') || /\btaxi\b/i.test(r.cp_name ?? '') ? 'transport' : 'shops'
  }
  if (r.cp_role === 'agent') return 'cash'
  if (r.cp_kind === 'person') return 'people'
  return 'other'
}

async function rows(q: Queryable, userId: string, month: string): Promise<Row[]> {
  const { from, to } = monthRange(month)
  return q.query<Row>(
    `SELECT t.kind, t.amount_cents, (t.from_user_id = $1) AS out,
            u.kind AS cp_kind, u.role AS cp_role, u.biller AS cp_biller, u.code AS cp_code,
            COALESCE(NULLIF(u.business_name, ''), u.name) AS cp_name,
            EXISTS (SELECT 1 FROM societies s WHERE s.wallet_user_id = t.to_user_id) AS society
       FROM transactions t
       LEFT JOIN users u ON u.id = CASE WHEN t.from_user_id = $1 THEN t.to_user_id ELSE t.from_user_id END
      WHERE (t.from_user_id = $1 OR t.to_user_id = $1) AND t.created_at >= $2 AND t.created_at < $3`,
    [userId, from, to],
  )
}

interface Tally { byCat: Map<SpendingCategory, { cents: number; count: number }>; inCents: number; payees: Map<string, number> }

function tally(list: Row[]): Tally {
  const byCat = new Map<SpendingCategory, { cents: number; count: number }>()
  const payees = new Map<string, number>()
  let inCents = 0
  let atmBack = 0
  for (const r of list) {
    const cents = Number(r.amount_cents)
    if (!r.out) {
      // Cash set aside for a cardless ATM withdrawal that came back was never spent.
      if (r.kind === 'atm_refund') atmBack += cents
      else inCents += cents
      continue
    }
    const cat = categorize(r)
    const c = byCat.get(cat) ?? { cents: 0, count: 0 }
    c.cents += cents
    c.count += 1
    byCat.set(cat, c)
    if (r.cp_name && cat !== 'fees' && cat !== 'cash') payees.set(r.cp_name, (payees.get(r.cp_name) ?? 0) + cents)
  }
  const cash = byCat.get('cash')
  if (cash && atmBack) cash.cents = Math.max(0, cash.cents - atmBack)
  return { byCat, inCents, payees }
}

const sum = (t: Tally) => [...t.byCat.values()].reduce((a, c) => a + c.cents, 0)

/** The month's spending (this Lesotho month when none is given) beside the month before. */
export async function spendingInsights(q: Queryable, userId: string, month = maseruMonth()): Promise<SpendingInsights> {
  const prev = previousMonth(month)
  const [now, before] = await Promise.all([rows(q, userId, month), rows(q, userId, prev)])
  const a = tally(now)
  const b = tally(before)
  const categories: SpendingLine[] = SPENDING_CATEGORIES
    .map((category) => ({
      category,
      amount: fromCents(a.byCat.get(category)?.cents ?? 0),
      lastMonth: fromCents(b.byCat.get(category)?.cents ?? 0),
      count: a.byCat.get(category)?.count ?? 0,
    }))
    .filter((l) => l.amount > 0 || l.lastMonth > 0)
    .sort((x, y) => y.amount - x.amount || y.lastMonth - x.lastMonth)
  const topPayees = [...a.payees.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, cents]) => ({ name, amount: fromCents(cents) }))
  return { month, spent: fromCents(sum(a)), lastMonthSpent: fromCents(sum(b)), received: fromCents(a.inCents), categories, topPayees }
}

const LABEL: Record<SpendingCategory, string> = {
  people: 'family & friends', shops: 'shops', transport: 'taxis', electricity: 'electricity', water: 'water', school: 'school fees',
  airtime: 'airtime & bundles', insurance: 'insurance', society: 'societies', cash: 'cash & bank', fees: 'fees', other: 'other payments',
}

const monthName = (month: string) => new Date(`${month}-15T00:00:00Z`).toLocaleString('en', { month: 'long', timeZone: 'UTC' })

/** One short message about a month, in the assistant's voice. Null when nothing went out. */
export function insightText(s: SpendingInsights): string | null {
  if (s.spent <= 0) return null
  const cents = (m: number) => formatM(Math.round(m * 100))
  const lines = [`Your ${monthName(s.month)} in EcoCash 📊`, `You spent ${cents(s.spent)} and received ${cents(s.received)}.`]
  const top = s.categories.filter((c) => c.amount > 0).slice(0, 3)
  if (top.length) lines.push(`Most went on ${top.map((c) => `${LABEL[c.category]} (${cents(c.amount)})`).join(', ')}.`)
  // The biggest change on something they spent at least M50 on, either way.
  const moved = s.categories
    .filter((c) => c.lastMonth >= 50 && c.amount >= 50)
    .map((c) => ({ c, pct: Math.round(((c.amount - c.lastMonth) / c.lastMonth) * 100) }))
    .filter((x) => Math.abs(x.pct) >= 15)
    .sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct))[0]
  if (moved) lines.push(`${LABEL[moved.c.category][0].toUpperCase()}${LABEL[moved.c.category].slice(1)}: ${Math.abs(moved.pct)}% ${moved.pct > 0 ? 'more' : 'less'} than ${monthName(previousMonth(s.month))}.`)
  else if (s.lastMonthSpent > 0) {
    const pct = Math.round(((s.spent - s.lastMonthSpent) / s.lastMonthSpent) * 100)
    if (Math.abs(pct) >= 5) lines.push(`That's ${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than ${monthName(previousMonth(s.month))} overall.`)
  }
  lines.push('Ask me anything about your spending.')
  return lines.join('\n')
}

/**
 * Early each Lesotho month: last month's summary from the assistant, once per person and month (insight_posts), to
 * people who spent something. The message comes with a button to the Insights screen.
 */
export async function postMonthlyInsights(ctx: Ctx, now = new Date()): Promise<number> {
  // From 08:00 on the 1st, Lesotho time, so the notification doesn't wake anyone.
  const local = new Date(now.getTime() + MASERU_OFFSET_MS)
  if (local.getUTCDate() === 1 && local.getUTCHours() < 8) return 0
  const month = maseruMonth(now, 1)
  const { from, to } = monthRange(month)
  const people = await ctx.db.query<UserRow>(
    `SELECT u.* FROM users u
      WHERE u.kind = 'person' AND u.status = 'active'
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.from_user_id = u.id AND t.created_at >= $1 AND t.created_at < $2)
        AND NOT EXISTS (SELECT 1 FROM insight_posts p WHERE p.user_id = u.id AND p.month = $3)
      LIMIT 500`,
    [from, to, month],
  )
  let posted = 0
  for (const user of people) {
    const summary = await spendingInsights(ctx.db, user.id, month)
    const text = insightText(summary)
    await ctx.tx(async (q, out) => {
      // Claimed first, so two servers never both post it.
      const claimed = await q.query('INSERT INTO insight_posts (user_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id', [user.id, month])
      if (!claimed.length || !text) return
      const chatId = await ensureAssistantChat(q, out, user)
      if (!chatId) return
      const assistant = await assistantAccount(q)
      await postMessage(q, out, { chatId, senderId: assistant.id, kind: 'text', text })
      await postMessage(q, out, { chatId, senderId: assistant.id, kind: 'action', text: 'See my spending', action: { type: 'open', screen: 'insights' }, silent: true })
      posted++
    })
  }
  return posted
}

/** Checks hourly whether this month's summaries are still to post. */
export function createInsightSweeper(ctx: Ctx, everyMs = 60 * 60_000) {
  let timer: NodeJS.Timeout | null = null
  let busy = false
  const sweep = async () => {
    if (busy) return
    busy = true
    try {
      // Up to 500 people per pass; keep going while a pass is full.
      while ((await postMonthlyInsights(ctx)) >= 500);
    } catch (err) {
      ctx.log.error({ err }, 'insight sweep failed')
    } finally {
      busy = false
    }
  }
  return {
    sweep,
    start() {
      timer = setInterval(() => void sweep(), everyMs)
      timer.unref()
      void sweep()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
