// Monitoring and analysing sign-in attempts (CBL/LCA DFS guidelines 3.2.5b-vi). Runs with transaction surveillance
// every 15 minutes over auth_events: one address trying many wallets (credential stuffing), a wallet whose PIN keeps
// getting locked, and a bound phone repeatedly unlike itself. Findings become risk alerts (Risk, Cases) and are
// marked on the sign-in log; each is raised at most once a day per wallet.
import type { AuthEvent, AuthEventKind, AuthMonitor } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { iso } from '../lib/time'
import { logAuthEvent } from './authLog'
import { raiseAlert } from './risk'
import { getUsers, toPublicUser } from './users'

/** Placeholders until ETL decides. */
export const AUTH_ANALYSIS = { attackWallets: 5, attackMinutes: 30, locksPerDay: 2, unusualPerDay: 3 }

async function alertedToday(q: Queryable, userId: string, detailStart: string) {
  const [r] = await q.query(
    `SELECT 1 FROM risk_alerts WHERE user_id = $1 AND rule = 'auth_anomaly' AND detail LIKE $2 AND created_at > now() - interval '1 day'`,
    [userId, `${detailStart}%`],
  )
  return !!r
}

export async function analyseAuth(ctx: Ctx): Promise<number> {
  const q = ctx.db
  const a = AUTH_ANALYSIS
  let raised = 0

  // One address, refused sign-ins on many wallets in a short time: someone guessing PINs across accounts.
  const attacks = await q.query<{ ip: string; users: string[]; n: number }>(
    `SELECT ip, array_agg(DISTINCT user_id) AS users, count(*)::int AS n FROM auth_events
     WHERE kind = 'login_failed' AND ip IS NOT NULL AND user_id IS NOT NULL AND created_at > now() - make_interval(mins => $1)
     GROUP BY ip HAVING count(DISTINCT user_id) >= $2`,
    [a.attackMinutes, a.attackWallets],
  )
  for (const atk of attacks) {
    for (const userId of atk.users) {
      const head = `Sign-in attack from ${atk.ip}`
      if (await alertedToday(q, userId, head)) continue
      await raiseAlert(q, userId, { rule: 'auth_anomaly', action: 'flag', severity: 'medium', detail: `${head}: ${atk.n} refused sign-ins on ${atk.users.length} wallets in ${a.attackMinutes} minutes` }, null, null)
      await logAuthEvent(q, { userId, kind: 'auth_attack', ip: atk.ip, detail: `${atk.users.length} wallets targeted` })
      raised++
    }
  }

  // A wallet whose PIN keeps getting locked: someone else may be trying it.
  for (const r of await q.query<{ user_id: string; n: number }>(
    `SELECT user_id, count(*)::int AS n FROM auth_events WHERE kind = 'pin_locked' AND user_id IS NOT NULL AND created_at > now() - interval '1 day'
     GROUP BY user_id HAVING count(*) >= $1`,
    [a.locksPerDay],
  )) {
    const head = 'PIN locked repeatedly'
    if (await alertedToday(q, r.user_id, head)) continue
    await raiseAlert(q, r.user_id, { rule: 'auth_anomaly', action: 'flag', severity: 'medium', detail: `${head}: ${r.n} times in 24 hours` }, null, null)
    raised++
  }

  // The bound phone keeps looking unlike itself.
  for (const r of await q.query<{ user_id: string; n: number }>(
    `SELECT user_id, count(*)::int AS n FROM auth_events WHERE kind IN ('unusual_context', 'device_mismatch') AND user_id IS NOT NULL
       AND created_at > now() - interval '1 day' GROUP BY user_id HAVING count(*) >= $1`,
    [a.unusualPerDay],
  )) {
    const head = 'Phone repeatedly unlike itself'
    if (await alertedToday(q, r.user_id, head)) continue
    await raiseAlert(q, r.user_id, { rule: 'auth_anomaly', action: 'flag', severity: 'high', detail: `${head}: ${r.n} times in 24 hours` }, null, null)
    raised++
  }
  return raised
}

type Row = { id: string; user_id: string | null; admin_id: string | null; kind: AuthEventKind; app: string | null; ip: string | null; detail: string | null; created_at: Date }

/** The portal's Sign-in monitoring page. */
export async function authMonitor(q: Queryable, days: number): Promise<AuthMonitor> {
  const byDayRows = await q.query<{ day: string; kind: AuthEventKind; n: number }>(
    `SELECT to_char((created_at + interval '2 hours')::date, 'YYYY-MM-DD') AS day, kind, count(*)::int AS n FROM auth_events
     WHERE created_at > now() - make_interval(days => $1) GROUP BY 1, 2`,
    [days],
  )
  const dayMap = new Map<string, Partial<Record<AuthEventKind, number>>>()
  const totals: Partial<Record<AuthEventKind, number>> = {}
  for (const r of byDayRows) {
    const d = dayMap.get(r.day) ?? {}
    d[r.kind] = r.n
    dayMap.set(r.day, d)
    totals[r.kind] = (totals[r.kind] ?? 0) + r.n
  }
  const topAddresses = await q.query<{ ip: string; failures: number; wallets: number; last_at: Date }>(
    `SELECT ip, count(*)::int AS failures, count(DISTINCT user_id)::int AS wallets, max(created_at) AS last_at FROM auth_events
     WHERE kind IN ('login_failed', 'unlock_failed') AND ip IS NOT NULL AND created_at > now() - make_interval(days => $1)
     GROUP BY ip ORDER BY failures DESC LIMIT 10`,
    [days],
  )
  const topWallets = await q.query<{ user_id: string; failures: number; locks: number; last_at: Date }>(
    `SELECT user_id, count(*) FILTER (WHERE kind IN ('pin_wrong', 'login_failed', 'unlock_failed'))::int AS failures,
       count(*) FILTER (WHERE kind = 'pin_locked')::int AS locks, max(created_at) AS last_at
     FROM auth_events WHERE user_id IS NOT NULL AND created_at > now() - make_interval(days => $1)
       AND kind IN ('pin_wrong', 'login_failed', 'unlock_failed', 'pin_locked')
     GROUP BY user_id ORDER BY locks DESC, failures DESC LIMIT 10`,
    [days],
  )
  const recent = await q.query<Row & { admin_email: string | null }>(
    `SELECT e.*, a.email AS admin_email FROM auth_events e LEFT JOIN admins a ON a.id = e.admin_id
     WHERE e.kind <> 'pin_ok' ORDER BY e.created_at DESC LIMIT 100`,
  )
  const users = await getUsers(q, [...topWallets.map((w) => w.user_id), ...recent.flatMap((r) => (r.user_id ? [r.user_id] : []))])
  const pub = (id: string | null) => {
    const u = id ? users.get(id) : null
    return u ? toPublicUser(u) : null
  }
  return {
    days,
    byDay: [...dayMap.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([day, counts]) => ({ day, counts })),
    totals,
    topAddresses: topAddresses.map((r) => ({ ip: r.ip, failures: r.failures, wallets: r.wallets, lastAt: iso(r.last_at) })),
    topWallets: topWallets.flatMap((r) => {
      const user = pub(r.user_id)
      return user ? [{ user, failures: r.failures, locks: r.locks, lastAt: iso(r.last_at) }] : []
    }),
    recent: recent.map((r): AuthEvent & { user: ReturnType<typeof pub>; admin: string | null } => ({
      id: r.id, kind: r.kind, app: r.app, ip: r.ip, detail: r.detail, createdAt: iso(r.created_at), user: pub(r.user_id), admin: r.admin_email,
    })),
  }
}
