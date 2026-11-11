import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { CauseCard, MyCauses } from '../../../shared/api'
import { Avatar, Button, Card, Header, Icon, ListRow, Pill, Screen, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { fmt } from '../../lib/format'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

const PINK = '#DB2777'

/** Donate: start a cause, open one by its code, and the causes I run or gave to. */
export default function Donate() {
  const t = useT()
  const { fail } = useMoqoqo()
  const [d, setD] = useState<MyCauses | null>(null)
  const [code, setCode] = useState('')

  useFocusEffect(
    useCallback(() => {
      api<MyCauses>('/v1/causes').then(setD).catch((e) => {
        setD({ mine: [], supported: [] })
        fail(e)
      })
      // Loading once per focus is what matters; fail is recreated each render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  )

  const open = (c: string) => router.push({ pathname: '/donate/[code]', params: { code: c.toUpperCase() } })
  const row = (c: CauseCard, i: number, all: CauseCard[]) => (
    <ListRow key={c.id} last={i === all.length - 1} onPress={() => open(c.code)}
      left={<Avatar name={c.title} icon="heart" color={PINK} size={40} />}
      title={c.title} subtitle={`${t.donate.raisedOf(fmt(c.raised), fmt(c.target))} · ${t.donate.givers(c.donorCount)}`}
      right={c.status !== 'open' ? <Pill label={t.donate.statuses[c.status]} tone={c.status === 'suspended' ? 'warn' : 'primary'} /> : <Icon name="chevron-forward" size={18} color={colors.muted} />} />
  )

  return (
    <Screen>
      <Header title={t.donate.title} />
      <Text style={s.intro}>{t.donate.intro}</Text>
      <Button label={t.donate.start} icon="add-circle" onPress={() => router.push('/donate/new')} />

      <Text style={s.label}>{t.donate.openCode}</Text>
      <View style={s.row}>
        <TextInput style={s.input} value={code} onChangeText={(v) => setCode(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())} autoCapitalize="characters"
          autoCorrect={false} placeholder={t.donate.codePlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={t.donate.openCode} />
        <Pressable accessibilityRole="button" accessibilityLabel={t.donate.view} disabled={code.length !== 6} onPress={() => open(code)} style={[s.go, code.length !== 6 && { opacity: 0.4 }]}>
          <Icon name="arrow-forward" size={24} color="#fff" />
        </Pressable>
      </View>

      {!d ? <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} /> : (
        <>
          {d.mine.length > 0 && <><SectionTitle title={t.donate.mine} /><Card style={{ paddingVertical: 4 }}>{d.mine.map(row)}</Card></>}
          {d.supported.length > 0 && <><SectionTitle title={t.donate.supported} /><Card style={{ paddingVertical: 4 }}>{d.supported.map(row)}</Card></>}
          {!d.mine.length && !d.supported.length && <Text style={s.none}>{t.donate.none}</Text>}
        </>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  intro: { fontSize: 14.5, color: colors.muted, lineHeight: 21, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, height: 52, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 18, fontSize: 17, letterSpacing: 2, color: colors.text },
  go: { width: 52, height: 52, borderRadius: 26, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center' },
  none: { textAlign: 'center', color: colors.muted, marginTop: 32 },
})
