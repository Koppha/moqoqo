import * as ScreenOrientation from 'expo-screen-orientation'
import { useEffect } from 'react'
import { Dimensions, Platform, useWindowDimensions } from 'react-native'

/** Shortest side at which Android/iOS treat a device as a tablet. */
const TABLET_DP = 600
/** Window width at which the tab bar becomes a side rail and Home splits into two columns. */
const WIDE_DP = 900

/** Readable width for single-column screens (lists, chat, settings). */
export const CONTENT_MAX = 720
/** Width for forms and keypads (login, PIN, amount entry, sheets). */
export const FORM_MAX = 480

export function useLayout() {
  const { width, height } = useWindowDimensions()
  return { width, height, tablet: Math.min(width, height) >= TABLET_DP, wide: width >= WIDE_DP }
}

/**
 * Phones stay in portrait (keypads and the taxi screen are designed for it); tablets rotate freely.
 * Uses the physical screen, not the window, so split-screen on a tablet doesn't count as a phone.
 */
export function useOrientationPolicy() {
  useEffect(() => {
    if (Platform.OS === 'web') return
    const { width, height } = Dimensions.get('screen')
    const lock = Math.min(width, height) >= TABLET_DP
      ? ScreenOrientation.OrientationLock.DEFAULT
      : ScreenOrientation.OrientationLock.PORTRAIT_UP
    ScreenOrientation.lockAsync(lock).catch(() => {})
  }, [])
}
