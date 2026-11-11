import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { Button, Header, Pill, Screen } from '../components/ui'
import { useT } from '../i18n'
import { fmt } from '../lib/format'
import { useLightStatusBar } from '../components/useLightStatusBar'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const FARES = [12, 15, 18, 25]

/** Driver side of tap to pay: the phone acts as a SoftPOS terminal. Always dark for sun and night use. */
export default function TaxiMode() {
  const { state, dispatch, toast } = useMoqoqo()
  const tx = state.taxi
  const t = useT()
  useLightStatusBar()
  const [flash] = useState(() => new Animated.Value(0))

  // In production these taps arrive from the SoftPOS NFC reader, not a button.
  const passengerTap = () => {
    dispatch({ type: 'taxiTap' })
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    flash.setValue(1)
    Animated.timing(flash, { toValue: 0, duration: 600, useNativeDriver: false }).start()
  }

  return (
    <Screen dark scroll={false}>
      <Header dark title={t.taxi.title} right={<Pill label={t.taxi.online} />} />
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={x.route}>{t.taxi.route('Maseru CBD → Roma')}</Text>
        <Text style={x.fare}>M{tx.fare}</Text>
        <Animated.View style={[x.ready, { backgroundColor: flash.interpolate({ inputRange: [0, 1], outputRange: ['rgba(60,207,134,0)', 'rgba(60,207,134,1)'] }) }]}>
          <Text style={x.readyText}>{t.taxi.ready}</Text>
        </Animated.View>
        <View style={x.stats}>
          <View style={x.statsRow}>
            <View><Text style={x.n}>{tx.taps}</Text><Text style={x.lbl}>{t.taxi.tapsToday}</Text></View>
            <View style={{ alignItems: 'flex-end' }}><Text style={x.n}>{fmt(tx.total)}</Text><Text style={x.lbl}>{t.taxi.earnedToday}</Text></View>
          </View>
          <View style={x.recent}>{tx.recent.map((r, i) => <Text key={i} style={x.chip}>✓ M{r}</Text>)}</View>
        </View>
        <View style={{ flex: 1 }} />
        <Button label={t.taxi.passengerTaps} icon="hand-left" variant="success" onPress={passengerTap} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={t.taxi.changeFare} variant="dark" style={{ flex: 1 }} onPress={() => dispatch({ type: 'taxiFare', fare: FARES[(FARES.indexOf(tx.fare) + 1) % FARES.length] })} />
          <Button label={t.taxi.endShift} variant="dark" style={{ flex: 1 }} onPress={() => toast(t.taxi.shiftEnded)} />
        </View>
      </View>
    </Screen>
  )
}

const x = StyleSheet.create({
  route: { textAlign: 'center', color: colors.heroMuted, fontSize: 14 },
  fare: { textAlign: 'center', color: '#fff', fontSize: 64, fontWeight: '800', marginTop: 8 },
  ready: { alignSelf: 'center', borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 6 },
  readyText: { color: '#3CCF86', fontWeight: '700', fontSize: 16 },
  stats: { backgroundColor: '#1C1D25', borderRadius: radius.lg, padding: 16, marginTop: 24 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  n: { color: '#fff', fontSize: 24, fontWeight: '800' },
  lbl: { color: colors.heroMuted, fontSize: 12.5 },
  recent: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: { backgroundColor: '#12352A', color: '#3CCF86', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12.5, overflow: 'hidden' },
})
