import { useFocusEffect } from 'expo-router'
import { setStatusBarStyle } from 'expo-status-bar'
import { useCallback, useEffect } from 'react'
import { isDark } from '../theme'

// What the focused screen wants, and how many light overlays (the lock screen) are on top of it. An overlay wins
// whichever mounted first: on a cold start the lock screen can appear before the screen under it is focused.
// Dark icons on the light theme, light icons on the dark one.
const normal: 'light' | 'dark' = isDark ? 'light' : 'dark'
let screen = normal
let overlays = 0
const apply = () => setStatusBarStyle(overlays ? normal : screen)

/** White status bar icons while a dark screen is focused; back to dark on blur. Pass false when the dark area isn't behind the status bar. */
export function useLightStatusBar(enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return
      screen = 'light'
      apply()
      return () => {
        screen = normal
        apply()
      }
    }, [enabled]),
  )
}

/** Dark status bar icons while an overlay on a light background is showing (the lock screen), then back to the screen's own. */
export function useDarkStatusBarWhileMounted() {
  useEffect(() => {
    overlays++
    apply()
    return () => {
      overlays--
      apply()
    }
  }, [])
}
