import { useSyncExternalStore } from 'react'
import { displayHandoff } from '../theme'
import { APP } from './variant'

// The animated splash (BrandSplash) covers the app on launch. The lock screen waits for it to start leaving, then
// fades in over it, so the PIN screen never hides the splash and the app underneath is never shown in between.
// The EcoSure app has no animated splash, and none plays when the app comes back from a display change.
let leaving = APP === 'ecosure' || displayHandoff !== null
const listeners = new Set<() => void>()

export function markSplashLeaving() {
  if (leaving) return
  leaving = true
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** True once the splash has started to leave (and from then on). */
export function useSplashLeaving() {
  return useSyncExternalStore(subscribe, () => leaving)
}
