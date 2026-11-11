import { LinearGradient } from 'expo-linear-gradient'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useT } from '../i18n'
import { markSplashLeaving } from '../lib/splash'
import { APP } from '../lib/variant'

/** After the opening has played, the finished splash stays this long at least, so it never flickers. */
const HOLD_MS = 450
/** The splash never waits longer than this for its opening (a very busy start-up). */
const MAX_WAIT_MS = 4000

const BLUE = '#2E3A8C'
const RED = '#E2231A'
const GRADIENT = ['#1B2370', '#2E3A8C', '#5B2C9F', '#7A1F7A'] as const
const DOTS = ['#FFFFFF', '#FFB4AE', '#FFFFFF']

const value = (v: number) => () => new Animated.Value(v)

/**
 * EcoCash Super App's splash. It opens exactly like the native splash (the logo on white, so the hand-over is
 * invisible), then a brand-gradient circle bursts out from the logo and fills the screen, the logo pops onto a white
 * card with pulsing glow rings and a light sweep, and the name rises in. Once `ready` it zooms slightly and fades.
 * With "reduce motion" on, it skips the movement and just fades.
 */
export function BrandSplash({ ready }: { ready: boolean }) {
  const t = useT()
  const { width, height } = useWindowDimensions()
  const [gone, setGone] = useState(false)
  const [shownAt] = useState(() => Date.now())
  const [reduce, setReduce] = useState(false)
  // The opening has played (or was skipped): only then may the splash leave.
  const [opened, setOpened] = useState(false)
  const [burst] = useState(value(0))
  const [card] = useState(value(0))
  const [sweep] = useState(value(0))
  const [title] = useState(value(0))
  const [rings] = useState(() => [new Animated.Value(0), new Animated.Value(0)])
  const [dots] = useState(() => DOTS.map(() => new Animated.Value(0)))
  const [exit] = useState(value(0))

  // The circle must cover the screen from its centre: the diagonal.
  const diameter = Math.hypot(width, height) * 1.05

  useEffect(() => {
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((r) => !cancelled && setReduce(r), () => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (reduce) {
      for (const v of [burst, card, title]) v.setValue(1)
      const done = setTimeout(() => setOpened(true), 0)
      return () => clearTimeout(done)
    }
    const loops: Animated.CompositeAnimation[] = []
    Animated.sequence([
      Animated.timing(burst, { toValue: 1, duration: 650, delay: 120, easing: Easing.bezier(0.7, 0, 0.2, 1), useNativeDriver: true }),
      Animated.parallel([
        Animated.spring(card, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
        Animated.timing(title, { toValue: 1, duration: 520, delay: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start(({ finished }) => {
      setOpened(true)
      if (!finished) return
      // The glow rings, the light sweep and the loading dots keep going until the app is ready.
      rings.forEach((r, i) => {
        const loop = Animated.loop(Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(r, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]))
        loops.push(loop)
        loop.start()
      })
      const shine = Animated.loop(Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(1100),
      ]))
      loops.push(shine)
      shine.start()
      dots.forEach((d, i) => {
        const bounce = Animated.loop(Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(d, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((DOTS.length - 1 - i) * 140 + 200),
        ]))
        loops.push(bounce)
        bounce.start()
      })
    })
    return () => loops.forEach((l) => l.stop())
  }, [reduce, burst, card, title, rings, sweep, dots])

  useEffect(() => {
    if (!ready) return
    // Leave once the opening has played, or after MAX_WAIT_MS whatever happens.
    const wait = opened ? HOLD_MS : Math.max(0, MAX_WAIT_MS - (Date.now() - shownAt))
    const timer = setTimeout(() => {
      // The lock screen (if any) fades in over the splash first; then the splash leaves from underneath it.
      markSplashLeaving()
      Animated.timing(exit, { toValue: 1, duration: 380, delay: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setGone(true))
    }, wait)
    return () => clearTimeout(timer)
  }, [ready, opened, exit, shownAt])

  if (gone) return null

  const cardScale = card.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] })
  // Before the burst the logo sits bare on white, as on the native splash; the card fades in under it.
  const cardBg = card.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })
  const rise = title.interpolate({ inputRange: [0, 1], outputRange: [18, 0] })
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, s.root, {
        opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
      }]}
      pointerEvents={ready ? 'none' : 'auto'} onLayout={() => SplashScreen.hide()} accessibilityLabel="EcoCash Super App">
      {/* The brand gradient bursting out of the logo. */}
      <Animated.View pointerEvents="none" style={[s.burst, {
        width: diameter, height: diameter, borderRadius: diameter / 2, left: (width - diameter) / 2, top: (height - diameter) / 2,
        transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] }) }],
      }]}>
        <LinearGradient colors={GRADIENT} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[s.glow, { top: diameter * 0.12, right: diameter * 0.02 }]} />
      </Animated.View>

      <View style={s.center}>
        {rings.map((r, i) => (
          <Animated.View key={i} pointerEvents="none" style={[s.ring, {
            // Wide but short of the name below, and gone before they reach it.
            opacity: r.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 0.6, 0.12, 0] }),
            transform: [{ scaleX: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }, { scaleY: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
          }]} />
        ))}
        <Animated.View style={[s.card, { transform: [{ scale: cardScale }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, s.cardBg, { opacity: cardBg }]} />
          <Image source={require('../../assets/ecocash-logo.webp')} style={s.logo} resizeMode="contain" />
          <Animated.View pointerEvents="none" style={[s.sweep, {
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-160, 260] }) }, { rotate: '18deg' }],
          }]} />
        </Animated.View>

        <Animated.View style={[s.title, { opacity: title, transform: [{ translateY: rise }] }]}>
          <Text style={s.name}>EcoCash <Text style={s.super}>{APP === 'society' ? 'Mekhatlo' : 'Super App'}</Text></Text>
          <Text style={s.tagline}>{t.splash.tagline}</Text>
        </Animated.View>
      </View>

      <Animated.View style={[s.foot, { opacity: title }]}>
        <View style={s.dots}>
          {dots.map((d, i) => (
            <Animated.View key={i} style={[s.dot, { backgroundColor: DOTS[i], transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }]} />
          ))}
        </View>
        <Text style={s.by}>{t.splash.by}</Text>
      </Animated.View>
    </Animated.View>
  )
}

