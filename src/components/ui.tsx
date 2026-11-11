import { Ionicons } from '@react-native-vector-icons/ionicons/static'
import { router } from 'expo-router'
import type { ComponentProps, ReactNode } from 'react'
import { Image, KeyboardAvoidingView, Pressable, ScrollView, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { CONTENT_MAX } from '../lib/layout'
import { apiUrl } from '../lib/server'
import { useKeyboardScroll, useKeyboardShown } from './useKeyboardScroll'
import { useIconScale, useIconStyle } from '../lib/iconStyle'
import { avatarColor, colors, onBackground, radius, shadow } from '../theme'

export type IconName = ComponentProps<typeof Ionicons>['name']

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />
}

/** Page shell: safe area, canvas colour, optional scroll and pinned footer. Content is centred at `maxWidth` on tablets. */
export function Screen({ children, footer, scroll = true, dark, style, maxWidth = CONTENT_MAX }: {
  children: ReactNode; footer?: ReactNode; scroll?: boolean; dark?: boolean; style?: StyleProp<ViewStyle>; maxWidth?: number
}) {
  const bg = dark ? colors.hero : colors.bg
  const column: ViewStyle = { width: '100%', maxWidth, alignSelf: 'center' }
  // Content and a pinned footer (e.g. "Create now") stay above the system navigation bar, and move up with the
  // keyboard (Android draws edge to edge, so the window doesn't shrink for the keyboard by itself).
  const safe = useSafeAreaInsets()
  // While typing, the keyboard already sits over the navigation bar: no extra space under the footer.
  const bottom = useKeyboardShown() ? 0 : safe.bottom
  const below = footer ? 0 : bottom
  const keyboard = useKeyboardScroll()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {scroll ? (
          <ScrollView {...keyboard} contentContainerStyle={[{ padding: 16, paddingBottom: 32 + below }, column, style]} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, paddingBottom: below }, column, style]}>{children}</View>
        )}
        {footer && <View style={[column, { paddingBottom: bottom }]}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/** Centered title with a round back button, as in the reference. */
export function Header({ title, back = true, right, dark }: { title: string; back?: boolean; right?: ReactNode; dark?: boolean }) {
  const fg = dark ? colors.heroText : colors.text
  const t = useT()
  return (
    <View style={s.header}>
      <View style={s.headerSide}>
        {back && (
          <Pressable accessibilityLabel={t.common.back} onPress={() => router.back()} style={[s.circleBtn, dark && s.circleBtnDark]}>
            <Icon name="arrow-back" size={20} color={fg} />
          </Pressable>
        )}
      </View>
      <Text style={[s.headerTitle, { color: fg }]} numberOfLines={1}>{title}</Text>
      <View style={[s.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  )
}

export function CircleIconButton({ icon, onPress, label, dark }: { icon: IconName; onPress?: () => void; label: string; dark?: boolean }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[s.circleBtn, dark && s.circleBtnDark]}>
      <Icon name={icon} size={20} color={dark ? colors.heroText : colors.text} />
    </Pressable>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

/** Round outlined icon with a label underneath (Send / Request / Top up …). */
export function ActionButton({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.action}>
      <View style={s.actionCircle}><Icon name={icon} size={22} color={colors.text} /></View>
      <Text style={s.actionLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  )
}

export function Button({ label, onPress, disabled, variant = 'primary', icon, style }: {
  label: string; onPress?: () => void; disabled?: boolean; variant?: 'primary' | 'ghost' | 'success' | 'dark'
  icon?: IconName; style?: StyleProp<ViewStyle>
}) {
  const bg = { primary: colors.primary, ghost: colors.surface, success: colors.success, dark: '#1C1D25' }[variant]
  const fg = variant === 'ghost' ? colors.text : '#fff'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, variant === 'ghost' && s.btnGhost, style]}
    >
      {icon && <Icon name={icon} size={18} color={fg} />}
      {/* One line: a long label (Sesotho, two buttons side by side) shrinks a little rather than spilling over. */}
      <Text style={[s.btnText, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{label}</Text>
    </Pressable>
  )
}

export function Pill({ label, tone = 'success' }: { label: string; tone?: 'success' | 'warn' | 'primary' }) {
  const c = { success: [colors.successSoft, colors.success], warn: [colors.warnSoft, colors.warn], primary: [colors.primarySoft, colors.primary] }[tone]
  return <Text style={[s.pill, { backgroundColor: c[0], color: c[1] }]}>{label}</Text>
}

/**
 * Coloured circle with an icon or initials, like the bank logos in the reference. With an icon it follows Me › Icons
 * (style and size) like every other icon; `fixed` keeps the original circle (e.g. the Classic preview itself).
 * Initials (people) always stay in their circle.
 */
export function Avatar({ name, icon, size = 44, color, fixed = false, photo }: {
  name: string; icon?: IconName; size?: number; color?: string; fixed?: boolean
  /** A person's profile picture (asset path); shown instead of their initials. */
  photo?: string
}) {
  const bg = color ?? avatarColor(name)
  if (photo) {
    return <Image source={{ uri: apiUrl() + photo }} accessibilityLabel={name} accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }} />
  }
  if (icon && !fixed) return <AppIcon icon={icon} color={bg} size={size} />
  const initials = name.replace(/[^A-Za-z' ]/g, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      {icon ? <Icon name={icon} size={size * 0.48} color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.36 }}>{initials || '?'}</Text>}
    </View>
  )
}

/** The outline version of an icon (as the menu bar uses for tabs that aren't open). */
const outlineOf = (name: IconName) => (name.endsWith('-outline') || name.startsWith('logo-') ? name : (`${name}-outline` as IconName))

/**
 * A service or transaction icon in the style chosen in Me › Icons: classic (white in a coloured circle), colour (the
 * symbol in its colour), or minimal (a grey outline that fills in its colour while `active`, i.e. pressed).
 */
export function AppIcon({ icon, color, size: base = 44, active = false }: { icon: IconName; color: string; size?: number; active?: boolean }) {
  const style = useIconStyle()
  const size = Math.round(base * useIconScale())
  if (style === 'classic') return <Avatar name="" icon={icon} color={color} size={size} fixed />
  const quiet = style === 'minimal' && !active
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={quiet ? outlineOf(icon) : icon} size={Math.round(size * 0.68)} color={quiet ? colors.muted : onBackground(color)} />
    </View>
  )
}

export function ListRow({ left, title, subtitle, right, onPress, last }: {
  left?: ReactNode; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; last?: boolean
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, !last && s.rowBorder, pressed && { opacity: 0.6 }]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  )
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: IconName; onAction?: () => void }) {
  const t = useT()
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action && <Pressable accessibilityLabel={`${title} ${t.common.more}`} onPress={onAction}><Icon name={action} size={20} /></Pressable>}
    </View>
  )
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  headerSide: { width: 56 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  circleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  circleBtnDark: { backgroundColor: '#1C1D25', borderColor: '#2A2B35' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, ...shadow },
  action: { alignItems: 'center', gap: 6, flex: 1, paddingHorizontal: 2 },
  actionCircle: { width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  // Two-word labels (Receive money, Charge customer) wrap under the circle, centred.
  actionLabel: { fontSize: 12, lineHeight: 15, color: colors.text, fontWeight: '500', textAlign: 'center' },
  btn: { height: 56, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, paddingHorizontal: 14 },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
})
