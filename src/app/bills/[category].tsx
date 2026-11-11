import { router, useLocalSearchParams, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { Image, StyleSheet, Text } from 'react-native'
import type { BillCategory, MiniAppIconId } from '../../../shared/api'
import { MiniAppIcon } from '../../components/MiniAppIcon'
import { AppIcon, Avatar, Card, Header, Icon, ListRow, Screen, type IconName } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { useIconScale } from '../../lib/iconStyle'
import { apiUrl } from '../../lib/server'
import { serviceIcon, useLocalized, useServices } from '../../lib/services'
import { colors } from '../../theme'

/**
 * The app's own screens listed first in a category, before the portal's billers: EcoSure (premiums are paid inside
 * the EcoSure mini app). Their icons follow the portal's mini app icons (Branding). LEC has its own screen (/lec).
 */
const BUILT_IN: Record<string, { key: 'ecosure'; href: Href; icon: MiniAppIconId; fallback: IconName; color: string }[]> = {
  insurance: [{ key: 'ecosure', href: '/ecosure', icon: 'ecosure', fallback: 'shield-checkmark', color: '#5B2FD1' }],
}

/** One Pay bill category: its billers (services the portal put in it), in the portal's order. */
export default function BillCategoryScreen() {
  const { category } = useLocalSearchParams<{ category: string }>()
  const t = useT()
  const L = useLocalized()
  const { services, loading } = useServices()
  const [cat, setCat] = useState<BillCategory | null>(null)
  useEffect(() => {
    let live = true
    api<BillCategory[]>('/v1/bill-categories').then((c) => live && setCat(c.find((x) => x.id === category) ?? null), () => {})
    return () => { live = false }
  }, [category])

  const billers = services.filter((s) => s.category === category).sort((a, b) => a.sort - b.sort)
  const builtIn = BUILT_IN[category] ?? []
  const chevron = <Icon name="chevron-forward" size={18} color={colors.muted} />
  // Logos follow Me › Icons › size, like the icons beside them.
  const side = Math.round(42 * useIconScale())

  return (
    <Screen>
      <Header title={cat ? L(cat.name) : t.payBill.title} />
      <Card style={{ paddingVertical: 4 }}>
        {builtIn.map((b, i) => (
          <ListRow key={b.key} last={billers.length === 0 && i === builtIn.length - 1} onPress={() => router.push(b.href)}
            left={<MiniAppIcon id={b.icon} size={side} fallback={<AppIcon icon={b.fallback} color={b.color} size={42} />} />}
            title={t.payBill[b.key][0]} subtitle={t.payBill[b.key][1]} right={chevron} />
        ))}
        {billers.map((b, i) => (
          <ListRow key={b.id} last={i === billers.length - 1} onPress={() => router.push({ pathname: '/service/[id]', params: { id: b.id } })}
            left={b.image ? <Image source={{ uri: apiUrl() + b.image }} style={{ width: side, height: side, borderRadius: side / 2 }} accessibilityIgnoresInvertColors /> : <Avatar name={L(b.name)} icon={serviceIcon(b) as IconName} color={b.color} size={42} />}
            title={L(b.name)} subtitle={L(b.description)} right={chevron} />
        ))}
        {!loading && builtIn.length === 0 && billers.length === 0 && <Text style={s.none}>{t.payBill.none}</Text>}
      </Card>
    </Screen>
  )
}

const s = StyleSheet.create({
  none: { color: colors.muted, padding: 16, textAlign: 'center' },
})
