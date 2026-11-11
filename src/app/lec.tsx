import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ussdDialString } from '../../shared/api'
import { SavedAccounts } from '../components/SavedAccounts'
import { Avatar, Button, Card, Header, Screen } from '../components/ui'
import { UssdFallback } from '../components/UssdFallback'
import { BILLS } from '../data/bills'
import { useT } from '../i18n'
import { fmt } from '../lib/format'
import { useSavedBills } from '../lib/saved'
import { canDialUssd, dialUssd, useOffline, useUssd } from '../lib/ussd'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

/** LEC: the meter (typed, or one of up to 5 saved meters), then an amount. */
export default function Lec() {
  const { buyLec } = useMoqoqo()
  const t = useT()
  const ussd = useUssd()
  const offline = useOffline()
  const { bills } = useSavedBills('lec')
  // Until the person types or picks one: their first saved meter, else the demo meter.
  const [typed, setTyped] = useState<string | null>(null)
  const meter = typed ?? bills[0]?.account ?? BILLS.lec.account
  const valid = /^\d{6,20}$/.test(meter.replace(/\s/g, ''))
  // Their own amount, besides the M50 / M100 / M200 tiles (cents rounded off).
  const [own, setOwn] = useState('')
  const ownAmount = Math.round(Number(own) * 100) / 100
  // No internet: a tile dials the USSD menu with the meter and that amount (Android) instead of buying online.
  const buy = (a: number) => (offline && ussd.enabled && ussd.functions.lec.enabled && canDialUssd ? dialUssd(ussdDialString(ussd, 'lec', { meter, amount: a })) : buyLec(a, meter.replace(/\s/g, '')))
  return (
    <Screen>
      <Header title={t.lec.title} />
      <Card style={l.meter}>
        <Avatar name="LEC" icon="flash" color="#F59E0B" size={48} />
        <View style={{ flex: 1 }}>
          <Text style={l.lbl}>{t.lec.meter}</Text>
          <TextInput style={l.input} value={meter} onChangeText={(v) => setTyped(v.replace(/[^\d\s]/g, ''))} keyboardType="number-pad" maxLength={24}
            accessibilityLabel={t.lec.meter} placeholder="0412 7731 905" placeholderTextColor={colors.muted} />
        </View>
      </Card>
      <View style={{ marginTop: 10 }}>
        <SavedAccounts target="lec" value={meter.replace(/\s/g, '')} onPick={setTyped} />
      </View>
      <UssdFallback fn="lec" values={{ meter }} details={[t.ussd.meter(meter)]} />
      <Text style={l.choose}>{t.lec.choose}</Text>
      <View style={l.grid}>
        {[50, 100, 200].map((a) => (
          <Pressable key={a} accessibilityRole="button" accessibilityLabel={t.lec.buy(a)} disabled={!valid} onPress={() => buy(a)}
            style={({ pressed }) => [l.tile, pressed && { backgroundColor: colors.primarySoft }, !valid && { opacity: 0.5 }]}>
            <Text style={l.amt}>M{a}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={l.other}>{t.lec.other}</Text>
      <View style={l.own}>
        <Text style={l.currency}>M</Text>
        <TextInput style={l.ownInput} value={own} onChangeText={(v) => setOwn(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={8}
          placeholder="0.00" placeholderTextColor={colors.muted} accessibilityLabel={t.lec.other} />
      </View>
      <Button label={ownAmount > 0 ? `${t.lec.buyOwn} ${fmt(ownAmount)}` : t.lec.buyOwn} icon="flash" disabled={!valid || !(ownAmount > 0)} onPress={() => buy(ownAmount)} style={{ marginTop: 12 }} />
      <Text style={l.hint}>{t.lec.hint}</Text>
    </Screen>
  )
}

const l = StyleSheet.create({
  meter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lbl: { fontSize: 12, color: colors.muted },
  input: { fontSize: 17, fontWeight: '700', color: colors.text, paddingVertical: 4, letterSpacing: 1 },
  choose: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 24, marginBottom: 12 },
  grid: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 22, alignItems: 'center' },
  amt: { fontSize: 22, fontWeight: '800', color: colors.text },
  other: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 10 },
  own: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16 },
  currency: { fontSize: 22, fontWeight: '800', color: colors.muted, marginRight: 6 },
  ownInput: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text, paddingVertical: 14 },
  hint: { textAlign: 'center', color: colors.muted, fontSize: 13, marginTop: 18 },
})
