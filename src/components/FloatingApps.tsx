import { usePathname } from 'expo-router'
import { useState } from 'react'
import { Animated, Dimensions, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { removeFloating, setFloatingSpot, useFloating } from '../lib/floating'
import { MINI_APPS, type MiniApp } from '../miniapps/registry'
import { colors, radius, shadow } from '../theme'
import { MiniAppIcon } from './MiniAppIcon'
import { useOpenMiniApp } from './MiniApps'
import { AppIcon, Icon } from './ui'

const BUBBLE = 56
const ICON = 30

/**
 * The floating mini apps bubble (Me › Floating mini apps): sits on a screen edge over every screen, drags anywhere and
 * snaps back to the nearest edge. A tap opens the list of floating apps: open one, or take it off.
 */
export function FloatingApps() {
  const t = useT()
  const { enabled, ids, side, y } = useFloating()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const openApp = useOpenMiniApp()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const apps = ids.map((id) => MINI_APPS.find((a) => a.id === id)).filter((a): a is MiniApp => !!a?.href)

  // Where the bubble may sit: below the header, above the menu bar (also worked out again when a drag ends).
  const edges = (w: number, h: number) => ({ w, top: insets.top + 60, range: h - insets.bottom - 200 - insets.top })
  const { top, range } = edges(width, height)

  // Where the bubble rests (a drag starts from here) and its animated position, made once.
  const [spot] = useState(() => ({ x: side === 'left' ? 6 : width - BUBBLE - 6, y: top + y * range }))
  const [pos] = useState(() => new Animated.ValueXY(spot))
  const [pan] = useState(() => {
    let moved = false
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        moved = false
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 6) moved = true
        pos.setValue({ x: spot.x + g.dx, y: spot.y + g.dy })
      },
      onPanResponderRelease: (_e, g) => {
        if (!moved) {
          setOpen((o) => !o)
          return
        }
        // Snap to the nearer edge, kept between the header and the menu bar.
        const win = Dimensions.get('window')
        const { w, top: t0, range: r } = edges(win.width, win.height)
        const side: 'left' | 'right' = spot.x + g.dx + BUBBLE / 2 < w / 2 ? 'left' : 'right'
        spot.x = side === 'left' ? 6 : w - BUBBLE - 6
        spot.y = Math.min(t0 + r, Math.max(t0, spot.y + g.dy))
        Animated.spring(pos, { toValue: { x: spot.x, y: spot.y }, useNativeDriver: false, friction: 7 }).start()
        setFloatingSpot(side, r > 0 ? (spot.y - t0) / r : 0.5)
      },
    })
  })

  if (!enabled || apps.length === 0 || pathname === '/login' || pathname === '/onboarding') return null

  const go = (app: MiniApp) => {
    setOpen(false)
    openApp(app)
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {open && <Pressable style={s.scrim} onPress={() => setOpen(false)} accessibilityLabel={t.common.close} />}
      {open && (
        <View style={[s.panel, { top: top, [side]: 12 }]}>
          <Text style={s.panelTitle}>{t.floating.title}</Text>
          {apps.map((app) => (
            <View key={app.id} style={s.row}>
              <Pressable accessibilityRole="button" onPress={() => go(app)} style={s.rowMain}>
                <MiniAppIcon id={app.id} size={36} fallback={<AppIcon icon={app.icon} color={app.color} size={36} />} />
                <Text style={s.rowName} numberOfLines={1}>{t.services.items[app.id]}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t.floating.remove(t.services.items[app.id])} onPress={() => removeFloating(app.id)} hitSlop={8} style={s.close}>
                <Icon name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          <Text style={s.panelHint}>{t.floating.hint}</Text>
        </View>
      )}
      <Animated.View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={t.floating.title}
        style={[s.bubble, { transform: pos.getTranslateTransform() }]}>
        {/* The first three apps fanned out, like WeChat's floating windows. */}
        {apps.slice(0, 3).map((app, i, arr) => (
          <View key={app.id} style={[s.icon, { left: (BUBBLE - ICON) / 2 + (i - (arr.length - 1) / 2) * 9, top: (BUBBLE - ICON) / 2 + (i - (arr.length - 1) / 2) * 4, zIndex: 3 - i }]}>
            <MiniAppIcon id={app.id} size={ICON} fallback={<AppIcon icon={app.icon} color={app.color} size={ICON} />} />
          </View>
        ))}
        {apps.length > 3 && <Text style={s.count}>{apps.length}</Text>}
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' },
  bubble: { position: 'absolute', left: 0, top: 0, width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow, elevation: 10 },
  icon: { position: 'absolute', width: ICON, height: ICON, borderRadius: ICON / 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  count: { position: 'absolute', right: -4, top: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 20, overflow: 'hidden' },
  panel: { position: 'absolute', width: 260, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, ...shadow, elevation: 12 },
  panelTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 6 },
  panelHint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
