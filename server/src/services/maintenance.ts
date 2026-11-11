import { getBranding, miniAppIconPaths } from './branding'
import { DEFAULT_DEVICE_SECURITY, type AppConfig, type AppConfigBody, type DeviceSecurity, type LocalizedText, type Maintenance, type MaintenanceStatus, type MaintenanceWindow } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { iso } from '../lib/time'
import { getUssdSettings } from './ussd'
import { getContactSettings } from './feedback'

export interface WindowRow {
  id: string
  starts_at: Date
  ends_at: Date
  message_en: string
  message_st: string
  cancelled: boolean
  created_by: string
  created_at: Date
}

export function windowStatus(w: WindowRow, now = new Date()): MaintenanceStatus {
  if (w.cancelled) return 'cancelled'
  if (new Date(w.ends_at) <= now) return 'ended'
  if (new Date(w.starts_at) <= now) return 'active'
  return 'scheduled'
}

export function toWindow(w: WindowRow): MaintenanceWindow {
  return {
    id: w.id,
    startsAt: iso(w.starts_at),
    endsAt: iso(w.ends_at),
    message: { en: w.message_en, st: w.message_st },
    status: windowStatus(w),
    createdBy: w.created_by,
    createdAt: iso(w.created_at),
  }
}

export function toMaintenance(w: WindowRow): Maintenance {
  return {
    id: w.id,
    startsAt: iso(w.starts_at),
    endsAt: iso(w.ends_at),
    message: { en: w.message_en, st: w.message_st },
    active: windowStatus(w) === 'active',
  }
}

/** The active window, else the next scheduled one starting within 7 days. */
export async function currentMaintenance(q: Queryable): Promise<Maintenance | null> {
  const [active] = await q.query<WindowRow>(
    `SELECT * FROM maintenance_windows WHERE NOT cancelled AND starts_at <= now() AND ends_at > now() ORDER BY starts_at LIMIT 1`,
  )
  if (active) return toMaintenance(active)
  const [next] = await q.query<WindowRow>(
    `SELECT * FROM maintenance_windows
     WHERE NOT cancelled AND starts_at > now() AND starts_at <= now() + interval '7 days' ORDER BY starts_at LIMIT 1`,
  )
  return next ? toMaintenance(next) : null
}

export async function activeMaintenance(q: Queryable): Promise<Maintenance | null> {
  const m = await currentMaintenance(q)
  return m?.active ? m : null
}

export async function getSetting<T>(q: Queryable, key: string): Promise<T | null> {
  const [row] = await q.query<{ value: T | null }>('SELECT value FROM app_settings WHERE key = $1', [key])
  return row?.value ?? null
}

export async function setSetting(q: Queryable, key: string, value: unknown) {
  await q.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  )
}

export async function appConfig(q: Queryable): Promise<AppConfig> {
  const minVersion = (await getSetting<AppConfigBody['minVersion']>(q, 'minVersion')) ?? { customer: null, business: null, ecosure: null, society: null }
  return {
    maintenance: await currentMaintenance(q),
    announcement: await getSetting<LocalizedText>(q, 'announcement'),
    minVersion: { customer: minVersion.customer ?? null, business: minVersion.business ?? null, ecosure: minVersion.ecosure ?? null, society: minVersion.society ?? null },
    serverTime: new Date().toISOString(),
    branding: { logo: (await getBranding(q)).logo?.path ?? null, miniAppIcons: await miniAppIconPaths(q) },
    deviceSecurity: await deviceSecurity(q),
    ussd: await getUssdSettings(q),
    contact: await getContactSettings(q),
  }
}

/** Phones the apps refuse to run on, as set in the portal (Settings › Device security). */
export async function deviceSecurity(q: Queryable): Promise<DeviceSecurity> {
  return { ...DEFAULT_DEVICE_SECURITY, ...((await getSetting<DeviceSecurity>(q, 'deviceSecurity')) ?? {}) }
}

/** Identity of what clients care about: which window is current and whether it is active. */
export const configSignature = (c: AppConfig) =>
  JSON.stringify([c.maintenance && { ...c.maintenance }, c.announcement, c.minVersion, c.branding, c.deviceSecurity, c.ussd])
