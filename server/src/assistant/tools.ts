import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from 'zod'
import { MAX_TRANSACTION, SUPPORT_TEAM, type AssistantAction, type AssistantScreen, type SupportTopic } from '../../../shared/api'
import { openTicket } from '../services/support'
import type { Ctx } from '../context'
import { myClaims } from '../ecosure/claims'
import { loadProducts } from '../ecosure/catalogue'
import { myPolicies } from '../ecosure/policies'
import { formatM, fromCents } from '../lib/money'
import { normalizeMsisdn } from '../lib/msisdn'
import { postMessage } from '../services/chats'
import { maseruMonth, spendingInsights } from '../services/insights'
import { getTariff } from '../services/tariff'
import { listTransactions } from '../services/transactions'
import { getUser, type UserRow } from '../services/users'
import { mySimSwap } from '../services/simSwap'

// Tools the assistant can call. Read tools only see the signed-in user's own data. Prepare tools post an action card
// into the chat; they never move money (the app opens its own screen and the user confirms with their PIN).

export interface ToolEnv {
  ctx: Ctx
  user: UserRow
  chatId: string
  assistantId: string
  /** Where the person is talking to the receptionist (tickets record it). Default: in-app chat. */
  channel?: 'chat' | 'app_voice' | 'phone'
}

interface ToolDef {
  tool: BetaTool
  input: z.ZodType
  run(env: ToolEnv, input: any): Promise<string>
}

const SCREENS: AssistantScreen[] = ['transactions', 'my_qr', 'receive_money', 'pay', 'money', 'split', 'topup', 'bank', 'remit', 'ecosure', 'insights', 'school']
const zAmount = z.number().positive().max(MAX_TRANSACTION).refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'at most 2 decimals')

const json = (v: unknown) => JSON.stringify(v)
const money = (n: number) => `${n < 0 ? '-' : ''}${formatM(Math.round(Math.abs(n) * 100))}`
const maskless = (msisdn: string | null) => msisdn ?? ''

/** Posts an action card from the assistant and tells the model what the user now sees. */
async function prepare(env: ToolEnv, label: string, action: AssistantAction): Promise<string> {
  await env.ctx.tx((q, out) => postMessage(q, out, { chatId: env.chatId, senderId: env.assistantId, kind: 'action', text: label, action }))
  return `Shown to the user as a card: "${label}". Nothing has been paid: when they tap it, EcoCash Super App opens its own screen where they check the details and confirm with their PIN.`
}

/** People the user has chats with, matching a name or number. A full number also finds any registered wallet. */
async function findContacts(env: ToolEnv, query: string): Promise<{ name: string; msisdn: string }[]> {
  const q = query.trim()
  let msisdn: string | null = null
  try {
    msisdn = normalizeMsisdn(q)
  } catch {
    // Not a phone number: search by name.
  }
  if (msisdn) {
    const [u] = await env.ctx.db.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person' AND status = 'active'`, [msisdn])
    return u && u.id !== env.user.id ? [{ name: u.business_name || u.name, msisdn: u.msisdn! }] : []
  }
  const rows = await env.ctx.db.query<UserRow>(
    `SELECT DISTINCT u.* FROM chat_members mine
       JOIN chat_members other ON other.chat_id = mine.chat_id AND other.user_id <> mine.user_id
       JOIN users u ON u.id = other.user_id
     WHERE mine.user_id = $1 AND u.kind = 'person' AND u.status = 'active'
       AND (u.name ILIKE $2 OR u.business_name ILIKE $2)
     ORDER BY u.name LIMIT 6`,
    [env.user.id, `%${q.replace(/[%_\\]/g, '\\$&')}%`],
  )
  return rows.map((u) => ({ name: u.business_name || u.name, msisdn: maskless(u.msisdn) }))
}

