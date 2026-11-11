// Whether this phone has seen the EcoCash Super App introduction (shown once, before the first sign-in).
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'

const KEY = 'onboarding_seen_v1'
/** null until read from storage. */
let seen: boolean | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

async function read(): Promise<boolean> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) === '1'
  return (await SecureStore.getItemAsync(KEY)) === '1'
}

// Start reading at once, so the answer is usually ready by the time the splash hides.
read()
  .then((v) => { seen = v })
  .catch(() => { seen = false })
  .finally(emit)

export async function markOnboardingSeen() {
  seen = true
  emit()
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, '1')
    else await SecureStore.setItemAsync(KEY, '1')
  } catch {
    // Not saved: the introduction shows again next time, which is harmless.
  }
}

export function useOnboardingSeen(): boolean | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => seen,
  )
}
