import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '../i18n'
import { rememberRecent } from '../lib/recents'
import { toggleFloating, useFloating } from '../lib/floating'
import type { MiniApp } from '../miniapps/registry'
import { MiniAppIcon } from './MiniAppIcon'
import { useIconScale } from '../lib/iconStyle'
import { useServices } from '../lib/services'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors } from '../theme'
import { AppIcon, type IconName } from './ui'

/** One mini app: icon, name and an optional "New" badge. Shared by Services and the Home grid. */
export function MiniAppTile({ app, onPress }: { app: MiniApp; onPress: () => void }) {
  const t = useT()
  const { toast } = useMoqoqo()
  const label = t.services.items[app.id]
  const scale = useIconScale()
  // Me › Floating mini apps: a long press keeps the app in the floating bubble (or takes it off).
  const floating = useFloating()
  const float = floating.enabled && app.href ? () => {
    const r = toggleFloating(app.id)
    toast(r === 'added' ? t.floating.added(label) : r === 'removed' ? t.floating.removed(label) : t.floating.full)
  } : undefined
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={app.isNew ? `${label}, ${t.services.newBadge}` : label} onPress={onPress} onLongPress={float} style={v.item}>
      {({ pressed }) => (
        <>
          <View>
            <MiniAppIcon id={app.id} size={Math.round(50 * scale)}
              fallback={app.service ? <ServiceTileIcon app={app} active={pressed} /> : <AppIcon icon={app.icon} color={app.color} size={50} active={pressed} />} />
            {app.isNew && <Text style={v.badge}>{t.services.newBadge}</Text>}
          </View>
          <Text style={v.label} numberOfLines={2}>{label}</Text>
        </>
      )}
    </Pressable>
  )
}

/** A tile that opens a portal service (Buy airtime) wears that service's icon and colour, as on the Services page. */
function ServiceTileIcon({ app, active }: { app: MiniApp; active: boolean }) {
  const { services } = useServices()
  const svc = services.find((s) => s.id === app.service)
  return <AppIcon icon={(svc?.icon as IconName | undefined) ?? app.icon} color={svc?.color ?? app.color} size={50} active={active} />
}

/** Opens a mini app, or shows its short note when it isn't built yet. */
export function useOpenMiniApp() {
  const { toast } = useMoqoqo()
  const t = useT()
  return (app: MiniApp) => {
    if (!app.href) return app.toast && toast(t.services.toasts[app.toast])
    rememberRecent({ kind: 'app', id: app.id })
    router.push(app.href)
  }
}

/** A plain tile in the same style, e.g. "See all" at the end of the Home grid. */
export function ShortcutTile({ icon, label, onPress, color = colors.muted }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={v.item}>
      {({ pressed }) => (
        <>
          <AppIcon icon={icon} color={color} size={50} active={pressed} />
          <Text style={v.label} numberOfLines={2}>{label}</Text>
        </>
      )}
    </Pressable>
  )
}

const v = StyleSheet.create({
  item: { width: '25%', alignItems: 'center', gap: 8 },
  label: { fontSize: 12.5, fontWeight: '500', color: colors.text, textAlign: 'center' },
  badge: { position: 'absolute', top: -6, right: -14, backgroundColor: colors.danger, color: '#fff', fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: 'hidden' },
})
