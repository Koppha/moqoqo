// USSD fallback when the apps have no internet. Contract: shared/api.ts "USSD fallback".
import { USSD_CODE_PATTERN, USSD_DEFAULTS, USSD_FUNCTIONS, USSD_SHORTCUT_PATTERN, type UssdSettings } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { validation } from '../errors'
import { getSetting, setSetting } from './maintenance'

/** The portal's settings over the defaults, so a function added later still has its steps. */
export async function getUssdSettings(q: Queryable): Promise<UssdSettings> {
  const saved = await getSetting<Partial<UssdSettings>>(q, 'ussd')
  const functions = { ...USSD_DEFAULTS.functions }
  for (const fn of USSD_FUNCTIONS) {
    const s = saved?.functions?.[fn]
    if (s) functions[fn] = { ...functions[fn], ...s, steps: { ...functions[fn].steps, ...s.steps } }
  }
  return {
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : USSD_DEFAULTS.enabled,
    code: saved?.code || USSD_DEFAULTS.code,
    functions,
  }
}

export async function setUssdSettings(q: Queryable, s: UssdSettings): Promise<UssdSettings> {
  const code = s.code.replace(/\s/g, '')
  if (!USSD_CODE_PATTERN.test(code)) throw validation('The USSD code looks like *199#')
  const functions = { ...USSD_DEFAULTS.functions }
  for (const fn of USSD_FUNCTIONS) {
    const f = s.functions[fn]
    if (!f) continue
    const shortcut = f.shortcut.replace(/\s/g, '')
    // The PIN is never part of a dial string: it would be kept in the phone's call log.
    if (/pin/i.test(shortcut)) throw validation(`${fn}: a shortcut never carries the PIN; the person types it in the menu`)
    if (shortcut && !USSD_SHORTCUT_PATTERN.test(shortcut)) {
      throw validation(`${fn}: a shortcut starts with *, ends with #, and has only digits, * and {number} {amount} {meter} {code}`)
    }
    if (!f.steps.en.trim() || !f.steps.st.trim()) throw validation(`${fn}: write the menu steps in English and Sesotho`)
    functions[fn] = { enabled: f.enabled, shortcut, steps: { en: f.steps.en.trim(), st: f.steps.st.trim() } }
  }
  const next: UssdSettings = { enabled: s.enabled, code, functions }
  await setSetting(q, 'ussd', next)
  return next
}
