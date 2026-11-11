import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import type { BillCategory } from '../../../shared/api'
import { AppIcon, Card, Header, Screen, type IconName } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { apiUrl } from '../../lib/server'
import { useLocalized, useServices } from '../../lib/services'
import { colors } from '../../theme'

/**
 * Pay bill: the categories the portal lists (Econet, LEC, MultiChoice, WASCO, Insurance, …). A category with a single
 * biller opens it straight away; LEC opens the app's own LEC screen (meter and amount).
 */
export default function PayBill() {
  const t = useT()
  const L = useLocalized()
  const { services } = useServices()
  const [cats, setCats] = useState<BillCategory[] | null>(null)
  useFocusEffect(
    useCallback(() => {
      let live = true
      api<BillCategory[]>('/v1/bill-categories').then((c) => live && setCats(c), () => live && setCats((x) => x ?? []))
      return () => { live = false }
    }, []),
  )

  const open = (c: BillCategory) => {
    const billers = services.filter((s) => s.category === c.id)
    if (c.id === 'lec') router.push('/lec')
    else if (billers.length === 1) router.push({ pathname: '/service/[id]', params: { id: billers[0].id } })
    else router.push({ pathname: '/bills/[category]', params: { category: c.id } })
  }

  return (
    <Screen>
      <Header title={t.payBill.title} />
      {!cats ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <Card>
          <View style={s.grid}>
            {cats.map((c) => (
              <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={L(c.name)} onPress={() => open(c)} style={s.item}>
                {({ pressed }) => (
                  <>
                    {c.image
                      ? <Image source={{ uri: apiUrl() + c.image }} style={s.logo} accessibilityIgnoresInvertColors />
                      : <AppIcon icon={c.icon as IconName} color={c.color} size={50} active={pressed} />}
                    <Text style={s.label} numberOfLines={2}>{L(c.name)}</Text>
                  </>
                )}
              </Pressable>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 18 },
  item: { width: '33.33%', alignItems: 'center', gap: 8 },
  logo: { width: 50, height: 50, borderRadius: 25 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, textAlign: 'center' },
})
