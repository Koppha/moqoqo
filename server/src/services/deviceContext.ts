// Binding on more than one property (CBL/LCA DFS guidelines 3.2.3a/b): every request from a bound phone carries its
// context (screen, model, network, carrier, time zone, rough location; plus the IP the server sees). The server learns
// what that phone usually looks like and scores a request that differs. The score feeds the fraud score of payments
// made soon after ("unusual_context"), the sign-in log and a security alert to the owner. Nothing is blocked here.
import { DEVICE_CONTEXT_HEADER, type DeviceContext, type DeviceProfileSummary } from '../../../shared/api'
import type { Queryable } from '../db/index'

interface Profile {
  seen?: number
  screens?: string[]
  models?: string[]
  nets?: string[]
  carriers?: string[]
  tzs?: string[]
  ips?: string[]
  cells?: string[]
}
export interface ContextRisk { points: number; reasons: string[]; /** On Wi-Fi from an address range this phone never used. */ newNetwork?: boolean }

/** Requests from a phone before it is judged: its usual look is still being learned. */
const LEARNING = 3
const MAX_POINTS = 40
/** Requests scoring this much are not learned from (see assessAndLearn). */
const NO_LEARN_POINTS = 25
const CAP = { screens: 6, models: 4, nets: 4, carriers: 6, tzs: 6, ips: 30, cells: 20 }

/** The header, checked and trimmed; anything malformed counts as no context (older apps send none). */
export function parseContext(raw: unknown): DeviceContext | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<DeviceContext>
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
    const net = ['cellular', 'wifi', 'other', 'none'].includes(c.net as string) ? (c.net as DeviceContext['net']) : 'other'
    const screen = str(c.screen, 20)
    const os = str(c.os, 40)
    const model = str(c.model, 60)
    const tz = str(c.tz, 60)
    if (!screen || !os || !model || !tz || !/^\d{2,5}x\d{2,5}$/.test(screen)) return null
    const loc = Array.isArray(c.loc) && c.loc.length === 2 && c.loc.every((n) => typeof n === 'number' && Number.isFinite(n)) ? ([c.loc[0], c.loc[1]] as [number, number]) : null
    const wifi = c.wifi === 'open' || c.wifi === 'secured' ? c.wifi : null
    return { net, carrier: str(c.carrier, 60), screen, os, model, tz, loc, wifi }
  } catch {
    return null
  }
}
export const contextFromHeaders = (headers: Record<string, unknown>) => parseContext(headers[DEVICE_CONTEXT_HEADER])

const ipPrefix = (ip: string) => (ip.includes(':') ? ip.split(':').slice(0, 3).join(':') : ip.split('.').slice(0, 2).join('.'))
/** Half-degree cells (about 50 km): enough to tell Maseru from Johannesburg, not where someone lives. */
const cell = (loc: [number, number]) => `${(Math.round(loc[0] * 2) / 2).toFixed(1)},${(Math.round(loc[1] * 2) / 2).toFixed(1)}`
const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r)
  const y = (b[0] - a[0]) * r
  return Math.sqrt(x * x + y * y) * 6371
}

export function assess(p: Profile, c: DeviceContext, ip: string): ContextRisk {
  if ((p.seen ?? 0) < LEARNING) return { points: 0, reasons: [] }
  let points = 0
  const reasons: string[] = []
  const add = (n: number, why: string) => { points += n; reasons.push(why) }
  if (p.models?.length && !p.models.includes(c.model)) add(25, `model ${c.model}, usually ${p.models[0]}`)
  if (p.screens?.length && !p.screens.includes(c.screen)) add(25, `screen ${c.screen}, usually ${p.screens[0]}`)
  if (p.tzs?.length && !p.tzs.includes(c.tz)) add(10, `time zone ${c.tz}`)
  if (c.loc && p.cells?.length) {
    const near = Math.min(...p.cells.map((s) => km(s.split(',').map(Number) as [number, number], c.loc!)))
    if (near > 150) add(15, `about ${Math.round(near)} km from where this phone is usually used`)
  }
  if (c.carrier && p.carriers?.length && !p.carriers.includes(c.carrier)) add(5, `network ${c.carrier}`)
  const newRange = !!p.ips?.length && !p.ips.includes(ipPrefix(ip))
  if (newRange) add(5, 'new internet address range')
  if (c.wifi === 'open') add(10, 'open Wi-Fi (no password)')
  return { points: Math.min(MAX_POINTS, points), reasons, newNetwork: newRange && c.net === 'wifi' }
}

export function learn(p: Profile, c: DeviceContext, ip: string): { next: Profile; changed: boolean } {
  let changed = false
  const push = (list: string[] | undefined, v: string | null | undefined, cap: number) => {
    const l = [...(list ?? [])]
    if (!v || l.includes(v)) return l
    changed = true
    l.unshift(v)
    return l.slice(0, cap)
  }
  const next: Profile = {
    seen: (p.seen ?? 0) + 1,
    screens: push(p.screens, c.screen, CAP.screens),
    models: push(p.models, c.model, CAP.models),
    nets: push(p.nets, c.net, CAP.nets),
    carriers: push(p.carriers, c.carrier, CAP.carriers),
    tzs: push(p.tzs, c.tz, CAP.tzs),
    ips: push(p.ips, ipPrefix(ip), CAP.ips),
    cells: push(p.cells, c.loc ? cell(c.loc) : null, CAP.cells),
  }
  return { next, changed: changed || (p.seen ?? 0) < LEARNING }
}

/** Requests to the bound phone's profile are written when something new is learned, or at most once a minute. */
const lastWrite = new Map<string, number>()

export async function assessAndLearn(q: Queryable, deviceRowId: string, c: DeviceContext, ip: string): Promise<ContextRisk> {
  const [row] = await q.query<{ profile: Profile | null }>('SELECT profile FROM bound_devices WHERE id = $1', [deviceRowId])
  const profile = row?.profile ?? {}
  const risk = assess(profile, c, ip)
  // A request that looks unlike the phone teaches nothing: otherwise one odd request would make the next look normal.
  if (risk.points >= NO_LEARN_POINTS) return risk
  const { next, changed } = learn(profile, c, ip)
  const now = Date.now()
  if (changed || now - (lastWrite.get(deviceRowId) ?? 0) > 60_000) {
    lastWrite.set(deviceRowId, now)
    await q.query('UPDATE bound_devices SET profile = $2 WHERE id = $1', [deviceRowId, JSON.stringify(next)])
  }
  return risk
}

// The last context score per wallet, for the fraud score of a payment made right after (the ledger has no request).
const recent = new Map<string, ContextRisk & { at: number }>()
const RECENT_MS = 5 * 60_000
export function rememberRisk(userId: string, risk: ContextRisk) {
  // Within the window the highest score stands: a normal-looking request doesn't wipe an unusual one just before.
  const prev = recentRisk(userId)
  if (prev && prev.points > risk.points) return
  recent.set(userId, { ...risk, at: Date.now() })
  if (recent.size > 100_000) for (const [k, v] of recent) if (Date.now() - v.at > RECENT_MS) recent.delete(k)
}
export function recentRisk(userId: string): ContextRisk | null {
  const r = recent.get(userId)
  return r && Date.now() - r.at < RECENT_MS && r.points > 0 ? r : null
}

export function summarize(p: Profile | null | undefined): DeviceProfileSummary | undefined {
  if (!p || !p.seen) return undefined
  return { screens: p.screens ?? [], nets: p.nets ?? [], carriers: p.carriers ?? [], timeZones: p.tzs ?? [], areas: p.cells?.length ?? 0, seen: p.seen }
}
