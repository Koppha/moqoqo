// Keeps the funeral catalogue in step with EcoSure's package list (gateways/ecosurePackages.ts): at start and every
// ECOSURE_PACKAGES_SYNC_MINUTES. EcoSure is the source of the funeral packages themselves: their names, prices, cover
// amounts, waiting periods and beneficiary rules. Policies already sold keep the premium they were sold at.
//
// EcoSure groups its packages by tier (ACTIVE, Lesotho only):
//   <TIER>              (SC, IMMEDIATE) → single cover        e.g. STANDARD
//   FAMILY_<TIER>       (FC, IMMEDIATE) → family cover        e.g. FAMILY_STANDARD
//   FAMILY_EXT_<TIER>   (FC, EXTENDED)  → extended member price
// Each funeral product follows one tier (ecosure_products.ecosure_group). A tier EcoSure adds becomes a new package;
// a tier EcoSure stops listing is retired (hidden from sale; its policies carry on). Anything that fits no tier is
// listed as skipped for staff in the portal. Taglines and "most popular" stay as staff set them in the portal.
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import type { EcosurePackage, EcosurePackageSource } from '../gateways/ecosurePackages'

type Slot = 'single' | 'family' | 'extended'

export function slotOf(p: EcosurePackage): { tier: string; slot: Slot } | null {
  const g = p.packageGroup
  if (p.coverType === 'FC' && p.category === 'EXTENDED' && g.startsWith('FAMILY_EXT_') && g.length > 11) return { tier: g.slice(11), slot: 'extended' }
  if (p.coverType === 'FC' && p.category === 'IMMEDIATE' && g.startsWith('FAMILY_') && !g.startsWith('FAMILY_EXT_') && g.length > 7) {
    return { tier: g.slice(7), slot: 'family' }
  }
  if (p.coverType === 'SC' && p.category === 'IMMEDIATE' && /^[A-Z0-9_]+$/.test(g) && !g.startsWith('FAMILY_')) return { tier: g, slot: 'single' }
  return null
}

const cents = (m: number) => Math.round(m * 100)
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s_-])([a-z])/g, (_, sep: string, c: string) => `${sep === '_' ? ' ' : sep}${c.toUpperCase()}`)

/** The package's name: EcoSure's family package name without " Family" ("EcoSure Standard Family" → "EcoSure Standard"). */
function tierName(tier: string, family?: EcosurePackage, single?: EcosurePackage): string {
  const fromFamily = family?.packageName.replace(/\s+family$/i, '').trim()
  if (fromFamily) return fromFamily
  const base = single?.packageName.trim() || titleCase(tier)
  return /^ecosure\b/i.test(base) ? base : `EcoSure ${base}`
}

const LABEL: Record<'single' | 'family', { label: string; sort: number }> = {
  family: { label: 'Family cover', sort: 1 },
  single: { label: 'Single cover', sort: 2 },
}

export interface SyncResult { ok: boolean; packages: number; updated: number; skipped: string[]; error?: string }

/** A new funeral product for a tier EcoSure added: code FUN-<TIER>, after the others, with the funeral claim documents. */
async function createTier(q: Queryable, tier: string, name: string, order: number): Promise<string> {
  let code = `FUN-${tier.replace(/[^A-Z0-9]+/g, '-').slice(0, 20)}`
  for (let n = 2; (await q.query('SELECT 1 FROM ecosure_products WHERE code = $1', [code])).length; n++) code = `FUN-${tier.slice(0, 16)}-${n}`
  const [{ underwriter }] = await q.query<{ underwriter: string }>(
    `SELECT coalesce((SELECT underwriter FROM ecosure_products WHERE line = 'funeral' ORDER BY sort LIMIT 1), 'LNIG Hollard') AS underwriter`,
  )
  await q.query(
    `INSERT INTO ecosure_products (code, name, line, category, underwriter, pricing, status, sort, ecosure_group)
     VALUES ($1, $2, 'funeral', 'funeral', $3, 'fixed', 'active', $4, $5)`,
    [code, name, underwriter, order, tier],
  )
  await q.query(
    `INSERT INTO ecosure_product_claim_documents (product_code, label, sort)
     SELECT $1, label, sort FROM ecosure_product_claim_documents
     WHERE product_code = (SELECT code FROM ecosure_products WHERE line = 'funeral' AND code <> $1 ORDER BY sort LIMIT 1)`,
    [code],
  )
  return code
}

