import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { rememberRecent, useRecents } from '../lib/recents'
import { serviceIcon, useLocalized, useServices } from '../lib/services'
import { MINI_APPS } from '../miniapps/registry'
import { colors, radius } from '../theme'
import { MiniAppTile, ShortcutTile, useOpenMiniApp } from './MiniApps'
import { Icon } from './ui'

/** Opens a portal-defined service and remembers it for the recents panel. */
export function openService(id: string) {
  rememberRecent({ kind: 'service', id })
  router.push({ pathname: '/service/[id]', params: { id } })
}

/**
 * Pull down on Home: the mini apps and services opened most recently, in a panel that drops from the top.
 * Tap outside, or the handle, to close it.
 */
export function RecentsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT()
  const insets = useSafeAreaInsets()
  const recents = useRecents()
  const { services } = useServices()
  const L = useLocalized()
  const openApp = useOpenMiniApp()
  const [drop] = useState(() => new Animated.Value(0))

  useEffect(() => {
    if (visible) Animated.spring(drop, { toValue: 1, useNativeDriver: true, bounciness: 4 }).start()
    else drop.setValue(0)
  }, [visible, drop])

  const go = (open: () => void) => {
    onClose()
    open()
  }
  const items = recents.flatMap((r) => {
    if (r.kind === 'app') {
      const app = MINI_APPS.find((a) => a.id === r.id)
      return app ? [<MiniAppTile key={`a-${app.id}`} app={app} onPress={() => go(() => openApp(app))} />] : []
    }
    const sv = services.find((x) => x.id === r.id)
    return sv ? [<ShortcutTile key={`s-${sv.id}`} icon={serviceIcon(sv)} color={sv.color} label={L(sv.name)} onPress={() => go(() => openService(sv.id))} />] : []
  })

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={p.scrim} onPress={onClose} accessibilityLabel={t.common.close} />
      <Animated.View
        style={[p.panel, { paddingTop: insets.top + 16, transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-400, 0] }) }] }]}>
        <Text style={p.title} accessibilityRole="header">{t.home.recentsTitle}</Text>
        {items.length ? <View style={p.grid}>{items}</View> : (
          <View style={p.empty}>
            <Icon name="time-outline" size={36} color={colors.muted} />
            <Text style={p.emptyText}>{t.home.recentsEmpty}</Text>
          </View>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} onPress={onClose} hitSlop={12} style={p.handleWrap}>
          <View style={p.handle} />
        </Pressable>
      </Animated.View>
    </Modal>
  )
}

const p = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,18,40,0.45)' },
  panel: {
    position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.bg, paddingHorizontal: 16,
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  handleWrap: { alignItems: 'center', paddingVertical: 14 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border },
})