/** Exactly one wallet for a prepare_* call, or an error message for the model. */
async function onePerson(env: ToolEnv, to: string): Promise<{ name: string; msisdn: string } | string> {
  const found = await findContacts(env, to)
  if (found.length === 1) return found[0]
  if (!found.length) return `No one matching "${to}" was found among the user's chats, and it is not a registered EcoCash number. Ask the user for the number.`
  return `More than one person matches "${to}": ${found.map((f) => `${f.name} (${f.msisdn})`).join(', ')}. Ask the user which one.`
}

/** Why a payment was stopped, in plain words. General on purpose: never the thresholds or how the score works. */
const REFUSED_REASON: Record<string, string> = {
  sim_swap: 'the number moved to a new SIM card recently, so money leaving EcoCash and larger payments are held for a while for safety',
  new_device_cashout: 'a large cash-out soon after setting up EcoCash on a new phone',
  velocity: 'many payments in a short time',
  behaviour_score: 'it looked unusual for this account',
  night_cashout: 'a large cash-out late at night',
}

export const TOOLS: Record<string, ToolDef> = {
  get_wallet: {
    tool: {
      name: 'get_wallet',
      description: "The user's own wallet: name, number, role (customer, merchant or agent), current balance, KYC tier and business code.",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const u = (await getUser(env.ctx.db, env.user.id))!
      return json({ name: u.name, businessName: u.business_name ?? undefined, number: u.msisdn, role: u.role, balance: money(fromCents(u.balance_cents)), kycTier: u.kyc_tier, code: u.code ?? undefined, quickPayOn: !!u.quick_pay_at })
    },
  },

  get_transactions: {
    tool: {
      name: 'get_transactions',
      description:
        "The user's own payments, newest first, with date (Maseru time), description, signed amount (negative = money out) and reference. " +
        'Use since_days to look at a period (e.g. 7 for this week) and kinds to filter.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many to return (default 20).' },
          since_days: { type: 'integer', minimum: 1, maximum: 365, description: 'Only payments from the last N days.' },
          kinds: {
            type: 'array',
            items: { type: 'string', enum: ['send', 'mpho', 'request', 'bill', 'merchant', 'tap', 'qr', 'cashin', 'cashout', 'float', 'ecosure', 'claim', 'topup', 'withdraw', 'fee', 'service'] },
            description: 'Only these kinds.',
          },
        },
        additionalProperties: false,
      },
    },
    input: z.object({ limit: z.number().int().min(1).max(100).optional(), since_days: z.number().int().min(1).max(365).optional(), kinds: z.array(z.string()).optional() }),
    async run(env, input: { limit?: number; since_days?: number; kinds?: string[] }) {
      const limit = input.limit ?? 20
      let txs = await listTransactions(env.ctx.db, env.user.id, input.since_days ? 200 : limit, input.kinds?.length ? input.kinds : undefined)
      if (input.since_days) {
        const from = Date.now() - input.since_days * 86_400_000
        txs = txs.filter((t) => new Date(t.createdAt).getTime() >= from).slice(0, limit)
      }
      const totalIn = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
      const totalOut = txs.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0)
      return json({
        count: txs.length,
        moneyIn: money(totalIn),
        moneyOut: money(totalOut),
        transactions: txs.map((t) => ({ date: maseru(t.createdAt), description: t.description, amount: money(t.amount), kind: t.kind, reference: t.reference })),
      })
    },
  },

  get_requests: {
    tool: {
      name: 'get_requests',
      description: 'Open (unpaid) money requests and split bills: ones waiting for the user to pay, and ones the user sent that others still owe.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const rows = await env.ctx.db.query<{
        kind: string; requester_id: string; requester: string; amount_cents: number; paid_cents: number; note: string | null; detail: string | null
        bill: string | null; created_at: Date; chat_title: string | null; my_share: number | null; my_share_paid: number | null; my_status: string | null; share_set: boolean | null
      }>(
        `SELECT r.kind, r.requester_id, COALESCE(u.business_name, u.name) AS requester, r.amount_cents, r.paid_cents, r.note, r.detail, r.bill,
                m.created_at, c.title AS chat_title, s.amount_cents AS my_share, s.paid_cents AS my_share_paid, s.status AS my_status, s.message_id IS NOT NULL AS share_set
         FROM requests r
           JOIN messages m ON m.id = r.message_id
           JOIN chats c ON c.id = m.chat_id
           JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
           JOIN users u ON u.id = r.requester_id
           LEFT JOIN split_shares s ON s.message_id = r.message_id AND s.user_id = $1
         WHERE r.status = 'pending'
         ORDER BY m.created_at DESC LIMIT 30`,
        [env.user.id],
      )
      const mine = (r: (typeof rows)[number]) => r.requester_id === env.user.id
      return json({
        waitingForYou: rows
          .filter((r) => !mine(r) && (r.kind !== 'split' || (r.share_set && (r.my_status === 'awaiting' || r.my_status === 'collecting'))))
          .map((r) => ({
            from: r.requester,
            kind: r.kind,
            due: r.kind === 'split' ? (r.my_share != null ? formatM(Number(r.my_share) - Number(r.my_share_paid ?? 0)) : 'you enter your own share') : formatM(Number(r.amount_cents) - Number(r.paid_cents)),
            split: r.kind === 'split' ? (r.my_status === 'awaiting' ? 'waiting for you to approve or decline' : 'approved; collected automatically as money arrives') : undefined,
            about: r.note ?? r.detail ?? r.bill ?? undefined,
            group: r.chat_title ?? undefined,
            date: maseru(r.created_at),
          })),
        youAsked: rows.filter(mine).map((r) => ({ kind: r.kind, total: formatM(Number(r.amount_cents)), paidSoFar: formatM(Number(r.paid_cents)), about: r.note ?? r.detail ?? r.bill ?? undefined, group: r.chat_title ?? undefined, date: maseru(r.created_at) })),
      })
    },
  },

  get_ecosure: {
    tool: {
      name: 'get_ecosure',
      description: "The user's EcoSure policies (package, cover, monthly premium, status, paid-up-to date, members) and claims (status, payout).",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const [policies, claims] = await Promise.all([myPolicies(env.ctx.db, env.user), myClaims(env.ctx.db, env.user)])
      return json({
        policies: policies.map((p) => ({
          number: p.number, package: p.packageName, cover: p.cover, premiumPerMonth: formatM(Math.round(p.premium * 100)), status: p.status, paidUpTo: p.nextDue,
          members: p.members.map((m) => `${m.name} (${m.relationship})`), beneficiary: p.beneficiary?.name, sponsoredBy: p.sponsoredBy?.name,
        })),
        claims: claims.map((c) => ({ reference: c.reference, policy: c.policyNumber, member: c.member.name, status: c.status, payout: c.payout != null ? formatM(Math.round(c.payout * 100)) : undefined, note: c.reason })),
      })
    },
  },

  get_fees: {
    tool: {
      name: 'get_fees',
      description: 'Current EcoCash Super App fees and limits: card top-up fee, bank transfer fee and their maximums, the daily limit, the per-transaction limit and the no-PIN tap limit.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const t = await getTariff(env.ctx.db)
      return json({
        cardTopUpFee: `${t.cardTopupFeePercent}% (at least ${formatM(Math.round(t.cardTopupFeeMin * 100))})`,
        cardTopUpMax: formatM(t.cardTopupMax * 100),
        bankTransferFee: formatM(Math.round(t.bankTransferFee * 100)),
        bankTransferMax: formatM(t.bankTransferMax * 100),
        dailyMax: formatM(t.dailyMax * 100),
        perTransactionMax: formatM(MAX_TRANSACTION * 100),
        tapWithoutPinUpTo: 'M200.00',
        sendingMoneyAndPayingMerchants: 'no EcoCash Super App fee shown in the app',
      })
    },
  },

  get_spending: {
    tool: {
      name: 'get_spending',
      description:
        "The user's money out for one month, by category (people, shops, transport = taxis, electricity, water, school, airtime, insurance, society, cash, fees, other), " +
        'with the month before beside each, money in, and who got the most. Months are Lesotho months. Use it for "how much did I spend on…", "where does my money go", comparisons between months.',
      input_schema: {
        type: 'object',
        properties: { month: { type: 'string', description: 'YYYY-MM. Leave out for this month.' } },
        additionalProperties: false,
      },
    },
    input: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
    async run(env, input: { month?: string }) {
      const month = input.month ?? maseruMonth()
      if (month > maseruMonth()) return 'That month has not started yet.'
      const s = await spendingInsights(env.ctx.db, env.user.id, month)
      return json({
        month: s.month,
        spent: money(s.spent),
        spentMonthBefore: money(s.lastMonthSpent),
        received: money(s.received),
        categories: s.categories.map((c) => ({ category: c.category, spent: money(c.amount), monthBefore: money(c.lastMonth), payments: c.count })),
        topPayees: s.topPayees.map((p) => ({ name: p.name, amount: money(p.amount) })),
      })
    },
  },

  get_ecosure_products: {
    tool: {
      name: 'get_ecosure_products',
      description: 'The EcoSure insurance products: code, name, line (funeral or short_term) and the monthly prices of each option.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const products = await loadProducts(env.ctx.db, { activeOnly: true })
      return json(products.map((p) => ({ code: p.code, name: p.name, line: p.line, options: p.options.map((o) => `${o.label}: ${formatM(Math.round(o.monthlyPremium * 100))}/month`) })))
    },
  },

  find_contact: {
    tool: {
      name: 'find_contact',
      description: 'Find people the user chats with by name (or part of it), or any registered EcoCash wallet by full phone number. Returns names and numbers.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A name, part of a name, or a phone number.' } }, required: ['query'], additionalProperties: false },
    },
    input: z.object({ query: z.string().min(1).max(60) }),
    async run(env, input: { query: string }) {
      return json(await findContacts(env, input.query))
    },
  },

  prepare_send_money: {
    tool: {
      name: 'prepare_send_money',
      description: 'Get a payment to a person ready for the user to confirm with their PIN. Does not send anything.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'The phone number from find_contact (or a full number the user gave).' },
          amount: { type: 'number', description: 'Maloti, e.g. 50 or 12.5.' },
          note: { type: 'string', description: 'Optional short note, e.g. "Lunch".' },
        },
        required: ['to', 'amount'],
        additionalProperties: false,
      },
    },
    input: z.object({ to: z.string().min(1).max(60), amount: zAmount, note: z.string().max(80).optional() }),
    async run(env, input: { to: string; amount: number; note?: string }) {
      const person = await onePerson(env, input.to)
      if (typeof person === 'string') return person
      const action: AssistantAction = { type: 'send_money', msisdn: person.msisdn, name: person.name, amount: input.amount }
      if (input.note) action.note = input.note
      return prepare(env, `Send ${formatM(Math.round(input.amount * 100))} to ${person.name}${input.note ? ` · ${input.note}` : ''}`, action)
    },
  },

  prepare_request_money: {
    tool: {
      name: 'prepare_request_money',
      description: 'Get a money request (Kopa) to a person ready for the user to send. Does not send anything.',
      input_schema: {
        type: 'object',
        properties: { to: { type: 'string', description: 'The phone number from find_contact.' }, amount: { type: 'number', description: 'Maloti.' } },
        required: ['to', 'amount'],
        additionalProperties: false,
      },
    },
    input: z.object({ to: z.string().min(1).max(60), amount: zAmount }),
    async run(env, input: { to: string; amount: number }) {
      const person = await onePerson(env, input.to)
      if (typeof person === 'string') return person
      return prepare(env, `Request ${formatM(Math.round(input.amount * 100))} from ${person.name}`, { type: 'request_money', msisdn: person.msisdn, name: person.name, amount: input.amount })
    },
  },

  prepare_payment: {
    tool: {
      name: 'prepare_payment',
      description:
        'Get one of these ready for the user to confirm: buy_electricity (an LEC prepaid token for their saved meter), top_up (card to wallet) or bank_transfer (wallet to a bank account). Does not pay anything.',
      input_schema: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['buy_electricity', 'top_up', 'bank_transfer'] }, amount: { type: 'number', description: 'Maloti.' } },
        required: ['type', 'amount'],
        additionalProperties: false,
      },
    },
    input: z.object({ type: z.enum(['buy_electricity', 'top_up', 'bank_transfer']), amount: zAmount }),
    async run(env, input: { type: 'buy_electricity' | 'top_up' | 'bank_transfer'; amount: number }) {
      const m = formatM(Math.round(input.amount * 100))
      const label = input.type === 'buy_electricity' ? `Buy an LEC token for ${m}` : input.type === 'top_up' ? `Top up ${m} from your card` : `Send ${m} to your bank account`
      return prepare(env, label, { type: input.type, amount: input.amount })
    },
  },

  prepare_ecosure_quote: {
    tool: {
      name: 'prepare_ecosure_quote',
      description: "Open an EcoSure quote for the user: 'funeral' for funeral cover, or a short-term product code from get_ecosure_products (e.g. ST-MOTOR).",
      input_schema: { type: 'object', properties: { product: { type: 'string' } }, required: ['product'], additionalProperties: false },
    },
    input: z.object({ product: z.string().min(1).max(40) }),
    async run(env, input: { product: string }) {
      if (input.product !== 'funeral') {
        const [p] = await loadProducts(env.ctx.db, { activeOnly: true, codes: [input.product] })
        if (!p) return `There is no EcoSure product "${input.product}". Use get_ecosure_products for the codes.`
        if (p.line === 'funeral') return prepare(env, 'Get a funeral cover quote', { type: 'ecosure_quote', product: 'funeral' })
        return prepare(env, `Get a quote for ${p.name}`, { type: 'ecosure_quote', product: p.code })
      }
      return prepare(env, 'Get a funeral cover quote', { type: 'ecosure_quote', product: 'funeral' })
    },
  },

  get_account_security: {
    tool: {
      name: 'get_account_security',
      description:
        "The user's own account safety: whether money is held after a SIM change (and until when, and whether their phone reported its SIM missing), " +
        'whether the PIN or the app is locked (and until when), whether sign-in codes go by email (travelling), and how many phones EcoCash is set up on.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const u = (await getUser(env.ctx.db, env.user.id))!
      const sim = await mySimSwap(env.ctx, u.id)
      const [phones] = await env.ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM bound_devices WHERE user_id = $1 AND unbound_at IS NULL', [u.id])
      const until = (d: Date | null | undefined) => (d && new Date(d).getTime() > Date.now() ? maseru(d) : null)
      return json({
        simChangeHold: sim.held ? { until: sim.heldUntil ? maseru(sim.heldUntil) : null, reportedByTheirPhone: sim.deviceOpen } : null,
        pinLockedUntil: until(u.locked_until),
        appLockedUntil: until((u as UserRow & { app_locked_until?: Date | null }).app_locked_until),
        codesByEmailUntil: until(u.codes_by_email_until),
        phonesSetUp: phones?.n ?? 0,
      })
    },
  },

  get_refused_payments: {
    tool: {
      name: 'get_refused_payments',
      description: "The user's own payments that EcoCash stopped for safety in the last 14 days: when, how much, what kind and the reason in plain words.",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    async run(env) {
      const rows = await env.ctx.db.query<{ rule: string; amount_cents: string | null; kind: string | null; created_at: Date }>(
        `SELECT rule, amount_cents, kind, created_at FROM risk_alerts WHERE user_id = $1 AND action = 'blocked' AND created_at > now() - interval '14 days'
         ORDER BY created_at DESC LIMIT 10`,
        [env.user.id],
      )
      if (!rows.length) return 'No payments were stopped in the last 14 days.'
      return json(rows.map((r) => ({
        date: maseru(r.created_at),
        amount: r.amount_cents ? money(fromCents(Number(r.amount_cents))) : undefined,
        kind: r.kind ?? undefined,
        reason: REFUSED_REASON[r.rule] ?? 'a safety check',
      })))
    },
  },

  hand_over_to_human: {
    tool: {
      name: 'hand_over_to_human',
      description:
        'Pass the conversation to a person in EcoCash support. Use it when the person asks for a human, when money seems lost, taken by mistake or by fraud, ' +
        'when their account or PIN is blocked, or when you cannot help after trying. Write a short summary of what they need; support will answer in the EcoCash Support chat.',
      input_schema: {
        type: 'object',
        properties: {
          topic: { type: 'string', enum: ['payments', 'account', 'kyc', 'ecosure', 'cards_banks', 'fraud', 'other'] },
          summary: { type: 'string', description: 'One or two sentences: what happened and what the person needs. No PINs or codes.' },
          urgent: { type: 'boolean', description: 'True for fraud, money taken or lost, a SIM changed without them, a lost or stolen phone, or someone else in their account.' },
        },
        required: ['topic', 'summary', 'urgent'],
        additionalProperties: false,
      },
    },
    input: z.object({ topic: z.enum(['payments', 'account', 'kyc', 'ecosure', 'cards_banks', 'fraud', 'other']), summary: z.string().min(5).max(400), urgent: z.boolean().optional() }),
    async run(env, input: { topic: SupportTopic; summary: string; urgent?: boolean }) {
      const ticket = await env.ctx.tx((q, out) =>
        openTicket(q, out, env.user.id, input.topic, input.summary, { priority: input.urgent || input.topic === 'fraud' ? 'urgent' : 'normal', channel: env.channel ?? 'chat' }))
      return `Ticket ${ticket.reference} opened${ticket.priority === 'urgent' ? ' as urgent' : ''} for the ${SUPPORT_TEAM[ticket.topic]} team. A person will answer in the "EcoCash Support" chat (in Chats). Tell the user that, with the reference.`
    },
  },

  open_screen: {
    tool: {
      name: 'open_screen',
      description:
        'Show a button that opens an EcoCash Super App screen: transactions, my_qr (receive QR), receive_money, pay (scan to pay), money (payment code), split (split bill), topup (card to wallet), bank (wallet to bank), remit (send money abroad), ecosure, insights (spending by category, month by month), school (pay school fees, ask someone to pay them, term dates in the phone calendar).',
      input_schema: {
        type: 'object',
        properties: { screen: { type: 'string', enum: SCREENS }, label: { type: 'string', description: 'Short button text, e.g. "See your payments".' } },
        required: ['screen', 'label'],
        additionalProperties: false,
      },
    },
    input: z.object({ screen: z.enum(SCREENS as [AssistantScreen, ...AssistantScreen[]]), label: z.string().min(1).max(60) }),
    async run(env, input: { screen: AssistantScreen; label: string }) {
      await env.ctx.tx((q, out) => postMessage(q, out, { chatId: env.chatId, senderId: env.assistantId, kind: 'action', text: input.label, action: { type: 'open', screen: input.screen } }))
      return `Shown to the user as a button: "${input.label}".`
    },
  },
}

/** Tool list in a fixed order (part of the cached prompt prefix). */
export const TOOL_LIST: BetaTool[] = Object.values(TOOLS).map((t) => t.tool)

/** "2026-10-19 14:05" in Maseru (UTC+2, no daylight saving). */
export function maseru(at: string | Date): string {
  return new Date(new Date(at).getTime() + 2 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
}
