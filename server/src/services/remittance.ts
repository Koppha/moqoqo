// Remittance: wallet → another country through the remittance partner. Contract: shared/api.ts "remittance".
// Countries, rates, fees and limits are stored in app_settings under 'remit' and edited in the portal.
import {
  MAX_TRANSACTION,
  REMIT_PAYOUTS,
  remitFee,
  remitReceive,
  type AdminRemittance,
  type RemitCorridor,
  type Remittance,
  type RemittanceBody,
  type RemittanceResult,
  type RemittanceStatus,
  type RemitPayout,
  type RemitSettings,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { TransactionRow, TransferResult } from '../ecocash/index'
import { AppError, validation } from '../errors'
import { newId } from '../lib/crypto'
import { formatM, fromCents, paymentCents } from '../lib/money'
import { iso, startOfMaseruDay } from '../lib/time'
import { setSetting } from './maintenance'
import { moneyResult } from './money'
import { checkPin } from './pins'
import { feesAccount } from './tariff'
import { getUser, type UserRow } from './users'

export const REMIT_FEE_LABEL = 'Remittance fee'
/** "To Thabo Mokoena · South Africa" */
export const remitLabel = (name: string, country: string) => `To ${name} · ${country}`

/** PLACEHOLDER values until the partner and tariff are agreed (also seeded by migration 023). */
export const DEFAULT_REMIT: RemitSettings = {
  dailyMax: 10000,
  corridors: [
    { code: 'ZA', country: 'South Africa', currency: 'ZAR', rate: 1, fee: 15, feePercent: 1, max: 5000, payouts: ['mobile', 'bank', 'cash'], enabled: true },
    { code: 'SZ', country: 'Eswatini', currency: 'SZL', rate: 1, fee: 15, feePercent: 1, max: 5000, payouts: ['mobile', 'bank'], enabled: true },
    { code: 'BW', country: 'Botswana', currency: 'BWP', rate: 0.74, fee: 20, feePercent: 1.5, max: 5000, payouts: ['mobile', 'bank'], enabled: true },
    { code: 'ZW', country: 'Zimbabwe', currency: 'USD', rate: 0.055, fee: 20, feePercent: 2, max: 5000, payouts: ['mobile', 'cash'], enabled: true },
    { code: 'MZ', country: 'Mozambique', currency: 'MZN', rate: 3.5, fee: 20, feePercent: 2, max: 5000, payouts: ['mobile', 'cash'], enabled: false },
  ],
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

function cleanCorridor(c: Partial<RemitCorridor>): RemitCorridor | null {
  if (typeof c.code !== 'string' || typeof c.country !== 'string' || typeof c.currency !== 'string') return null
  return {
    code: c.code.toUpperCase(),
    country: c.country,
    currency: c.currency.toUpperCase(),
    rate: num(c.rate, 1),
    fee: num(c.fee, 0),
    feePercent: num(c.feePercent, 0),
    max: num(c.max, MAX_TRANSACTION),
    payouts: (Array.isArray(c.payouts) ? c.payouts : []).filter((p): p is RemitPayout => REMIT_PAYOUTS.includes(p)),
    enabled: c.enabled !== false,
  }
}

export async function getRemitSettings(q: Queryable): Promise<RemitSettings> {
  const [row] = await q.query<{ value: Partial<RemitSettings> | null }>(`SELECT value FROM app_settings WHERE key = 'remit'`)
  if (!row?.value) return structuredClone(DEFAULT_REMIT)
  const corridors = (Array.isArray(row.value.corridors) ? row.value.corridors : [])
    .map(cleanCorridor)
    .filter((c): c is RemitCorridor => c !== null)
  return { dailyMax: num(row.value.dailyMax, DEFAULT_REMIT.dailyMax), corridors }
}

export async function setRemitSettings(q: Queryable, s: RemitSettings): Promise<RemitSettings> {
  const corridors = s.corridors.map((c) => ({ ...c, code: c.code.toUpperCase(), currency: c.currency.toUpperCase() }))
  const codes = corridors.map((c) => c.code)
  if (new Set(codes).size !== codes.length) throw validation('Each country can only be listed once')
  for (const c of corridors) {
    if (c.enabled && c.payouts.length === 0) throw validation(`${c.country}: choose at least one way to receive the money`)
    if (c.max > s.dailyMax) throw validation(`${c.country}: the per-transfer maximum can't be more than the daily maximum`)
  }
  await setSetting(q, 'remit', { dailyMax: s.dailyMax, corridors })
  return getRemitSettings(q)
}

/** What the app sees: only the countries that are switched on. */
export async function publicRemitSettings(q: Queryable): Promise<RemitSettings> {
  const s = await getRemitSettings(q)
  return { ...s, corridors: s.corridors.filter((c) => c.enabled && c.payouts.length > 0) }
}

interface RemitRow {
  id: string
  reference: string
  user_id: string
  country: string
  currency: string
  payout: RemitPayout
  recipient_name: string
  recipient_phone: string | null
  bank_name: string | null
  account_number: string | null
  amount_cents: number | string
  fee_cents: number | string
  rate: string | number
  receive_minor: number | string
  status: RemittanceStatus
  partner_ref: string | null
  pickup_code: string | null
  client_id: string
  transaction_id: string | null
  fee_transaction_id: string | null
  created_at: Date
}

const countryNames = (s: RemitSettings) => new Map(s.corridors.map((c) => [c.code, c.country]))

function toRemittance(r: RemitRow, names: Map<string, string>): Remittance {
  const amountCents = Number(r.amount_cents)
  const feeCents = Number(r.fee_cents)
  return {
    id: r.id,
    reference: r.reference,
    country: r.country,
    countryName: names.get(r.country) ?? r.country,
    currency: r.currency,
    payout: r.payout,
    recipientName: r.recipient_name,
    recipientPhone: r.recipient_phone,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    amount: fromCents(amountCents),
    fee: fromCents(feeCents),
    total: fromCents(amountCents + feeCents),
    rate: Number(r.rate),
    receiveAmount: fromCents(Number(r.receive_minor)),
    status: r.status,
    pickupCode: r.pickup_code,
    createdAt: iso(r.created_at),
  }
}

export async function listRemittances(q: Queryable, me: UserRow): Promise<Remittance[]> {
  const names = countryNames(await getRemitSettings(q))
  const rows = await q.query<RemitRow>('SELECT * FROM remittances WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20', [me.id])
  return rows.map((r) => toRemittance(r, names))
}

export async function adminRemittances(q: Queryable): Promise<AdminRemittance[]> {
  const names = countryNames(await getRemitSettings(q))
  const rows = await q.query<RemitRow & { sender_name: string; sender_msisdn: string | null }>(
    `SELECT r.*, u.name AS sender_name, u.msisdn AS sender_msisdn FROM remittances r JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
  )
  return rows.map((r) => ({ ...toRemittance(r, names), sender: { id: r.user_id, name: r.sender_name, msisdn: r.sender_msisdn } }))
}

/** Digits with an optional leading +, 8 to 15 digits (international numbers). */
function checkPhone(raw: string | undefined): string {
  const v = String(raw ?? '').replace(/[\s()-]/g, '')
  if (!/^\+?\d{8,15}$/.test(v)) throw validation("Enter the recipient's phone number with the country code, e.g. +27 82 123 4567")
  return v
}

interface Recipient {
  recipientName: string
  recipientPhone: string | null
  bankName: string | null
  accountNumber: string | null
}

function checkRecipient(body: RemittanceBody, corridor: RemitCorridor): Recipient {
  if (!corridor.payouts.includes(body.payout)) throw validation(`${corridor.country} can't receive money that way`)
  const recipientName = String(body.recipientName ?? '').trim().replace(/\s+/g, ' ')
  if (recipientName.length < 3 || !/\s/.test(recipientName)) throw validation("Enter the recipient's first name and surname as on their ID")
  if (recipientName.length > 120) throw validation('The name is too long')
  if (body.payout === 'bank') {
    const bankName = String(body.bankName ?? '').trim()
    const accountNumber = String(body.accountNumber ?? '').replace(/[\s-]/g, '')
    if (bankName.length < 2 || bankName.length > 80) throw validation("Enter the recipient's bank")
    if (!/^[A-Za-z0-9]{6,34}$/.test(accountNumber)) throw validation('Check the account number')
    return { recipientName, recipientPhone: body.recipientPhone ? checkPhone(body.recipientPhone) : null, bankName, accountNumber }
  }
  return { recipientName, recipientPhone: checkPhone(body.recipientPhone), bankName: null, accountNumber: null }
}

/** A retry with the same clientId: the original remittance, its ledger row and the current balance. */
async function existingResult(q: Queryable, me: UserRow, r: RemitRow): Promise<RemittanceResult> {
  const [tx] = await q.query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [r.transaction_id])
  const fresh = (await getUser(q, me.id)) ?? me
  return { remittance: toRemittance(r, countryNames(await getRemitSettings(q))), money: await moneyResult(q, fresh, { tx, balances: new Map() }) }
}

export async function sendRemittance(ctx: Ctx, me: UserRow, body: RemittanceBody): Promise<RemittanceResult> {
  const amountCents = paymentCents(body.amount)
  const settings = await getRemitSettings(ctx.db)
  const corridor = settings.corridors.find((c) => c.enabled && c.code === String(body.country ?? '').toUpperCase())
  if (!corridor) throw validation("Sending money to that country isn't available")
  const recipient = checkRecipient(body, corridor)
  await checkPin(ctx.db, me, body.pin)

  const [dup] = await ctx.db.query<RemitRow>('SELECT * FROM remittances WHERE user_id = $1 AND client_id = $2', [me.id, body.clientId])
  if (dup) return existingResult(ctx.db, me, dup)

  const maxCents = Math.round(corridor.max * 100)
  if (amountCents > maxCents) throw new AppError('LIMIT_EXCEEDED', `The most you can send to ${corridor.country} at once is ${formatM(maxCents)}`)
  const feeCents = Math.round(remitFee(corridor, amountCents / 100) * 100)
  const receiveMinor = Math.round(remitReceive(corridor, amountCents / 100) * 100)

  return ctx.tx(async (q, out) => {
    const [wallet] = await q.query<{ balance_cents: number }>('SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE', [me.id])
    const [again] = await q.query<RemitRow>('SELECT * FROM remittances WHERE user_id = $1 AND client_id = $2', [me.id, body.clientId])
    if (again) return existingResult(q, me, again)

    const [{ used }] = await q.query<{ used: number | string }>(
      `SELECT COALESCE(sum(amount_cents), 0) AS used FROM remittances WHERE user_id = $1 AND created_at >= $2 AND status <> 'failed'`,
      [me.id, startOfMaseruDay()],
    )
    const dailyCents = Math.round(settings.dailyMax * 100)
    if (Number(used) + amountCents > dailyCents) {
      const left = Math.max(0, dailyCents - Number(used))
      throw new AppError('LIMIT_EXCEEDED', `Sending abroad is limited to ${formatM(dailyCents)} a day. You can still send ${formatM(left)} today`)
    }
    if (wallet.balance_cents < amountCents + feeCents) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        `Not enough money. You need ${formatM(amountCents + feeCents)} including the ${formatM(feeCents)} fee. Your balance is ${formatM(wallet.balance_cents)}`,
      )
    }

    // Amount and fee in this one DB transaction: both leave the wallet, or neither does.
    const withdraw = await ctx.ledger.transfer(q, {
      kind: 'withdraw',
      fromUserId: me.id,
      toUserId: null,
      amountCents,
      label: remitLabel(recipient.recipientName, corridor.country),
    })
    let fee: TransferResult | null = null
    if (feeCents > 0) {
      const fees = await feesAccount(q)
      fee = await ctx.ledger.transfer(q, { kind: 'fee', fromUserId: me.id, toUserId: fees.id, amountCents: feeCents, label: REMIT_FEE_LABEL })
    }
    const id = newId()
    await q.query(
      `INSERT INTO remittances (id, user_id, country, currency, payout, recipient_name, recipient_phone, bank_name, account_number,
         amount_cents, fee_cents, rate, receive_minor, client_id, transaction_id, fee_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id, me.id, corridor.code, corridor.currency, body.payout, recipient.recipientName, recipient.recipientPhone, recipient.bankName,
        recipient.accountNumber, amountCents, feeCents, corridor.rate, receiveMinor, body.clientId, withdraw.tx.id, fee?.tx.id ?? null,
      ],
    )
    const [{ reference }] = await q.query<{ reference: string }>('SELECT reference FROM remittances WHERE id = $1', [id])
    // Mock partner answers at once. If a real partner call fails here, the whole DB transaction rolls back.
    const sent = await ctx.remit.send({
      reference, country: corridor.code, currency: corridor.currency, payout: body.payout, ...recipient, amountCents, receiveMinor,
    })
    const [row] = await q.query<RemitRow>(
      'UPDATE remittances SET status = $2, partner_ref = $3, pickup_code = $4 WHERE id = $1 RETURNING *',
      [id, sent.status, sent.partnerRef, sent.pickupCode],
    )

    const balances = new Map([...withdraw.balances, ...(fee?.balances ?? [])])
    for (const [userId, cents] of balances) out.balance(userId, cents)
    return { remittance: toRemittance(row, countryNames(settings)), money: await moneyResult(q, me, { tx: withdraw.tx, balances }) }
  })
}