const s = StyleSheet.create({
  root: { backgroundColor: '#FFFFFF', zIndex: 1000, elevation: 1000, overflow: 'hidden' },
  burst: { position: 'absolute', overflow: 'hidden', backgroundColor: BLUE },
  // A soft red light in one corner of the gradient: EcoCash's red without a hard edge.
  glow: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: RED, opacity: 0.16 },
  // The card is centred on the screen, where the native splash draws the logo; the name sits just below it.
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { position: 'absolute', top: '50%', marginTop: 101, left: 0, right: 0, alignItems: 'center' },
  ring: { position: 'absolute', width: 196, height: 150, borderRadius: 34, borderWidth: 2, borderColor: '#FFFFFF' },
  // The native splash draws the logo about 140 dp wide; this file has a white margin around it, so 157 dp matches.
  card: { width: 196, height: 150, borderRadius: 34, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardBg: { backgroundColor: '#FFFFFF', borderRadius: 34, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 18 },
  logo: { width: 157, height: 108 },
  sweep: { position: 'absolute', top: -40, bottom: -40, width: 46, backgroundColor: 'rgba(255,255,255,0.55)' },
  name: { fontSize: 30, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.2 },
  super: { color: '#FFD3CF' },
  tagline: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginTop: 6, letterSpacing: 0.3 },
  foot: { position: 'absolute', bottom: 56, left: 0, right: 0, alignItems: 'center', gap: 14 },
  dots: { flexDirection: 'row', gap: 8, height: 16, alignItems: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  by: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
})
