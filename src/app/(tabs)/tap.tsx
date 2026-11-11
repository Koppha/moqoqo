import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Icon, Pill, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { fmt } from '../../lib/format'
import { NO_PIN_TAP_LIMIT } from '../../../shared/api'
import { TAXI_FARE, useMoqoqo } from '../../state/useMoqoqo'
import { colors } from '../../theme'

function Pulse({ delay }: { delay: number }) {
  const [v] = useState(() => new Animated.Value(0))
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [v, delay])
  return (
    <Animated.View
      style={[p.ring, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.5] }) }] }]}
    />
  )
}

export default function Tap() {
  const { state, tapToPay, taxiChatId } = useMoqoqo()
  const [phase, setPhase] = useState<'ready' | 'busy' | 'done'>('ready')
  const t = useT()

  // Real NFC (HCE) needs a native module on a physical phone; the emulator simulates the tap.
  const tap = async () => {
    setPhase('busy')
    setPhase((await tapToPay()) ? 'done' : 'ready')
  }

  return (
    <Screen>
      <Text style={p.title}>{t.tap.title}</Text>
      <Card style={p.card}>
        {phase === 'done' ? (
          <>
            <View style={p.ok}><Icon name="checkmark" size={56} color="#fff" /></View>
            <Text style={p.paid}>{t.tap.paid(fmt(TAXI_FARE))}</Text>
            <Text style={p.muted}>Ntate Mokoena · Taxi</Text>
            <Text style={[p.muted, { textAlign: 'center', marginTop: 6 }]}>{t.tap.noPin(NO_PIN_TAP_LIMIT)}</Text>
            <Button label={t.tap.viewReceipt} variant="ghost" onPress={() => { const id = taxiChatId(); if (id) router.push(`/chat/${id}`) }} style={{ alignSelf: 'stretch' }} />
            <Button label={t.tap.done} onPress={() => setPhase('ready')} style={{ alignSelf: 'stretch' }} />
          </>
        ) : (
          <>
            <View style={p.stage}>
              <Pulse delay={0} />
              <Pulse delay={1000} />
              <View style={p.core}>
                <View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="wifi" size={44} color="#fff" /></View>
              </View>
            </View>
            <Text style={p.hold}>{phase === 'busy' ? t.tap.paying : t.tap.hold}</Text>
            <Text style={p.muted}>{t.common.balance(fmt(state.balance))}</Text>
            <View style={{ marginTop: 8 }}><Pill label={t.tap.offline} /></View>
            <Button label={t.tap.simulate(TAXI_FARE)} icon="phone-portrait-outline" disabled={phase === 'busy'} onPress={tap} style={{ alignSelf: 'stretch', marginTop: 20 }} />
            <Button label={t.money.show} icon="qr-code-outline" variant="ghost" onPress={() => router.push('/money')} style={{ alignSelf: 'stretch' }} />
            <Button label={t.pay.scanTitle} icon="scan-outline" variant="ghost" onPress={() => router.push('/pay')} style={{ alignSelf: 'stretch' }} />
          </>
        )}
      </Card>
    </Screen>
  )
}

const p = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 16 },
  card: { alignItems: 'center', paddingVertical: 28 },
  stage: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 3, borderColor: colors.primary },
  core: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  hold: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13.5, marginTop: 4 },
  ok: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  paid: { fontSize: 28, fontWeight: '800', color: colors.text },
})
