import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { Offer } from '../../shared/api'
import { OfferCard } from '../components/OfferBanners'
import { Header, Icon, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { colors } from '../theme'

/** News & offers from EcoCash (set in the portal), newest first. */
export default function News() {
  const t = useT()
  const [list, setList] = useState<Offer[] | null>(null)
  useFocusEffect(useCallback(() => {
    api<Offer[]>('/v1/news').then(setList, () => setList([]))
  }, []))
  return (
    <Screen>
      <Header title={t.news.title} />
      <View style={s.body}>
        {!list ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : list.length === 0 ? (
          <View style={s.empty}><Icon name="megaphone-outline" size={44} color={colors.muted} /><Text style={s.emptyText}>{t.news.empty}</Text></View>
        ) : list.map((o) => <View key={o.id} style={{ marginBottom: 12 }}><OfferCard offer={o} /></View>)}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 16, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  empty: { alignItems: 'center', gap: 10, marginTop: 50 },
  emptyText: { color: colors.muted, fontSize: 15 },
})
