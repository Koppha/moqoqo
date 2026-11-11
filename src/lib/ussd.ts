import { File, Paths } from 'expo-file-system'
import * as Linking from 'expo-linking'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { USSD_DEFAULTS, type UssdSettings } from '../../shared/api'
import { useAppState } from '../state/AppState'

// The USSD fallback works with no internet, so the portal's settings (AppConfig.ussd) are kept on the phone each time
// they arrive; before the first one, the built-in defaults (*199#) apply.
const file = () => new File(Paths.document, 'ussd.json')
let saved: UssdSettings | null = null
let loaded = false

async function load() {
  if (loaded) return saved
  loaded = true
  try {
    const f = file()
    if (f.exists) saved = JSON.parse(await f.text()) as UssdSettings
  } catch {
    // Unreadable: the defaults will do until the next config.
  }
  return saved
}

function keep(s: UssdSettings) {
  if (saved && JSON.stringify(saved) === JSON.stringify(s)) return
  saved = s
  try {
    file().write(JSON.stringify(s))
  } catch {
    // Not kept this time; the next config tries again.
  }
}

/** The USSD settings: live from the server when online, else the last ones kept, else the defaults. */
export function useUssd(): UssdSettings {
  const { state } = useAppState()
  const live = state.config?.ussd
  const [kept, setKept] = useState<UssdSettings | null>(saved)
  useEffect(() => {
    if (live) keep(live)
    else load().then((s) => s && setKept(s), () => {})
  }, [live])
  return live ?? kept ?? USSD_DEFAULTS
}

/**
 * No internet for a few seconds. The app starts "offline" until its connection opens, so a short wait keeps the
 * USSD option from flashing on every launch.
 */
export function useOffline(afterMs = 4000): boolean {
  const since = useAppState().state.offlineSince
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    // Re-render once the wait is over.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, since + afterMs - Date.now()))
    return () => clearTimeout(timer)
  }, [since, afterMs])
  return since !== null && now - since >= afterMs
}

/** Android opens the dialer with the code filled in. iPhones can't start USSD from an app (false: show the code). */
export const canDialUssd = Platform.OS === 'android'
export function dialUssd(dial: string) {
  if (!canDialUssd) return Promise.resolve(false)
  return Linking.openURL(`tel:${encodeURIComponent(dial)}`).then(() => true, () => false)
}
