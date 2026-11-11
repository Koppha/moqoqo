// EcoSure's UI kit (ported from EcoSure/app/src/components/ui.tsx) on EcoCash Super App's building blocks:
// expo-linear-gradient for gradients and Ionicons instead of EcoSure's SVG icon set.
import { Ionicons } from '@react-native-vector-icons/ionicons/static'
import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import type { ComponentProps, ReactNode } from 'react'
import type { EsCategory } from '../../../shared/api'
import {
  ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLightStatusBar } from '../../components/useLightStatusBar'
import { FORM_MAX } from '../../lib/layout'
import { APP } from '../../lib/variant'
import { useEsT } from './strings'
import { es, esGradients, esRadius, esType, space, type EsGradient } from './theme'
import { useKeyboardScroll } from '../../components/useKeyboardScroll'

/** EcoSure icon names → Ionicons. */
const ICONS = {
  shield: 'shield-checkmark-outline',
  home: 'home-outline',
  policy: 'document-text-outline',
  claims: 'clipboard-outline',
  card: 'card-outline',
  bell: 'notifications-outline',
  headset: 'headset-outline',
  close: 'close',
  back: 'chevron-back',
  check: 'checkmark',
  users: 'people-outline',
  user: 'person-outline',
  sliders: 'options-outline',
  heart: 'heart-outline',
  swap: 'swap-horizontal-outline',
  upload: 'cloud-upload-outline',
  chevron: 'chevron-forward',
  car: 'car-outline',
  phone: 'phone-portrait-outline',
  box: 'cube-outline',
  briefcase: 'briefcase-outline',
  file: 'document-outline',
  wallet: 'wallet-outline',
  receipt: 'receipt-outline',
  trash: 'trash-outline',
  shieldFilled: 'shield-checkmark',
  checkCircle: 'checkmark-circle',
  info: 'information-circle-outline',
  arrow: 'arrow-forward',
} as const satisfies Record<string, ComponentProps<typeof Ionicons>['name']>

export type EsIconName = keyof typeof ICONS

export const CATEGORY_ICON: Record<EsCategory, EsIconName> = {
  funeral: 'users', motor_vehicle: 'car', device: 'phone', house_contents: 'box', house_owners: 'home', sme: 'briefcase',
}

export function EsIcon({ name, size = 22, color = es.primary }: { name: EsIconName; size?: number; color?: string }) {
  return <Ionicons name={ICONS[name]} size={size} color={color} />
}

export function Gradient({ name = 'primary', style, children, horizontal }: { name?: EsGradient; style?: StyleProp<ViewStyle>; children?: ReactNode; horizontal?: boolean }) {
  return (
    <LinearGradient colors={esGradients[name]} start={{ x: 0, y: 0 }} end={horizontal ? { x: 1, y: 0 } : { x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  )
}

/** Gradient call-to-action; `arrow` adds a trailing → for buttons that move on to another screen. */
export function PrimaryButton({ label, onPress, loading, disabled, style, arrow }: {
  label: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; arrow?: boolean
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      <Gradient name="hero" horizontal style={s.primaryBtn}>
        {loading ? <ActivityIndicator color={es.onPrimary} /> : (
          <>
            <Text style={s.primaryLabel}>{label}</Text>
            {arrow ? <EsIcon name="arrow" size={18} color={es.onPrimary} /> : null}
          </>
        )}
      </Gradient>
    </Pressable>
  )
}

export function OutlineButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.outlineBtn, { opacity: pressed ? 0.8 : 1 }, style]}>
      <Text style={s.outlineLabel}>{label}</Text>
    </Pressable>
  )
}

