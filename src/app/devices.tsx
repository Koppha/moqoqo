import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { BoundDevice } from '../../shared/api'
import { Avatar, Card, Header, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { dayLabel } from '../lib/mappers'
import { colors } from '../theme'

/** Me › Phones: the phone EcoCash Super App is set up on now, and earlier ones (signed out when another phone took over). */
export default function Devices() {
  const t = useT()
  const [list, setList] = useState<BoundDevice[] | null>(null)
  const [failed, setFailed] = useState(false)
  useFocusEffect(useCallback(() => {
    api<BoundDevice[]>('/v1/me/devices').then(setList, () => setFailed(true))
  }, []))

  const when = (iso: string) => dayLabel(iso, t.common.weekdays)
  const active = list?.filter((d) => !d.unboundAt) ?? []
  const earlier = list?.filter((d) => d.unboundAt) ?? []
  const row = (d: BoundDevice, last: boolean) => (
    <ListRow key={d.id} last={last} left={<Avatar name={d.model} icon={d.platform === 'ios' ? 'phone-portrait-outline' : 'phone-portrait'} color={d.unboundAt ? colors.muted : colors.primary} size={40} />}
      title={`${d.model}${d.current ? ` · ${t.phones.thisPhone}` : ''}`}
      subtitle={d.unboundAt
        ? `${d.unboundReason === 'removed_by_staff' ? t.phones.removed : t.phones.replaced} ${when(d.unboundAt)}`
        : `${d.app === 'business' ? 'EcoCash Business' : 'EcoCash Super App'} · ${t.phones.since(when(d.boundAt))}${d.lastSeenAt ? ` · ${t.phones.seen(when(d.lastSeenAt))}` : ''}`} />
  )

  return (
    <Screen>
      <Header title={t.phones.title} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <Text style={s.intro}>{t.phones.intro}</Text>
        {!list ? (failed ? <Text style={s.muted}>{t.errors.NETWORK}</Text> : <ActivityIndicator color={colors.primary} />) : (
          <>
            <Text style={s.section}>{t.phones.bound}</Text>
            <Card style={{ paddingVertical: 4 }}>{active.length ? active.map((d, i) => row(d, i === active.length - 1)) : <Text style={s.muted}>{t.phones.none}</Text>}</Card>
            {earlier.length > 0 && (
              <>
                <Text style={s.section}>{t.phones.earlier}</Text>
                <Card style={{ paddingVertical: 4 }}>{earlier.map((d, i) => row(d, i === earlier.length - 1))}</Card>
              </>
            )}
            <Text style={s.note}>{t.phones.lostPhone}</Text>
          </>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  intro: { fontSize: 14, color: colors.muted, marginBottom: 6, marginTop: 4 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  muted: { color: colors.muted, padding: 12 },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 14 },
})
