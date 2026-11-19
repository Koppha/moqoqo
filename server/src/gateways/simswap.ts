// SIM swap: when a number last moved to a new SIM card. Econet (ETL) knows this from its network records.
//
// Three ways in: Econet pushes each swap to POST /v1/hooks/sim-swap (recorded in sim_swaps); the server asks Econet's
// SIM swap API before a risky step (`lastSwap`, EconetSimSwap); and the bound phone reports what it sees (its SIM
// replaced or taken out: sim_swaps rows with source 'device'). MockSimSwap answers from the recorded rows only (which
// staff can simulate in the portal).
import type { Queryable } from '../db/index'

export interface SimSwapSource {
  /** True for the mock: the portal offers "Simulate a SIM swap". */
  readonly simulated: boolean
  /** When the number's SIM last changed, or null if never (as far as the network knows). */
  lastSwap(q: Queryable, msisdn: string): Promise<Date | null>
}

/** Device rows still in force: cleared ones (the same SIM came back, or staff checked) no longer count. */
const OPEN_ROWS = `msisdn = $1 AND NOT (source = 'device' AND cleared_at IS NOT NULL)`

export class MockSimSwap implements SimSwapSource {
  readonly simulated = true
  async lastSwap(q: Queryable, msisdn: string): Promise<Date | null> {
    const [r] = await q.query<{ at: Date | null }>(`SELECT max(swapped_at) AS at FROM sim_swaps WHERE ${OPEN_ROWS}`, [msisdn])
    return r?.at ? new Date(r.at) : null
  }
}

/**
 * The latest swap from any source: the network's answer, or a swap the bound phone reported that is still open.
 * Used wherever a hold is decided, so a phone's report counts even when the real Econet adapter is connected.
 */
export async function latestSwap(q: Queryable, source: SimSwapSource, msisdn: string): Promise<Date | null> {
  const [network, device] = await Promise.all([
    source.lastSwap(q, msisdn),
    q.query<{ at: Date | null }>(`SELECT max(swapped_at) AS at FROM sim_swaps WHERE source = 'device' AND cleared_at IS NULL AND msisdn = $1`, [msisdn]),
  ])
  const d = device[0]?.at ? new Date(device[0].at) : null
  if (!network) return d
  if (!d) return network
  return network.getTime() >= d.getTime() ? network : d
}

export interface EconetSimSwapConfig {
  /** Base URL of Econet's SIM swap API. */
  url: string
  /** API key or bearer token Econet issues. */
  key: string
  /** Header that carries the key (default Authorization, sent as "Bearer <key>"). */
  header: string
  /** How long an answer is reused for the same number, in seconds (one payment can ask several times). */
  cacheSeconds: number
  /** Give up after this many milliseconds. */
  timeoutMs: number
}

/**
 * Econet's SIM swap API. Shaped on the GSMA Open Gateway (CAMARA) SIM Swap API, "retrieve-date":
 * POST {url}/retrieve-date {"phoneNumber":"+266…"} → {"latestSimChange":"2026-11-12T08:30:00Z" | null}.
 * TO CONFIRM with Econet's API documents: the path, the auth header, the number format and the field names. Only
 * `request()` and `parse()` should need to change.
 */
export class EconetSimSwap implements SimSwapSource {
  readonly simulated = false
  private cache = new Map<string, { at: Date | null; until: number }>()

  constructor(private readonly cfg: EconetSimSwapConfig, private readonly fetcher: typeof fetch = fetch) {}

  async lastSwap(_q: Queryable, msisdn: string): Promise<Date | null> {
    const hit = this.cache.get(msisdn)
    if (hit && hit.until > Date.now()) return hit.at
    const at = this.parse(await this.request(msisdn))
    this.cache.set(msisdn, { at, until: Date.now() + this.cfg.cacheSeconds * 1000 })
    if (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value!)
    return at
  }

  private async request(msisdn: string): Promise<unknown> {
    const auth = this.cfg.header.toLowerCase() === 'authorization' ? `Bearer ${this.cfg.key}` : this.cfg.key
    const res = await this.fetcher(`${this.cfg.url.replace(/\/+$/, '')}/retrieve-date`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [this.cfg.header]: auth },
      body: JSON.stringify({ phoneNumber: msisdn.startsWith('+') ? msisdn : `+${msisdn}` }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    })
    if (!res.ok) throw new Error(`Econet SIM swap API answered ${res.status}`)
    return res.json()
  }

  private parse(body: unknown): Date | null {
    const v = (body as { latestSimChange?: unknown } | null)?.latestSimChange
    if (v == null || v === '') return null
    const at = new Date(String(v))
    if (Number.isNaN(at.getTime())) throw new Error('Econet SIM swap API: latestSimChange is not a date')
    return at
  }
}
