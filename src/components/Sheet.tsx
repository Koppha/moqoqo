import { useEffect, useState, type ReactNode } from 'react'
import { Keyboard, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { colors, radius, shadow } from '../theme'
import { Avatar, Icon, type IconName } from './ui'

/** Height of the on-screen keyboard while it's open, so a sheet with a text box can sit above it. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [])
  return height
}

/**
 * A bottom sheet. It closes the keyboard as it opens (a keyboard left up from the screen behind would cover it), unless
 * `typing`: the sheet has its own text box, and then sits above the keyboard.
 */
export function Sheet({ title, visible, onClose, children, typing }: {
  title?: string; visible: boolean; onClose: () => void; children: ReactNode; typing?: boolean
}) {
  const insets = useSafeAreaInsets()
  const t = useT()
  const keyboard = useKeyboardHeight()
  useEffect(() => {
    if (visible && !typing) Keyboard.dismiss()
  }, [visible, typing])
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel={t.common.close} />
      {/* On Android edge-to-edge the reported keyboard height leaves out the navigation bar under it. */}
      <View style={[st.sheet, { paddingBottom: 20 + insets.bottom + keyboard }]}>
        <View style={st.grabber} />
        {title && <Text style={st.title}>{title}</Text>}
        {children}
      </View>
    </Modal>
  )
}

/** `selected` turns the row into a radio option: checkmark instead of the chevron. */
export function SheetOption({ icon, color, title, subtitle, onPress, selected }: {
  icon: IconName; color?: string; title: string; subtitle: string; onPress: () => void; selected?: boolean
}) {
  const radio = selected !== undefined
  return (
    <Pressable accessibilityRole={radio ? 'radio' : 'button'} accessibilityState={radio ? { checked: selected } : undefined} accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [st.opt, pressed && { opacity: 0.7 }]}>
      <Avatar name={title} icon={icon} color={color} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={st.optTitle}>{title}</Text>
        <Text style={st.optSub}>{subtitle}</Text>
      </View>
      {radio
        ? <Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.primary : colors.muted} />
        : <Icon name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  )
}

export function SheetGrid({ items }: { items: { icon: IconName; label: string; onPress: () => void }[] }) {
  return (
    <View style={st.grid}>
      {items.map((it) => (
        <Pressable key={it.label} accessibilityRole="button" accessibilityLabel={it.label} onPress={it.onPress} style={st.gridItem}>
          <View style={st.gridCircle}><Icon name={it.icon} size={22} color={colors.primary} /></View>
          <Text style={st.gridLabel}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(14,15,20,0.45)' },
  // Full width on phones; a centred panel on tablets.
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 16, paddingTop: 10, ...shadow, width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#D5D7E0', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 14, color: colors.text },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  optTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  optSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  gridItem: { width: '25%', alignItems: 'center', gap: 6 },
  gridCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 12, color: colors.text, fontWeight: '500' },
})