export async function syncCatalogue(ctx: Ctx, source: EcosurePackageSource): Promise<SyncResult> {
  let result: SyncResult
  try {
    const all = await source.packages()
    const live = all.filter((p) => p.status === 'ACTIVE' && (!p.countryCode || p.countryCode === 'LS'))
    const skipped: string[] = []
    const tiers = new Map<string, Partial<Record<Slot, EcosurePackage>>>()
    for (const p of live) {
      const s = slotOf(p)
      if (!s) {
        skipped.push(`${p.productPackageId} ${p.packageName}`)
        continue
      }
      const t = tiers.get(s.tier) ?? {}
      t[s.slot] = p
      tiers.set(s.tier, t)
    }
    let updated = 0
    await ctx.db.tx(async (q) => {
      const ordered = [...tiers.entries()].sort(([, a], [, b]) => rank(a) - rank(b))
      for (const [i, [tier, t]] of ordered.entries()) {
        if (!t.single && !t.family) {
          skipped.push(...Object.values(t).map((p) => `${p.productPackageId} ${p.packageName}`))
          continue
        }
        const name = tierName(tier, t.family, t.single)
        const order = (i + 1) * 10
        const [found] = await q.query<{ code: string }>(`SELECT code FROM ecosure_products WHERE ecosure_group = $1`, [tier])
        const code = found?.code ?? (await createTier(q, tier, name, order))
        if (!found) updated++
        updated += (
          await q.query(
            `UPDATE ecosure_products SET name = $2, status = 'active', sort = $3 WHERE code = $1
               AND (name, status, sort) IS DISTINCT FROM ($2::text, 'active'::text, $3::integer) RETURNING code`,
            [code, name, order],
          )
        ).length
        for (const cover of ['family', 'single'] as const) {
          const p = t[cover]
          if (!p) {
            // EcoSure no longer sells this cover on this tier: off sale here too (policies keep their own premium).
            updated += (await q.query('DELETE FROM ecosure_product_options WHERE product_code = $1 AND cover = $2 RETURNING label', [code, cover])).length
            continue
          }
          const values = [code, cover, cents(p.premiumPerMember), p.productPackageId, cents(p.sumAssured), p.waitingPeriod, p.beneficiaryMandatory]
          const changed = await q.query(
            `UPDATE ecosure_product_options SET monthly_premium_cents = $3, package_id = $4, sum_assured_cents = $5, waiting_months = $6,
               beneficiary_required = $7
             WHERE product_code = $1 AND cover = $2
               AND (monthly_premium_cents, package_id, sum_assured_cents, waiting_months, beneficiary_required)
                   IS DISTINCT FROM ($3::bigint, $4::text, $5::bigint, $6::integer, $7::boolean)
             RETURNING label`,
            values,
          )
          updated += changed.length
          const [has] = await q.query('SELECT 1 AS x FROM ecosure_product_options WHERE product_code = $1 AND cover = $2', [code, cover])
          if (!has) {
            await q.query(
              `INSERT INTO ecosure_product_options (product_code, label, cover, monthly_premium_cents, package_id, sum_assured_cents, waiting_months,
                 beneficiary_required, sort)
               VALUES ($1, $8, $2, $3, $4, $5, $6, $7, $9)`,
              [...values, LABEL[cover].label, LABEL[cover].sort],
            )
            updated++
          }
        }
        const ext = t.extended
        updated += (
          await q.query(
            `UPDATE ecosure_products SET extended_package_id = $2, extended_member_premium_cents = $3, extended_sum_assured_cents = $4
             WHERE code = $1 AND (extended_package_id, extended_member_premium_cents, extended_sum_assured_cents)
                   IS DISTINCT FROM ($2::text, $3::bigint, $4::bigint)
             RETURNING code`,
            [code, ext?.productPackageId ?? null, ext ? cents(ext.premiumPerMember) : null, ext ? cents(ext.sumAssured) : null],
          )
        ).length
      }
      // Tiers EcoSure no longer lists are taken off sale (only when the list had funeral packages at all).
      if (tiers.size) {
        updated += (
          await q.query(
            `UPDATE ecosure_products SET status = 'retired' WHERE line = 'funeral' AND status = 'active' AND ecosure_group IS NOT NULL
               AND NOT (ecosure_group = ANY($1)) RETURNING code`,
            [[...tiers.keys()]],
          )
        ).length
      }
    })
    result = { ok: true, packages: live.length, updated, skipped }
    if (updated) ctx.log.info({ updated, packages: live.length }, 'EcoSure catalogue updated from the package list')
    if (skipped.length) ctx.log.warn({ skipped }, 'EcoSure packages not in the catalogue')
  } catch (err) {
    // Keep the last good catalogue; staff see the error in the portal.
    result = { ok: false, packages: 0, updated: 0, skipped: [], error: err instanceof Error ? err.message : String(err) }
    ctx.log.warn({ err }, 'EcoSure package sync failed; keeping the current catalogue')
  }
  await ctx.db.query(
    `INSERT INTO ecosure_catalogue_sync (id, synced_at, ok, packages, updated, skipped, error) VALUES (1, now(), $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET synced_at = now(), ok = $1, packages = $2, updated = $3, skipped = $4, error = $5`,
    [result.ok, result.packages, result.updated, result.skipped, result.error ?? null],
  )
  return result
}

/** EcoSure's order for a tier: its lowest rating, then its family price. */
function rank(t: Partial<Record<Slot, EcosurePackage>>): number {
  const ps = Object.values(t)
  const ratings = ps.map((p) => p.rating).filter((r): r is number => r != null)
  return ratings.length ? Math.min(...ratings) : 1000 + (t.family ?? t.single)!.premiumPerMember
}

export async function lastSync(q: Queryable) {
  const [r] = await q.query<{ synced_at: Date; ok: boolean; packages: number; updated: number; skipped: string[]; error: string | null }>(
    'SELECT synced_at, ok, packages, updated, skipped, error FROM ecosure_catalogue_sync WHERE id = 1',
  )
  if (!r) return null
  return { at: new Date(r.synced_at).toISOString(), ok: r.ok, packages: r.packages, updated: r.updated, skipped: r.skipped ?? [], ...(r.error ? { error: r.error } : {}) }
}

export function createCatalogueSync(ctx: Ctx, source: EcosurePackageSource | null, everyMinutes: number) {
  let timer: NodeJS.Timeout | null = null
  return {
    enabled: !!source,
    sync: () => (source ? syncCatalogue(ctx, source) : Promise.resolve(null)),
    start() {
      if (!source) return
      void syncCatalogue(ctx, source)
      timer = setInterval(() => void syncCatalogue(ctx, source), everyMinutes * 60_000)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
