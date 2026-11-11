// What the society mini app is called on this phone: "Society" in English and "Mekhatlo" in Sesotho by default,
// or the name the person chose, whatever the language. Kept on this phone.
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'

export type SocietyNamePref = 'auto' | 'society' | 'mekhatlo'
export const SOCIETY_NAMES = { society: 'Society', mekhatlo: 'Mekhatlo' } as const

const KEY = 'society_name_v1'
let pref: SocietyNamePref = 'auto'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

try {
  const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : SecureStore.getItem(KEY)
  if (v === 'society' || v === 'mekhatlo') pref = v
} catch {
  // Unreadable: the language decides.
}

export function setSocietyNamePref(next: SocietyNamePref) {
  pref = next
  emit()
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, next)
    else SecureStore.setItemAsync(KEY, next).catch(() => {})
  } catch {
    // Not saved: back to the language's name next time.
  }
}

export function useSocietyNamePref(): SocietyNamePref {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => pref,
  )
}
