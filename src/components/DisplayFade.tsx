import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'
import { colors, displayHandoff, setDisplayFader } from '../theme'

const FADE_MS = 240

/**
 * Makes changing Me › Display seamless. Before the reload it fades the screen to the new background; after it, the
 * app starts under that same colour, goes back to the screen the person was on, and fades the colour away.
 */
export function DisplayFade({ ready }: { ready: boolean }) {
  const [bg, setBg] = useState(displayHandoff ? colors.bg : '#000')
  const [opacity] = useState(() => new Animated.Value(displayHandoff ? 1 : 0))
  const [covering, setCovering] = useState(displayHandoff !== null)

  // Going: fade to the new colours' background, then let setDisplayMode reload.
  useEffect(() => {
    setDisplayFader((next) => new Promise<void>((resolve) => {
      setBg(next)
      setCovering(true)
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => resolve())
    }))
    return () => setDisplayFader(null)
  }, [opacity])

  // Back: once the app is ready, return to the same screen and fade in.
  useEffect(() => {
    if (!displayHandoff || !ready) return
    const back = setTimeout(() => {
      if (displayHandoff!.path !== '/') router.replace(displayHandoff!.path as never)
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS + 60, delay: 120, easing: Easing.in(Easing.quad), useNativeDriver: true })
        .start(() => setCovering(false))
    }, 0)
    return () => clearTimeout(back)
  }, [ready, opacity])

  if (!covering) return null
  return <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity, zIndex: 2000, elevation: 2000 }]} />
}
