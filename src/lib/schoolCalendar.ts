import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { upcomingDueDates, type Term } from '../data/schools'

// School fees in the phone's own calendar: one all-day event per term on its due date, with a reminder three days
// before. expo-calendar's object API (SDK 57): the old *Async functions throw at runtime. Loaded only when used, so a
// build without the native module never crashes.

const KEY = 'moqoqo.school.calendar'
/** Reminder three days before the due date, at the start of that all-day event. */
const REMIND_MINUTES_BEFORE = 3 * 24 * 60

export type CalendarResult = { added: number; skipped: number } | 'denied' | 'no_calendar' | 'unavailable'

/** Event ids already added, by "<learner>|<yyyy-mm-dd>", so a second tap doesn't add them again. */
async function added(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(KEY)) ?? '{}')
  } catch {
    return {}
  }
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Adds the next fee due date of every term for a learner. `learner` names them in the event ("Fees: Lerato · Lesotho
 * High School"); `reference` is what to pay with, so the event says it.
 */
export async function addFeeDates(learner: string, school: string, reference: string, termLabel: (t: Term) => string): Promise<CalendarResult> {
  let Calendar: typeof import('expo-calendar')
  try {
    Calendar = await import('expo-calendar')
  } catch {
    return 'unavailable'
  }
  try {
    // iOS: write-only access is enough to add events (and asks less of people).
    const permission = await Calendar.requestCalendarPermissions(Platform.OS === 'ios')
    if (!permission.granted) return 'denied'
    const calendar = Platform.OS === 'ios' ? Calendar.getDefaultCalendarSync() : await androidCalendar(Calendar)
    if (!calendar) return 'no_calendar'

    const done = await added()
    let count = 0
    let skipped = 0
    for (const { term, date } of upcomingDueDates()) {
      const key = `${learner.toLowerCase()}|${day(date)}`
      if (done[key]) {
        skipped++
        continue
      }
      const end = new Date(date)
      end.setDate(end.getDate() + 1)
      const event = await calendar.createEvent({
        title: `School fees: ${learner} · ${school}`,
        startDate: date,
        endDate: end,
        allDay: true,
        notes: `${termLabel(term)}\nPay in EcoCash Super App › School fees, or ask family to pay with Ntefelle.\nReference: ${reference}\nCheck the amount and date on your school's letter.`,
        alarms: [{ relativeOffset: -REMIND_MINUTES_BEFORE }],
      })
      done[key] = event.id
      count++
    }
    // Only the newest few: SecureStore keeps values small.
    const kept = Object.fromEntries(Object.entries(done).slice(-30))
    await SecureStore.setItemAsync(KEY, JSON.stringify(kept))
    return { added: count, skipped }
  } catch {
    return 'unavailable'
  }
}

/**
 * Android has no single default calendar: the primary calendar of a synced account the app may write to, else any
 * visible writable one.
 */
async function androidCalendar(Calendar: typeof import('expo-calendar')) {
  const all = (await Calendar.getCalendars()).filter((c) => c.allowsModifications)
  return all.find((c) => c.isPrimary && c.isVisible !== false) ?? all.find((c) => c.isVisible !== false) ?? all[0] ?? null
}