export function SmallButton({ label, onPress, color = es.primary }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={4}
      style={({ pressed }) => [s.smallBtn, { opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[s.smallLabel, { color }]}>{label}</Text>
    </Pressable>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Field({ label, style, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={esType.label}>{label}</Text>
      <TextInput placeholderTextColor={es.textMuted} accessibilityLabel={label} style={[s.input, input.editable === false && s.inputLocked, style]} {...input} />
    </View>
  )
}

/** Pill switch; the selected option is a gradient pill. Options can carry an icon. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string; icon?: EsIconName }[]; value: T | ''; onChange: (v: T) => void }) {
  return (
    <View style={s.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value
        const color = active ? es.onPrimary : es.textSoft
        const content = (
          <>
            {o.icon ? <EsIcon name={o.icon} size={16} color={color} /> : null}
            <Text style={{ fontSize: 13, fontWeight: active ? '700' : '600', color, textAlign: 'center', flexShrink: 1 }} numberOfLines={1}>{o.label}</Text>
          </>
        )
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(o.value)} style={{ flex: 1 }}>
            {active
              ? <Gradient name="hero" horizontal style={s.segmentItem}>{content}</Gradient>
              : <View style={s.segmentItem}>{content}</View>}
          </Pressable>
        )
      })}
    </View>
  )
}

/** A package to pick: icon tile, name, tagline, price, then a chevron (or a check once selected). */
export function PackageCard({ title, tagline, price, selected, onPress }: { title: string; tagline?: string; price: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${title}, ${price}`} onPress={onPress}
      style={({ pressed }) => [s.package, selected && s.packageSelected, { opacity: pressed ? 0.9 : 1 }]}>
      {selected
        ? <Gradient name="hero" style={s.packageIcon}><EsIcon name="shieldFilled" size={20} color={es.onPrimary} /></Gradient>
        : <View style={[s.packageIcon, { backgroundColor: es.accentBg }]}><EsIcon name="shield" size={20} color={es.accent} /></View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: es.text }} numberOfLines={1}>{title}</Text>
        {tagline ? <Text style={esType.small} numberOfLines={2}>{tagline}</Text> : null}
        <Text style={{ fontSize: 13, fontWeight: '800', color: selected ? es.accent : es.text, marginTop: 1 }}>{price}</Text>
      </View>
      {selected ? <EsIcon name="checkCircle" size={22} color={es.accent} /> : <EsIcon name="chevron" size={18} color={es.textMuted} />}
    </Pressable>
  )
}

/** Product heading card: icon tile, name and one line about it. */
export function ProductHeader({ icon, title, text }: { icon: EsIconName; title: string; text: string }) {
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <Gradient name="hero" style={[s.packageIcon, { width: 44, height: 44 }]}><EsIcon name={icon} size={22} color={es.onPrimary} /></Gradient>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={esType.h2}>{title}</Text>
        <Text style={esType.small}>{text}</Text>
      </View>
    </Card>
  )
}

export function OptionRow({ title, value, selected, onPress, sub }: { title: string; value?: string; sub?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[s.option, selected && s.optionSelected]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: selected ? '800' : '600', color: selected ? es.primary : es.text }}>{title}</Text>
        {sub ? <Text style={esType.small}>{sub}</Text> : null}
      </View>
      {value ? <Text style={{ fontSize: 14, fontWeight: selected ? '800' : '600', color: selected ? es.primary : es.textSoft }}>{value}</Text> : null}
    </Pressable>
  )
}

export function Checkbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={[s.box, checked && { backgroundColor: es.primary }]}>
        {checked ? <EsIcon name="check" size={16} color={es.onPrimary} /> : null}
      </View>
      <Text style={{ fontSize: 13, color: es.textSoft, flex: 1, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )
}

export function Notice({ title, text, tone = 'warning' }: { title?: string; text: string; tone?: 'warning' | 'info' | 'danger' }) {
  const [bg, fg] = tone === 'warning' ? [es.warningBg, es.warning] : tone === 'danger' ? [es.dangerBg, es.danger] : [es.accentBg, es.accent]
  return (
    <View style={{ backgroundColor: bg, borderRadius: esRadius.md, padding: space(3), gap: space(2.5), flexDirection: 'row', alignItems: 'flex-start' }}>
      {tone === 'info' ? <EsIcon name="info" size={18} color={fg} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <Text style={{ color: fg, fontWeight: '800', fontSize: 13 }}>{title}</Text> : null}
        {text ? <Text style={{ color: tone === 'info' ? es.textSoft : fg, fontSize: 12, lineHeight: 17 }}>{text}</Text> : null}
      </View>
    </View>
  )
}

export function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }) {
  const [bg, fg] = { success: [es.successBg, es.success], warning: [es.warningBg, es.warning], danger: [es.dangerBg, es.danger], info: [es.lilac, es.primary] }[tone]
  return <Text style={[s.badge, { backgroundColor: bg, color: fg }]}>{label.toUpperCase()}</Text>
}

/** Close the mini app and return to EcoCash Super App, like the capsule on a WeChat mini program. The standalone EcoSure app has nothing to return to. */
export function CloseCapsule({ light }: { light?: boolean }) {
  const t = useEsT()
  if (APP === 'ecosure') return <View style={{ width: 36 }} />
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.close} onPress={() => router.dismissTo('/')} hitSlop={8} style={light ? s.glass : s.capsule}>
      <EsIcon name="close" size={18} color={light ? es.onPrimary : es.text} />
    </Pressable>
  )
}

/** Gradient title bar for EcoSure's screens, under the status bar: round back button, title, the close capsule. */
export function EsHeader({ title, back = true, onBack }: { title: string; back?: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets()
  useLightStatusBar()
  return (
    <Gradient name="hero" horizontal style={[s.headerBand, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack ?? (() => router.back())} hitSlop={4} style={s.glass}>
            <EsIcon name="back" size={18} color={es.onPrimary} />
          </Pressable>
        ) : <View style={{ width: 36 }} />}
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        <CloseCapsule light />
      </View>
    </Gradient>
  )
}

/**
 * Scrollable screen body with EcoSure's header and an optional sticky call-to-action.
 * Tab screens (`back={false}`) sit above EcoSure's tab bar; the others keep clear of the system navigation bar.
 */
export function EsScreen({ title, children, cta, back = true, header = true, onBack }: {
  title?: string; children: ReactNode; cta?: ReactNode; back?: boolean; header?: boolean; onBack?: () => void
}) {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardScroll()
  const bottom = back ? insets.bottom : 0
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: es.background }} edges={['left', 'right']}>
      {header && <EsHeader title={title ?? ''} back={back} onBack={onBack} />}
      {/* Moves up with the keyboard so fields and the call-to-action stay visible. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView {...keyboard} contentContainerStyle={[s.body, !cta && { paddingBottom: space(10) + bottom }]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {cta ? <View style={[s.ctaBar, { paddingBottom: space(3) + bottom }]}><View style={s.column}>{cta}</View></View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}><ActivityIndicator color={es.primary} /></View>
}

export const s = StyleSheet.create({
  primaryBtn: { height: 48, borderRadius: esRadius.pill, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: es.onPrimary, fontSize: 15, fontWeight: '700' },
  outlineBtn: { height: 48, borderRadius: esRadius.pill, borderWidth: 2, borderColor: es.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: es.surface },
  outlineLabel: { color: es.primary, fontSize: 14, fontWeight: '700' },
  smallBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: es.lilacMuted, backgroundColor: es.surface, justifyContent: 'center' },
  smallLabel: { fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: es.surface, borderRadius: esRadius.lg, borderWidth: 1, borderColor: es.border, padding: space(3.5), gap: space(2) },
  input: { height: 46, borderWidth: 1, borderColor: es.inputBorder, borderRadius: esRadius.md, paddingHorizontal: space(3.5), fontSize: 15, backgroundColor: es.surface, color: es.text },
  inputLocked: { backgroundColor: es.lilac, color: es.textSoft },
  segment: { flexDirection: 'row', backgroundColor: es.surface, borderRadius: esRadius.pill, borderWidth: 1, borderColor: es.border, padding: 3, gap: 3 },
  segmentItem: { minHeight: 38, borderRadius: esRadius.pill, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  package: { flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: es.surface, borderRadius: esRadius.lg, borderWidth: 1.5, borderColor: es.border, paddingVertical: space(3), paddingHorizontal: space(3.5) },
  packageSelected: { borderColor: es.accent, borderWidth: 2 },
  packageIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  option: { minHeight: 50, borderRadius: esRadius.md, borderWidth: 1, borderColor: es.inputBorder, backgroundColor: es.surface, paddingHorizontal: space(4), paddingVertical: space(2.5), flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionSelected: { borderWidth: 2, borderColor: es.primary, backgroundColor: es.lilac },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: es.primary, backgroundColor: es.surface, alignItems: 'center', justifyContent: 'center' },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  capsule: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: es.border, backgroundColor: es.surface, alignItems: 'center', justifyContent: 'center' },
  headerBand: { paddingBottom: 10, borderBottomLeftRadius: esRadius.lg, borderBottomRightRadius: esRadius.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 4, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  glass: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: es.onPrimary },
  body: { padding: space(4), gap: space(3), width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', paddingBottom: space(10) },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  ctaBar: { padding: space(3), paddingHorizontal: space(4), backgroundColor: es.surface, borderTopWidth: 1, borderTopColor: es.border },
})
