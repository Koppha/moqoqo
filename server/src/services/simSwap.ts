// SIM swap detection. Contract: shared/api.ts "SIM swap". A swap reported by Econet (or simulated in the portal) is
// recorded, raises a risk alert for staff, and warns the owner's bound phone. The sim_swap risk rule then holds money
// leaving EcoCash and large payments (risk.ts) and refuses setting up the wallet on a new phone (onboarding), until
// the rule's hours pass or staff clear it after checking the owner in person.
import type { SimSignalBody, SimSignalResult, SimSwapEvent, SimSwapStatus } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import { latestSwap } from '../gateways/simswap'
import { logAuthEvent } from './authLog'
import { activeSwap, getRules, raiseAlert } from './risk'
import type { UserRow } from './users'

const HOUR = 3_600_000

async function swapRule(q: Queryable) {
  return (await getRules(q)).find((r) => r.key === 'sim_swap')!
}

const whenText = (at: Date) => at.toLocaleString('en-GB', { timeZone: 'Africa/Maseru', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * A number moved to a new SIM at `swappedAt`. The same swap reported twice is recorded once. For an EcoCash wallet:
 * an alert for staff (medium; a payment it then stops opens a case) and a security alert to the owner's phone.
 */
export async function recordSimSwap(ctx: Ctx, body: { msisdn: string; swappedAt: string | Date; source: SimSwapEvent['source']; detail?: string }) {
  const msisdn = normalizeMsisdn(body.msisdn, 'msisdn')
  const at = new Date(body.swappedAt)
  if (Number.isNaN(at.getTime())) throw validation('swappedAt must be a date and time')
  if (at.getTime() > Date.now() + 5 * 60_000) throw validation('swappedAt is in the future')
  const [user] = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  return ctx.tx(async (q, out) => {
    const inserted = await q.query<{ id: string }>(
      `INSERT INTO sim_swaps (id, msisdn, user_id, swapped_at, source, detail) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (msisdn, swapped_at) DO NOTHING RETURNING id`,
      [newId(), msisdn, user?.id ?? null, at, body.source, body.detail ?? null],
    )
    const recorded = inserted.length > 0
    if (!recorded || !user) return { recorded, userId: user?.id ?? null }
    const rule = await swapRule(q)
    const held = rule.enabled && Date.now() - at.getTime() < rule.params.hours * HOUR
    const device = body.source === 'device'
    const what = device ? `Bound phone: ${body.detail ?? 'EcoCash SIM replaced'}` : `SIM changed ${whenText(at)}${body.source === 'simulated' ? ' (simulated)' : ''}`
    await raiseAlert(q, user.id, {
      rule: 'sim_swap', action: 'flag', severity: 'medium',
      detail: `${what}; ${held ? `money leaving EcoCash and payments over M${rule.params.amount} held for ${rule.params.hours} h` : 'no hold (rule off or swap too old)'}`,
    }, null, null)
    const hold = held ? ` For your safety, money can't leave your wallet for ${rule.params.hours} hours, or until the SIM is back.` : ''
    out.notify({
      userIds: [user.id],
      category: 'security',
      title: device ? 'Your EcoCash SIM is not in your phone' : 'Your SIM card was changed',
      body: device
        ? `Your phone no longer has the SIM card EcoCash was set up with.${hold} If you didn't change it, call EcoCash customer care now.`
        : held
          ? `Your number moved to a new SIM card on ${whenText(at)}. For your safety, money can't leave your wallet for ${rule.params.hours} hours. If you didn't change your SIM, call EcoCash customer care now.`
          : `Your number moved to a new SIM card on ${whenText(at)}. If you didn't change your SIM, call EcoCash customer care now.`,
    })
    return { recorded, userId: user.id }
  })
}

/** How recent a swap on Econet's network must be to explain what the phone saw. */
const NETWORK_LOOKBACK_HOURS = 72

const signalText = (b: SimSignalBody) => {
  const sims = b.sims.length ? b.sims.map((s) => `${s.carrier ?? `${s.mcc ?? '?'}-${s.mnc ?? '?'}`} (slot ${s.slot + 1}${s.inService === false ? ', no service' : ''})`).join(', ') : 'no SIM'
  const kind = b.signal === 'sim_changed' ? 'a different SIM card is in the phone'
    : b.signal === 'sim_removed' ? 'the EcoCash SIM was taken out'
      : b.signal === 'no_service' ? `the EcoCash SIM has had no network for ${b.minutes ?? '?'} min`
        : 'the EcoCash SIM is back'
  return `${kind}; SIMs now: ${sims}`
}

/**
 * The bound phone's SIM watch reports what it sees. The server first asks the network: a recent swap there is recorded
 * as a network swap (the strongest evidence). Otherwise a replaced or removed SIM is recorded as a 'device' swap, which
 * holds money like any swap until the same SIM is back ('sim_ok') or staff clear it; a SIM without service only
 * raises an alert for staff (it may be a weak signal area). Every report is in the sign-in log.
 */
export async function reportSimSignal(ctx: Ctx, user: UserRow, body: SimSignalBody, ip: string | null): Promise<SimSignalResult> {
  if (!user.msisdn) throw validation('This wallet has no number')
  const msisdn = user.msisdn
  let since = new Date(body.since)
  if (Number.isNaN(since.getTime()) || since.getTime() > Date.now() + 5 * 60_000 || since.getTime() < Date.now() - 30 * 24 * HOUR) since = new Date()
  const detail = signalText(body)
  await logAuthEvent(ctx.db, { userId: user.id, kind: 'sim_signal', ip, detail })

  if (body.signal === 'sim_ok') {
    await ctx.db.query(
      `UPDATE sim_swaps SET cleared_at = now(), cleared_by = 'phone', cleared_note = 'The same SIM card is back in the bound phone'
       WHERE msisdn = $1 AND source = 'device' AND cleared_at IS NULL`,
      [msisdn],
    )
    return { confirmed: false, ...(await holdOf(ctx, user.id)) }
  }

  // Econet's records first: only a real network answer counts (the mock's rows are already recorded).
  let confirmed = false
  if (!ctx.simSwap.simulated) {
    try {
      const at = await ctx.simSwap.lastSwap(ctx.db, msisdn)
      if (at && Date.now() - at.getTime() < NETWORK_LOOKBACK_HOURS * HOUR) {
        await recordSimSwap(ctx, { msisdn, swappedAt: at, source: 'network' })
        confirmed = true
      }
    } catch (e) {
      ctx.log.warn({ err: e }, 'SIM swap lookup failed after a phone report')
    }
  }

  if (!confirmed && (body.signal === 'sim_changed' || body.signal === 'sim_removed')) {
    await recordSimSwap(ctx, { msisdn, swappedAt: since, source: 'device', detail })
  } else if (!confirmed && body.signal === 'no_service') {
    const [already] = await ctx.db.query(
      `SELECT 1 FROM risk_alerts WHERE user_id = $1 AND rule = 'sim_swap' AND detail LIKE 'Possible SIM swap%' AND created_at > now() - interval '1 day'`,
      [user.id],
    )
    if (!already) {
      await raiseAlert(ctx.db, user.id, { rule: 'sim_swap', action: 'flag', severity: 'high', detail: `Possible SIM swap: ${detail}. Econet ${ctx.simSwap.simulated ? 'not connected' : 'shows no recent swap'}` }, null, null)
    }
  }
  return { confirmed, ...(await holdOf(ctx, user.id)) }
}

async function holdOf(ctx: Ctx, userId: string): Promise<Omit<SimSignalResult, 'confirmed'>> {
  const s = await simSwapStatus(ctx, userId)
  const [open] = await ctx.db.query(`SELECT 1 FROM sim_swaps WHERE user_id = $1 AND source = 'device' AND cleared_at IS NULL`, [userId])
  return { held: s.held, heldUntil: s.heldUntil, deviceOpen: !!open }
}

/** GET /v1/me/sim-swap: whether money is held for a SIM change, for the app's SIM watch and its warning. */
export async function mySimSwap(ctx: Ctx, userId: string): Promise<Omit<SimSignalResult, 'confirmed'>> {
  return holdOf(ctx, userId)
}

async function requireWallet(q: Queryable, userId: string): Promise<UserRow> {
  const [u] = await q.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND kind = 'person'`, [userId])
  if (!u) throw notFound('User not found')
  return u
}

export async function simSwapStatus(ctx: Ctx, userId: string): Promise<SimSwapStatus> {
  const user = await requireWallet(ctx.db, userId)
  const rows = await ctx.db.query<{ id: string; swapped_at: Date; source: SimSwapEvent['source']; received_at: Date; cleared_at: Date | null; cleared_by: string | null; cleared_note: string | null; detail: string | null }>(
    `SELECT * FROM sim_swaps WHERE user_id = $1 OR msisdn = $2 ORDER BY swapped_at DESC LIMIT 50`,
    [user.id, user.msisdn],
  )
  const rule = await swapRule(ctx.db)
  let last: Date | null = null
  try {
    last = user.msisdn ? await latestSwap(ctx.db, ctx.simSwap, user.msisdn) : null
  } catch {
    last = rows[0] ? new Date(rows[0].swapped_at) : null
  }
  const cleared = user.sim_swap_cleared_at ?? null
  const pending = !!last && !(cleared && new Date(cleared).getTime() >= last.getTime())
  const until = (hours: number) => (rule.enabled && last && pending && last.getTime() + hours * HOUR > Date.now() ? iso(new Date(last.getTime() + hours * HOUR)) : null)
  const heldUntil = until(rule.params.hours)
  return {
    lastSwapAt: last ? iso(last) : null,
    held: !!heldUntil,
    heldUntil,
    setupBlockedUntil: until(rule.params.setupHours ?? rule.params.hours),
    clearedAt: cleared ? iso(cleared) : null,
    simulated: ctx.simSwap.simulated,
    events: rows.map((r) => ({
      id: r.id, swappedAt: iso(r.swapped_at), source: r.source, receivedAt: iso(r.received_at),
      clearedAt: r.cleared_at ? iso(r.cleared_at) : null, clearedBy: r.cleared_by, note: r.cleared_note, detail: r.detail,
    })),
  }
}

/** Portal, test only (mock source): pretend Econet reported a swap `hoursAgo` hours ago. */
export async function simulateSimSwap(ctx: Ctx, userId: string, hoursAgo: number) {
  if (!ctx.simSwap.simulated) throw forbidden('Econet is connected: SIM swaps come from the network, not the portal')
  const user = await requireWallet(ctx.db, userId)
  if (!user.msisdn) throw validation('This wallet has no number')
  await recordSimSwap(ctx, { msisdn: user.msisdn, swappedAt: new Date(Date.now() - hoursAgo * HOUR), source: 'simulated' })
  return simSwapStatus(ctx, userId)
}

/** Staff checked the owner in person (ID, at a shop): swaps up to now no longer hold payments or phone setup. */
export async function clearSimSwap(q: Queryable, userId: string, adminEmail: string, note: string) {
  await requireWallet(q, userId)
  await q.query('UPDATE users SET sim_swap_cleared_at = now() WHERE id = $1', [userId])
  await q.query(
    `UPDATE sim_swaps SET cleared_at = now(), cleared_by = $2, cleared_note = $3 WHERE user_id = $1 AND cleared_at IS NULL`,
    [userId, adminEmail, note],
  )
}

/** New-phone setup (and EcoSure profile start): refused while a recent swap isn't cleared. */
export async function checkSetupHold(ctx: Ctx, user: UserRow) {
  const rule = await swapRule(ctx.db)
  if (!rule.enabled) return
  const swap = await activeSwap(ctx.db, ctx.simSwap, user.id, rule.params.setupHours ?? rule.params.hours)
  if (!swap) return
  throw new AppError(
    'SIM_SWAP_HOLD',
    'This number moved to a new SIM card recently. For your safety, visit an EcoCash shop with your ID to set up EcoCash on a new phone',
  )
}
