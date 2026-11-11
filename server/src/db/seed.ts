// Demo world mirroring src/data/seed.ts in the app. Runs only when the database has no wallets.
import type { BillKey } from '../../../shared/api'
import type { Queryable } from './index'
import { hashSecret, newId, newReference, randomPassword } from '../lib/crypto'
import { Outbox } from '../realtime/outbox'
import { ASSISTANT_ACCOUNT } from '../assistant/account'
import { ATM_ACCOUNT } from '../services/atm'
import { INBOX_ACCOUNT } from '../services/inbox'
import { SUPPORT_ACCOUNT } from '../services/support'
import { ECOSURE_ACCOUNT } from '../ecosure/account'
import { FEES_ACCOUNT } from '../services/tariff'
import { BILLERS, BILL_KEYS } from '../services/billers'
import { createGroup, ensurePairChat, postMessage } from '../services/chats'

export const SEED_PIN = '1234'

/** Biller system wallets (LEC, WASCO, …). Always ensured; they are not demo data. */
export async function ensureBillers(q: Queryable) {
  for (const key of BILL_KEYS) {
    await q.query(
      `INSERT INTO users (id, msisdn, name, role, kind, official, biller, kyc_tier)
       VALUES ($1, NULL, $2, 'merchant', 'system', true, $3, 2) ON CONFLICT (biller) DO NOTHING`,
      [newId(), BILLERS[key].name, key],
    )
  }
  // EcoSure (insurance mini app): receives premiums and posts policy and claim updates into its official chat.
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, biller, kyc_tier)
     VALUES ($1, NULL, $2, 'merchant', 'system', true, $2, $3, 2) ON CONFLICT (biller) DO NOTHING`,
    [newId(), ECOSURE_ACCOUNT.name, ECOSURE_ACCOUNT.biller],
  )
  // EcoCash Super App fees wallet: receives wallet fees (ledger kind 'fee'), e.g. the bank transfer fee.
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, biller, kyc_tier)
     VALUES ($1, NULL, $2, 'merchant', 'system', true, $2, $3, 2) ON CONFLICT (biller) DO NOTHING`,
    [newId(), FEES_ACCOUNT.name, FEES_ACCOUNT.biller],
  )
  // "EcoCash Super App": the official chat where staff messages, KYC results and news & offers arrive.
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, biller, kyc_tier)
     VALUES ($1, NULL, $2, 'merchant', 'system', true, $2, $3, 2) ON CONFLICT (biller) DO NOTHING`,
    [newId(), INBOX_ACCOUNT.name, INBOX_ACCOUNT.biller],
  )
  // EcoCash Support: people from support answer customers here (tickets handed over by the assistant).
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, biller, kyc_tier)
     VALUES ($1, NULL, $2, 'merchant', 'system', true, $2, $3, 2) ON CONFLICT (biller) DO NOTHING`,
    [newId(), SUPPORT_ACCOUNT.name, SUPPORT_ACCOUNT.biller],
  )
  // EcoCash ATM: holds money for cardless ATM withdrawals until the cash comes out (or it goes back).
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, biller, kyc_tier)
     VALUES ($1, NULL, $2, 'merchant', 'system', true, $2, $3, 2) ON CONFLICT (biller) DO NOTHING`,
    [newId(), ATM_ACCOUNT.name, ATM_ACCOUNT.biller],
  )
  // EcoCash Assistant (AI): answers in each person's official assistant chat.
  await q.query(
    `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, biller, kyc_tier)
     VALUES ($1, NULL, $2, 'merchant', 'system', true, $2, $3, 2) ON CONFLICT (biller) DO NOTHING`,
    [newId(), ASSISTANT_ACCOUNT.name, ASSISTANT_ACCOUNT.biller],
  )
}

interface SeedUser {
  key: string
  msisdn: string
  name: string
  role: 'customer' | 'agent' | 'merchant'
  balance: number
  kyc: 1 | 2
  businessName?: string
  code?: string
}

const USERS: SeedUser[] = [
  { key: 'lerato', msisdn: '+26662000021', name: 'Lerato Mokhothu', role: 'customer', balance: 1240.5, kyc: 2 },
  { key: 'mme', msisdn: '+26662103401', name: 'Mme', role: 'customer', balance: 650, kyc: 2 },
  { key: 'thabo', msisdn: '+26662555010', name: 'Thabo', role: 'customer', balance: 3200, kyc: 2 },
  { key: 'palesa', msisdn: '+26662300112', name: 'Palesa Letsie', role: 'customer', balance: 85, kyc: 1 },
  { key: 'taxi', msisdn: '+26663550042', name: 'Ntate Mokoena', role: 'merchant', balance: 412, kyc: 2, businessName: 'Taxi · Ntate Mokoena', code: '1042' },
  { key: 'cafe', msisdn: '+26662888001', name: "'Mamello Ramone", role: 'merchant', balance: 1580, kyc: 2, businessName: 'Ha Abia Cafe', code: '1001' },
  { key: 'agent', msisdn: '+26662777001', name: 'Ha Abia Agent', role: 'agent', balance: 20000, kyc: 2, code: 'AGENT-0101' },
]

export async function seedDemo(q: Queryable): Promise<boolean> {
  const [{ n }] = await q.query<{ n: number }>(`SELECT count(*) AS n FROM users WHERE kind = 'person'`)
  if (n > 0) return false

  const id: Record<string, string> = {}
  for (const u of USERS) {
    const { hash, salt } = await hashSecret(SEED_PIN)
    id[u.key] = newId()
    await q.query(
      `INSERT INTO users (id, msisdn, name, role, business_name, code, kyc_tier, balance_cents, pin_hash, pin_salt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - interval '30 days')`,
      [id[u.key], u.msisdn, u.name, u.role, u.businessName ?? null, u.code ?? null, u.kyc, Math.round(u.balance * 100), hash, salt],
    )
  }
  // Demo NFC sticker (same UID as migration 002 links on databases seeded before it existed).
  await q.query(
    `INSERT INTO nfc_tags (id, tag_id, user_id, label) VALUES ($1, '04A2246A8B6D80', $2, 'EcoCash sticker') ON CONFLICT (tag_id) DO NOTHING`,
    [newId(), id.lerato],
  )
  const billers = await q.query<{ id: string; biller: BillKey }>(`SELECT id, biller FROM users WHERE kind = 'system' AND biller = ANY($1)`, [BILL_KEYS])
  const biller = Object.fromEntries(billers.map((b) => [b.biller, b.id])) as Record<BillKey, string>

  const now = Date.now()
  const ago = (minutes: number) => new Date(now - minutes * 60_000)
  const H = 60
  const D = 24 * H
  const out = new Outbox() // seed events go nowhere

  // Lerato ↔ Mme: Mme asks Lerato to buy electricity for her house.
  const mme = (await ensurePairChat(q, out, id.lerato, id.mme)).chatId
  await postMessage(q, out, { chatId: mme, senderId: id.mme, kind: 'text', text: 'Lumela ngoanaka 😊', createdAt: ago(40) })
  await postMessage(q, out, { chatId: mme, senderId: id.mme, kind: 'text', text: 'Motlakase o felile, ke kopa u ntefelle 🙏', createdAt: ago(39) })
  await postMessage(q, out, {
    chatId: mme,
    senderId: id.mme,
    kind: 'request',
    createdAt: ago(38),
    request: { kind: 'bill', bill: 'lec', requesterId: id.mme, toUserId: biller.lec, amountCents: 10000, account: '04127731905', detail: "Meter 0412 7731 905 · Mme's house" },
  })

  // Lelapa (Family) group.
  const lelapa = await createGroup(q, out, id.mme, 'Lelapa (Family)', [id.lerato, id.thabo])
  const l1 = newId()
  await postMessage(q, out, { id: l1, chatId: lelapa, senderId: id.thabo, kind: 'money', amountCents: 80000, note: 'For school fees · sent from Johannesburg', createdAt: ago(2 * D) })
  await postMessage(q, out, { chatId: lelapa, senderId: id.mme, kind: 'text', text: 'Kea leboha Thabo 🙏🏾', createdAt: ago(2 * D - H) })
  const l3 = newId()
  await postMessage(q, out, {
    id: l3,
    chatId: lelapa,
    senderId: id.mme,
    kind: 'request',
    createdAt: ago(D),
    request: {
      kind: 'bill',
      bill: 'school',
      requesterId: id.mme,
      toUserId: biller.school,
      amountCents: 120000,
      paidCents: 60000,
      account: 'LHS-T3-0931',
      detail: 'Lesotho High School · Term 3 · Thabo paid M600',
      paidByName: 'Thabo',
    },
  })

  // LEC official chat with an earlier token.
  const lec = (await ensurePairChat(q, out, biller.lec, id.lerato, { kind: 'official' })).chatId
  await postMessage(q, out, {
    chatId: lec,
    senderId: biller.lec,
    kind: 'text',
    text: 'Token for meter 0412 8890 113:\n2216-4471-0983-5512-7704\nM100.00 · 68.4 kWh',
    createdAt: ago(D + 2 * H),
  })

  // Taxi receipt.
  const taxi = (await ensurePairChat(q, out, id.lerato, id.taxi)).chatId
  const t1 = newId()
  await postMessage(q, out, { id: t1, chatId: taxi, senderId: id.lerato, kind: 'receipt', amountCents: 1200, note: 'Maseru → Ha Thetsane', createdAt: ago(3 * D) })

  // Read state: Lerato has not opened Mme's chat yet and has not seen the school-fees request.
  await q.query('UPDATE chat_members SET last_read_at = NULL WHERE chat_id = $1 AND user_id = $2', [mme, id.lerato])
  await q.query('UPDATE chat_members SET last_read_at = $3 WHERE chat_id = $1 AND user_id = $2', [lelapa, id.lerato, ago(2 * D - H)])
  await q.query('UPDATE chat_members SET last_read_at = $2 WHERE chat_id = ANY($1)', [[lec, taxi], ago(D)])
  await q.query('UPDATE chats c SET updated_at = (SELECT max(created_at) FROM messages m WHERE m.chat_id = c.id)')

  // History so transaction lists are not empty. Balances above are already the end state.
  const tx = async (kind: string, from: string | null, to: string | null, amount: number, at: Date, extra: { label?: string; note?: string; messageId?: string } = {}) =>
    q.query(
      `INSERT INTO transactions (id, reference, kind, amount_cents, from_user_id, to_user_id, label, note, message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newId(), newReference(), kind, Math.round(amount * 100), from, to, extra.label ?? null, extra.note ?? null, extra.messageId ?? null, at],
    )
  await tx('float', null, id.agent, 20000, ago(10 * D), { label: 'Float top-up', note: 'Opening float' })
  await tx('send', id.thabo, id.lerato, 800, ago(2 * D), { note: 'For school fees · sent from Johannesburg', messageId: l1 })
  await tx('bill', id.thabo, biller.school, 600, ago(D + 30), { label: 'School fees · LHS-T3-0931', messageId: l3 })
  await tx('bill', id.lerato, biller.lec, 100, ago(D + 2 * H), { label: 'LEC · 04128890113' })
  await tx('bill', id.lerato, biller.airtime, 30, ago(3 * D - 2 * H), { label: 'Airtime · +26662000021' })
  await tx('tap', id.lerato, id.taxi, 12, ago(3 * D), { messageId: t1 })
  await tx('cashin', id.agent, id.mme, 200, ago(D + 5 * H))
  await tx('tap', id.thabo, id.cafe, 45, ago(3 * H))

  // Societies (Mekhatlo): Lerato is a signatory of one and a member of the others; the Motšelo has a monthly M200.
  const society = async (code: string, name: string, cents: number, signatories: string[], members: string[], kind = 'society', contribution: number | null = null) => {
    const wallet = newId()
    const sid = newId()
    await q.query(
      `INSERT INTO users (id, msisdn, name, role, kind, official, business_name, kyc_tier, balance_cents) VALUES ($1, NULL, $2, 'merchant', 'system', false, $2, 2, $3)`,
      [wallet, name, cents],
    )
    await q.query(
      'INSERT INTO societies (id, code, name, wallet_user_id, approvals_required, kind, contribution_cents) VALUES ($1, $2, $3, $4, 2, $5, $6)',
      [sid, code, name, wallet, kind, contribution],
    )
    for (const u of signatories) await q.query(`INSERT INTO society_members (society_id, user_id, role) VALUES ($1, $2, 'signatory')`, [sid, u])
    for (const u of members) await q.query(`INSERT INTO society_members (society_id, user_id, role) VALUES ($1, $2, 'member')`, [sid, u])
    return wallet
  }
  await society('7896', 'Molemi Burial Society', 33000, [id.lerato, id.mme], [id.thabo, id.palesa], 'burial')
  await society('7745', 'Digital Transformation', 2370, [id.thabo, id.mme], [id.lerato])
  // Thabo and Mme have paid this month's M200; Lerato and Palesa still owe.
  const pot = await society('4410', 'Motšelo oa Ha Abia', 40000, [id.mme, id.thabo], [id.lerato, id.palesa], 'motselo', 20000)
  await tx('send', id.thabo, pot, 200, ago(H), { label: 'Motšelo oa Ha Abia · contribution' })
  await tx('send', id.mme, pot, 200, ago(2 * H), { label: 'Motšelo oa Ha Abia · contribution' })
  return true
}

