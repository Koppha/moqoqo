// Home layout, news & offers and in-app broadcasts: all set in the portal.
import { z } from 'zod'
import { HOME_SECTIONS, OFFER_TARGETS, type Audience, type Broadcast, type HomeContent, type HomeLayout, type Offer, type OfferBody } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { iso, isoOrNull } from '../lib/time'
import { postToInbox } from './inbox'
import { setSetting } from './maintenance'
import type { UserRow } from './users'

interface OfferRow {
  id: string; title: Offer['title']; body: Offer['body']; cta: Offer['cta']; image: string | null; color: string; target: string | null
  placement: Offer['placement']; audience: Audience; starts_at: Date; ends_at: Date | null; sort: number; enabled: boolean
}
const toOffer = (r: OfferRow): Offer => {
  const o: Offer = {
    id: r.id, title: r.title, body: r.body, cta: r.cta, color: r.color, target: (r.target as Offer['target']) ?? null, placement: r.placement,
    audience: r.audience, startsAt: iso(r.starts_at), endsAt: isoOrNull(r.ends_at), sort: r.sort, enabled: r.enabled,
  }
  if (r.image) o.image = r.image
  return o
}

/** Which people an audience means, as an SQL condition on users. */
const AUDIENCE_USERS: Record<Audience, string> = {
  all: 'true', customers: `role = 'customer'`, business: `role <> 'customer'`, tier1: 'kyc_tier = 1', tier2: 'kyc_tier = 2',
}
/** Does this user belong to the audience? */
export function inAudience(a: Audience, u: Pick<UserRow, 'role' | 'kyc_tier'>): boolean {
  switch (a) {
    case 'all': return true
    case 'customers': return u.role === 'customer'
    case 'business': return u.role !== 'customer'
    case 'tier1': return u.kyc_tier === 1
    case 'tier2': return u.kyc_tier === 2
  }
}

export async function offersFor(q: Queryable, u: UserRow, placement: 'home' | 'news'): Promise<Offer[]> {
  const rows = await q.query<OfferRow>(
    `SELECT * FROM offers WHERE enabled AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) AND placement IN ($1, 'both')
     ORDER BY ${placement === 'home' ? 'sort, created_at DESC' : 'created_at DESC'} LIMIT 60`,
    [placement],
  )
  return rows.filter((r) => inAudience(r.audience, u)).slice(0, 30).map(toOffer)
}

export async function getLayout(q: Queryable): Promise<HomeLayout> {
  const [row] = await q.query<{ value: HomeLayout | null }>(`SELECT value FROM app_settings WHERE key = 'homeLayout'`)
  const saved = row?.value?.sections ?? []
  // Every known section once, saved order first; new sections appear visible at the end.
  const sections = [
    ...saved.filter((s) => HOME_SECTIONS.includes(s.key)),
    ...HOME_SECTIONS.filter((k) => !saved.some((s) => s.key === k)).map((key) => ({ key, visible: true })),
  ]
  return { sections }
}

export async function setLayout(q: Queryable, layout: HomeLayout): Promise<HomeLayout> {
  const keys = layout.sections.map((s) => s.key)
  if (new Set(keys).size !== keys.length) throw validation('Each section once')
  await setSetting(q, 'homeLayout', layout)
  return getLayout(q)
}

export async function homeContent(q: Queryable, u: UserRow): Promise<HomeContent> {
  return { layout: await getLayout(q), offers: await offersFor(q, u, 'home') }
}

// ---------- portal ----------

const zText = (max: number) => z.object({ en: z.string().trim().min(1).max(max), st: z.string().trim().max(max) })
export const zOffer = z.object({
  title: zText(60),
  body: zText(160),
  cta: zText(30),
  image: z.string().regex(/^\/v1\/assets\/[\w-]+$/).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  target: z.string().max(300).nullable().refine(
    (t) => t === null || (OFFER_TARGETS as readonly string[]).includes(t) || /^service:[\w-]+$/.test(t) || /^url:https:\/\/\S+$/.test(t),
    'target: a screen, service:<id> or url:https://…',
  ),
  placement: z.enum(['home', 'news', 'both']),
  audience: z.enum(['all', 'customers', 'business', 'tier1', 'tier2']),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  sort: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
})

export async function listOffers(q: Queryable): Promise<Offer[]> {
  return (await q.query<OfferRow>('SELECT * FROM offers ORDER BY enabled DESC, sort, created_at DESC')).map(toOffer)
}

export async function saveOffer(q: Queryable, id: string | null, b: OfferBody): Promise<Offer> {
  if (b.endsAt && new Date(b.endsAt) <= new Date(b.startsAt)) throw validation('The end must be after the start')
  const v = [JSON.stringify(b.title), JSON.stringify(b.body), JSON.stringify(b.cta), b.image ?? null, b.color, b.target, b.placement, b.audience, b.startsAt, b.endsAt, b.sort, b.enabled]
  const [r] = id
    ? await q.query<OfferRow>(
        `UPDATE offers SET title=$2, body=$3, cta=$4, image=$5, color=$6, target=$7, placement=$8, audience=$9, starts_at=$10, ends_at=$11, sort=$12, enabled=$13
         WHERE id=$1 RETURNING *`,
        [id, ...v],
      )
    : await q.query<OfferRow>(
        `INSERT INTO offers (id, title, body, cta, image, color, target, placement, audience, starts_at, ends_at, sort, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [`offer-${newId().slice(0, 8)}`, ...v],
      )
  if (!r) throw notFound('Offer not found')
  return toOffer(r)
}

/** Sends an in-app message to everyone in the audience (their EcoCash Super App chat), and by SMS where they allow news by SMS. */
export async function broadcast(ctx: Ctx, adminEmail: string, body: { text: Broadcast['text']; audience: Audience; sms: boolean }): Promise<Broadcast> {
  const recipients = await ctx.db.query<{ id: string }>(`SELECT id FROM users WHERE kind = 'person' AND status = 'active' AND ${AUDIENCE_USERS[body.audience]}`)
  const text = body.text.st.trim() ? `${body.text.en}\n\n${body.text.st}` : body.text.en
  // In chunks, so a large audience doesn't hold one huge transaction.
  for (let i = 0; i < recipients.length; i += 200) {
    const chunk = recipients.slice(i, i + 200)
    await ctx.tx(async (q, out) => {
      for (const r of chunk) await postToInbox(q, out, r.id, text)
      if (body.sms) out.notify({ userIds: chunk.map((r) => r.id), category: 'news', title: 'EcoCash Super App', body: body.text.en, channels: ['sms'] })
    })
  }
  const id = newId()
  const [row] = await ctx.db.query<{ created_at: Date }>(
    'INSERT INTO broadcasts (id, text, audience, sms, recipients, sent_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at',
    [id, JSON.stringify(body.text), body.audience, body.sms, recipients.length, adminEmail],
  )
  return { id, text: body.text, audience: body.audience, sms: body.sms, recipients: recipients.length, sentBy: adminEmail, createdAt: iso(row.created_at) }
}

export async function listBroadcasts(q: Queryable): Promise<Broadcast[]> {
  const rows = await q.query<{ id: string; text: Broadcast['text']; audience: Audience; sms: boolean; recipients: number; sent_by: string; created_at: Date }>(
    'SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50',
  )
  return rows.map((r) => ({ id: r.id, text: r.text, audience: r.audience, sms: r.sms, recipients: r.recipients, sentBy: r.sent_by, createdAt: iso(r.created_at) }))
}
