import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'

/**
 * Floating mini apps (like WeChat's floating windows): with Me › Floating mini apps on, long-press a mini app to keep it
 * in a bubble on the edge of the screen, and jump back to it from anywhere. Up to MAX_FLOATING; kept on the phone with
 * where the bubble was left.
 */
export const MAX_FLOATING = 5
const KEY = 'floating_v1'

export interface FloatingState {
  enabled: boolean
  /** Mini app ids (MINI_APPS), oldest first. */
  ids: string[]
  /** Which edge the bubble sits on, and how far down (0 top – 1 bottom). */
  side: 'left' | 'right'
  y: number
}

const DEFAULT: FloatingState = { enabled: false, ids: [], side: 'right', y: 0.62 }

function read(): FloatingState {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : SecureStore.getItem(KEY)
    return v ? { ...DEFAULT, ...(JSON.parse(v) as Partial<FloatingState>) } : DEFAULT
  } catch {
    return DEFAULT
  }
}

let current: FloatingState = read()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function save(next: FloatingState) {
  current = next
  listeners.forEach((l) => l())
  try {
    const v = JSON.stringify(next)
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, v)
    else SecureStore.setItemAsync(KEY, v).catch(() => {})
  } catch {
    // Not kept: applies until the app restarts.
  }
}

export const useFloating = (): FloatingState => useSyncExternalStore(subscribe, () => current)

export const setFloatingEnabled = (enabled: boolean) => save({ ...current, enabled })

/** Floats a mini app, or takes it off when it already floats. 'full' when MAX_FLOATING already float. */
export function toggleFloating(id: string): 'added' | 'removed' | 'full' {
  if (current.ids.includes(id)) {
    save({ ...current, ids: current.ids.filter((x) => x !== id) })
    return 'removed'
  }
  if (current.ids.length >= MAX_FLOATING) return 'full'
  save({ ...current, ids: [...current.ids, id] })
  return 'added'
}

export const removeFloating = (id: string) => save({ ...current, ids: current.ids.filter((x) => x !== id) })

export const setFloatingSpot = (side: 'left' | 'right', y: number) => save({ ...current, side, y: Math.min(0.9, Math.max(0.1, y)) })
