// Recently opened mini apps and portal services, newest first, kept on this phone (pull down on Home to see them).
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'

export type Recent = { kind: 'app'; id: string } | { kind: 'service'; id: string }

const KEY = 'recent_apps_v1'
const MAX = 8
let recents: Recent[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

async function read(): Promise<Recent[]> {
  const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY)
  const list = raw ? JSON.parse(raw) : []
  return Array.isArray(list) ? list.filter((x) => (x?.kind === 'app' || x?.kind === 'service') && typeof x.id === 'string') : []
}

read()
  .then((v) => { recents = v })
  .catch(() => { recents = [] })
  .finally(emit)

/** Puts this app or service first. Saving is best effort: losing the list only empties the panel. */
export function rememberRecent(r: Recent) {
  recents = [r, ...recents.filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, MAX)
  emit()
  const value = JSON.stringify(recents)
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, value)
    else SecureStore.setItemAsync(KEY, value).catch(() => {})
  } catch {
    // Not saved; see above.
  }
}

export function useRecents(): Recent[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => recents,
  )
}
