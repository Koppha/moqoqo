// Me › Leave feedback, Contact us and Share the app. Contract: shared/api.ts "Feedback, Contact us, Share the app".
import { CONTACT_DEFAULTS, type AppKind, type ContactSettings, type Feedback, type FeedbackBody } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { validation } from '../errors'
import { newId } from '../lib/crypto'
import { iso } from '../lib/time'
import { getSetting, setSetting } from './maintenance'

export async function leaveFeedback(q: Queryable, userId: string, body: FeedbackBody): Promise<void> {
  await q.query('INSERT INTO feedback (id, user_id, rating, text, app, app_version) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId(), userId, body.rating, body.text?.trim() || null, body.app, body.appVersion ?? null,
  ])
}

export async function listFeedback(q: Queryable, limit = 500): Promise<Feedback[]> {
  const rows = await q.query<{ id: string; rating: number; text: string | null; app: AppKind; app_version: string | null; created_at: Date; user_id: string; name: string; msisdn: string | null }>(
    'SELECT f.*, u.name, u.msisdn FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT $1',
    [limit],
  )
  return rows.map((r) => ({
    id: r.id, rating: r.rating, text: r.text, app: r.app, appVersion: r.app_version,
    user: { id: r.user_id, name: r.name, msisdn: r.msisdn ?? '' }, createdAt: iso(r.created_at),
  }))
}

/** The portal's contact details over the placeholders. */
export async function getContactSettings(q: Queryable): Promise<ContactSettings> {
  return { ...CONTACT_DEFAULTS, ...(await getSetting<Partial<ContactSettings>>(q, 'contact')) }
}

export async function setContactSettings(q: Queryable, s: ContactSettings): Promise<ContactSettings> {
  const t = (v: string) => v.trim()
  const next: ContactSettings = { phone: t(s.phone), whatsapp: t(s.whatsapp).replace(/\s/g, ''), email: t(s.email), website: t(s.website), shareLink: t(s.shareLink) }
  if (!/^\+?[\d ]{3,20}$/.test(next.phone)) throw validation('The call centre number has only digits (and a leading +)')
  if (next.whatsapp && !/^\+\d{8,15}$/.test(next.whatsapp)) throw validation('The WhatsApp number is in international form, like +26662000000')
  if (next.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email)) throw validation('The email address does not look right')
  for (const [label, url] of [['website', next.website], ['share link', next.shareLink]] as const) {
    if (url && !/^https?:\/\/\S+$/.test(url)) throw validation(`The ${label} starts with https://`)
  }
  await setSetting(q, 'contact', next)
  return next
}
