import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'

/**
 * Me › Icons: how service and transaction icons look.
 *   classic — the white symbol in a coloured circle (the original)
 *   colour  — the symbol in its colour, no circle
 *   minimal — a grey outline, like the menu bar, filled in its colour while pressed
 * And a size: small, medium (the original) or large. Both apply at once (nothing is baked into styles), and are kept
 * on the phone.
 */
export type IconStyle = 'classic' | 'colour' | 'minimal'
export const ICON_STYLES: IconStyle[] = ['classic', 'colour', 'minimal']
const KEY = 'icon_style_v1'

function read(): IconStyle {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : SecureStore.getItem(KEY)
    return v === 'classic' || v === 'minimal' ? v : 'colour'
  } catch {
    return 'colour'
  }
}

let current: IconStyle = read()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function setIconStyle(style: IconStyle) {
  current = style
  listeners.forEach((l) => l())
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, style)
    else SecureStore.setItemAsync(KEY, style).catch(() => {})
  } catch {
    // Not kept: applies until the app restarts.
  }
}

export function useIconStyle(): IconStyle {
  return useSyncExternalStore(subscribe, () => current)
}

export type IconSize = 'small' | 'medium' | 'large'
export const ICON_SIZES: IconSize[] = ['small', 'medium', 'large']
const SCALE: Record<IconSize, number> = { small: 0.84, medium: 1, large: 1.2 }
const SIZE_KEY = 'icon_size_v1'

function readSize(): IconSize {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(SIZE_KEY) : SecureStore.getItem(SIZE_KEY)
    return v === 'small' || v === 'large' ? v : 'medium'
  } catch {
    return 'medium'
  }
}

let currentSize: IconSize = readSize()

export function setIconSize(size: IconSize) {
  currentSize = size
  listeners.forEach((l) => l())
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(SIZE_KEY, size)
    else SecureStore.setItemAsync(SIZE_KEY, size).catch(() => {})
  } catch {
    // Not kept: applies until the app restarts.
  }
}

export function useIconSize(): IconSize {
  return useSyncExternalStore(subscribe, () => currentSize)
}

/** Multiplies icon sizes (service tiles, transaction rows) by the chosen size. */
export function useIconScale(): number {
  return SCALE[useIconSize()]
}
