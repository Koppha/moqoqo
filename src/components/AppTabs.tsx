import type { Href } from 'expo-router'
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from './ui'
import { useLayout } from '../lib/layout'
import { colors, shadow } from '../theme'

/** One look of the centre button: its symbol and the word under it. */
export interface CycleStep { icon: IconName; label: string }
type TabButtonProps = TabTriggerSlotProps & { icon: IconName; label: string; center?: boolean; rail?: boolean; cycle?: CycleStep[] }

/** How long the centre button keeps one look before changing. */
const CYCLE_MS = 5 * 60_000

/** "wifi" turned on its side is the contactless sign; other symbols stand upright. */
const turnFor = (name: IconName) => (name === 'wifi' ? '90deg' : '0deg')

/**
 * The centre button's look: changes every 5 minutes (to a random other step), symbol and word
 * together, fading and popping between them. Stays put with "reduce motion" on.
 */
function useCycle(steps: CycleStep[] | undefined) {
  const [index, setIndex] = useState(0)
  const [anim] = useState(() => new Animated.Value(1))
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((r) => alive && setReduce(r), () => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (reduce || !steps || steps.length < 2) return
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
          setIndex((i) => {
            const others = steps.map((_, k) => k).filter((k) => k !== i)
            return others[Math.floor(Math.random() * others.length)]
          })
          Animated.spring(anim, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start()
          next()
        })
      }, CYCLE_MS)
    }
    next()
    return () => clearTimeout(timer)
  }, [reduce, steps, anim])
  return { step: steps?.[index], anim }
}

function TabButton({ icon, label, center, rail, cycle, isFocused, ...props }: TabButtonProps) {
  const color = isFocused ? colors.primary : colors.muted
  const { step, anim } = useCycle(cycle)
  const shownIcon = step?.icon ?? icon
  const shownLabel = step?.label ?? label
  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: isFocused }} style={rail ? tb.railTab : tb.tab}>
      {center ? (
        <View style={[tb.center, rail && tb.centerRail]}>
          <Animated.View style={{ opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }, { rotate: turnFor(shownIcon) }] }}>
            <Icon name={shownIcon} size={26} color="#fff" />
          </Animated.View>
        </View>
      ) : (
        <Icon name={isFocused ? icon : (`${icon}-outline` as IconName)} size={23} color={color} />
      )}
      <Animated.Text style={[tb.label, { color, opacity: center && cycle ? anim : 1 }, isFocused && { fontWeight: '700' }]}>{shownLabel}</Animated.Text>
    </Pressable>
  )
}

export interface TabItem { name: string; href: Href; icon: IconName; label: string; center?: boolean; /** Centre button: the looks it changes between. */ cycle?: CycleStep[] }

/** Bottom tab bar on phones and portrait tablets; a navigation rail on the left on wide screens. Shared by both apps. */
export function AppTabs({ items }: { items: TabItem[] }) {
  const insets = useSafeAreaInsets()
  const { wide: rail } = useLayout()
  const list = (
    <TabList style={rail ? [tb.rail, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, paddingLeft: insets.left }] : [tb.bar, { paddingBottom: 8 + insets.bottom }]}>
      {items.map((it) => (
        <TabTrigger key={it.name} name={it.name} href={it.href} asChild><TabButton rail={rail} icon={it.icon} label={it.label} center={it.center} cycle={it.cycle} /></TabTrigger>
      ))}
    </TabList>
  )
  return (
    // Tabs spreads its props over its default style, so even `style={undefined}` drops its flex: 1.
    // Always pass the full style.
    <Tabs style={{ flex: 1, flexDirection: rail ? 'row' : 'column' }}>
      {rail && list}
      <TabSlot />
      {!rail && list}
    </Tabs>
  )
}

const tb = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, ...shadow, shadowOffset: { width: 0, height: -4 } },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  rail: { width: 96, flexDirection: 'column', justifyContent: 'center', gap: 28, backgroundColor: colors.surface, borderTopRightRadius: 28, borderBottomRightRadius: 28, ...shadow, shadowOffset: { width: 4, height: 0 } },
  railTab: { alignItems: 'center', gap: 4 },
  center: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -30, borderWidth: 5, borderColor: colors.bg },
  centerRail: { marginTop: 0 },
  label: { fontSize: 11 },
})
