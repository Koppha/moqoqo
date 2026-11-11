import type { LocalizedText, MaintenanceBody, MaintenanceWindow } from '../../../shared/api'
import { maseruToIso, toMaseruParts } from '../time'

export const DEFAULT_MESSAGE: LocalizedText = {
  en: "EcoCash Super App is down for planned maintenance. You can't send or receive money until it's finished.",
  // Draft translation: must be reviewed by a Sesotho speaker before it is relied on.
  st: 'EcoCash Super App e emisitsoe nakoana bakeng sa tlhokomelo e reriloeng. U ke ke ua romela kapa ua amohela chelete ho fihlela e felile.',
}

export const MESSAGE_MAX = 280

export interface MaintenanceFormValues {
  startNow: boolean
  startDate: string // Maseru, YYYY-MM-DD
  startTime: string // Maseru, HH:mm
  endDate: string
  endTime: string
  en: string
  st: string
}

export type MaintenanceField = 'start' | 'end' | 'en' | 'st'
export type MaintenanceErrors = Partial<Record<MaintenanceField, string>>

export interface FormMode {
  /** Editing a window that has already started: the start is fixed. */
  lockedStart?: string
}

/** Defaults for a new window: next whole hour, lasting 2 hours. */
export function initialValues(now: Date): MaintenanceFormValues {
  const start = new Date(now.getTime())
  start.setUTCMinutes(0, 0, 0)
  start.setUTCHours(start.getUTCHours() + 1)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const s = toMaseruParts(start)
  const e = toMaseruParts(end)
  return { startNow: false, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, ...DEFAULT_MESSAGE }
}

export function valuesFromWindow(w: MaintenanceWindow): MaintenanceFormValues {
  const s = toMaseruParts(w.startsAt)
  const e = toMaseruParts(w.endsAt)
  return { startNow: false, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, en: w.message.en, st: w.message.st }
}

/** Grace for "start in the past": the admin may take a minute to fill the form in. */
const PAST_GRACE_MS = 2 * 60 * 1000

/**
 * Validates the form against `now`. Returns field errors, and the request body when valid.
 * Rules: both messages present; start = now when "Start now"; end after start; end in the future.
 */
export function validateMaintenance(
  v: MaintenanceFormValues,
  now: Date,
  mode: FormMode = {},
): { errors: MaintenanceErrors; body: MaintenanceBody | null } {
  const errors: MaintenanceErrors = {}
  const nowMs = now.getTime()

  let startsAt: string | null
  if (mode.lockedStart) startsAt = mode.lockedStart
  else if (v.startNow) startsAt = now.toISOString()
  else {
    startsAt = maseruToIso(v.startDate, v.startTime)
    if (!startsAt) errors.start = 'Enter a valid start date and time.'
    else if (Date.parse(startsAt) < nowMs - PAST_GRACE_MS)
      errors.start = 'The start time is in the past. Choose a later time, or tick "Start now".'
  }

  const endsAt = maseruToIso(v.endDate, v.endTime)
  if (!endsAt) errors.end = 'Enter a valid end date and time.'
  else if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) errors.end = 'The end must be after the start.'
  else if (Date.parse(endsAt) <= nowMs) errors.end = 'The end must be in the future.'

  const en = v.en.trim()
  const st = v.st.trim()
  if (!en) errors.en = 'Enter the English message.'
  else if (en.length > MESSAGE_MAX) errors.en = `Keep the message under ${MESSAGE_MAX} characters.`
  if (!st) errors.st = 'Enter the Sesotho message.'
  else if (st.length > MESSAGE_MAX) errors.st = `Keep the message under ${MESSAGE_MAX} characters.`

  if (Object.keys(errors).length > 0 || !startsAt || !endsAt) return { errors, body: null }
  return { errors, body: { startsAt, endsAt, message: { en, st } } }
}