/**
 * Demo business owners (EcoCash Business mini app): Lerato's verified ID, her own merchant account (Lerato's Salon)
 * and the owner IDs of the demo businesses, so only each owner can add theirs. Runs on every start of a demo server
 * and changes nothing once done, or on a database without the demo wallets.
 */
export async function ensureDemoBusinessOwners(q: Queryable) {
  const [lerato] = await q.query<{ id: string }>(`SELECT id FROM users WHERE msisdn = '+26662000021' AND name = 'Lerato Mokhothu'`)
  if (!lerato) return
  const LERATO_ID = '9001010001'
  await q.query(`UPDATE users SET id_number = $2, id_verified_at = coalesce(id_verified_at, now()) WHERE id = $1 AND id_number IS NULL`, [lerato.id, LERATO_ID])
  await q.query(`UPDATE users SET owner_id_number = '7505050042' WHERE code = '1042' AND owner_id_number IS NULL`)
  await q.query(`UPDATE users SET owner_id_number = '8203030001' WHERE code = '1001' AND owner_id_number IS NULL`)
  await q.query(`UPDATE users SET owner_id_number = '7801010101' WHERE code = 'AGENT-0101' AND owner_id_number IS NULL`)
  const [salon] = await q.query(`SELECT 1 FROM users WHERE msisdn = '+26662888021'`)
  if (!salon) {
    const { hash, salt } = await hashSecret(SEED_PIN)
    await q.query(
      `INSERT INTO users (id, msisdn, name, role, business_name, code, kyc_tier, pin_hash, pin_salt, owner_id_number, created_at)
       VALUES ($1, '+26662888021', 'Lerato Mokhothu', 'merchant', 'Lerato’s Salon', '1002', 2, $2, $3, $4, now() - interval '30 days')`,
      [newId(), hash, salt, LERATO_ID],
    )
  }
}

/** Creates the first admin when there is none. Returns the generated password (printed once by the caller). */
export async function ensureFirstAdmin(
  q: Queryable,
  opts: { email: string | null; password: string | null },
): Promise<{ email: string; generatedPassword: string | null } | null> {
  const [{ n }] = await q.query<{ n: number }>('SELECT count(*) AS n FROM admins')
  if (n > 0) return null
  const email = (opts.email ?? 'admin@moqoqo.local').toLowerCase()
  const generatedPassword = opts.password ? null : randomPassword()
  const { hash, salt } = await hashSecret(opts.password ?? generatedPassword!)
  await q.query(
    `INSERT INTO admins (id, email, name, role, password_hash, password_salt) VALUES ($1, $2, 'Administrator', 'admin', $3, $4)`,
    [newId(), email, hash, salt],
  )
  return { email, generatedPassword }
}
