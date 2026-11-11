import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { nextStopOrderDate, type StopOrderFrequency } from '../../../shared/api'
import { Button, Card, Header, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { fmt } from '../../lib/format'
import { useSavedBills, useSavedRecipients } from '../../lib/saved'
import { useLocalized } from '../../lib/services'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

const MONTH_DAYS = [...Array.from({ length: 28 }, (_, i) => i + 1), 0]

/**
 * New stop order: pay a saved bill or a saved person, an amount, monthly on a day (or weekly on a weekday), and how
 * many times (or until cancelled). Confirmed with the PIN once; the server pays it on its days from then on.
 */
export default function NewStopOrder() {
  const t = useT()
  const L = useLocalized()
  const { toast, fail } = useMoqoqo()
  const { askPin } = useDialogs()
  const { bills } = useSavedBills()
  const { people } = useSavedRecipients()
  const [kind, setKind] = useState<'bill' | 'send'>('bill')
  const [pick, setPick] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<StopOrderFrequency>('monthly')
  const [day, setDay] = useState(1)
  const [payments, setPayments] = useState('')
  const [busy, setBusy] = useState(false)

  const value = Number(amount)
  const count = payments.trim() ? Number(payments) : undefined
  const ready = !!pick && value > 0 && (count === undefined || (Number.isInteger(count) && count >= 1 && count <= 120))
  // Today in Maseru (UTC+2), fixed for the life of the screen.
  const [today] = useState(() => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10))
  const first = nextStopOrderDate(frequency, day, today)
  const target = kind === 'bill' ? bills.find((b) => b.id === pick) : people.find((p) => p.id === pick)
  const label = !target ? '' : 'account' in target ? `${L(target.billerName)} · ${target.nickname}` : target.nickname || target.user.name

  const create = async () => {
    const pin = await askPin({ amount: value, label: t.stopOrders.pinLabel(label) })
    if (!pin) return
    setBusy(true)
    try {
      await api('/v1/stop-orders', {
        body: { kind, ...(kind === 'bill' ? { savedBillId: pick } : { recipientId: pick }), amount: value, frequency, day, payments: count, pin },
      })
      toast(t.stopOrders.created(t.stopOrders.next(first)))
      router.back()
    } catch (e) {
      if (e instanceof ApiFailure && e.message) toast(e.message)
      else fail(e)
    } finally {
      setBusy(false)
    }
  }

  const chip = (on: boolean, text: string, onPress: () => void, key?: string | number) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && { color: '#fff' }]} numberOfLines={1}>{text}</Text>
    </Pressable>
  )

  return (
    <Screen footer={<View style={s.footer}><Button label={t.stopOrders.setUp} icon="repeat" disabled={!ready || busy} onPress={create} /></View>}>
      <Header title={t.stopOrders.new} />

      <Text style={s.label}>{t.stopOrders.pay}</Text>
      <View style={s.row}>
        {chip(kind === 'bill', t.stopOrders.aBill, () => { setKind('bill'); setPick(null) })}
        {chip(kind === 'send', t.stopOrders.aPerson, () => { setKind('send'); setPick(null) })}
      </View>
      <Card style={{ paddingVertical: 8, marginTop: 10 }}>
        {kind === 'bill'
          ? (bills.length === 0 ? <Text style={s.none}>{t.stopOrders.noBills}</Text> : (
            <View style={s.wrap}>{bills.map((b) => chip(pick === b.id, `${b.nickname} · ${L(b.billerName)}`, () => setPick(b.id), b.id))}</View>
          ))
          : (people.length === 0 ? <Text style={s.none}>{t.stopOrders.noPeople}</Text> : (
            <View style={s.wrap}>{people.map((p) => chip(pick === p.id, p.nickname || p.user.name, () => setPick(p.id), p.id))}</View>
          ))}
      </Card>

      <Text style={s.label}>{t.stopOrders.amount}</Text>
      <TextInput style={s.input} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00"
        placeholderTextColor={colors.muted} accessibilityLabel={t.stopOrders.amount} />

      <Text style={s.label}>{t.stopOrders.how}</Text>
      <View style={s.row}>
        {chip(frequency === 'monthly', t.stopOrders.monthly, () => { setFrequency('monthly'); setDay(1) })}
        {chip(frequency === 'weekly', t.stopOrders.weekly, () => { setFrequency('weekly'); setDay(1) })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.row, { marginTop: 10 }]}>
        {frequency === 'monthly'
          ? MONTH_DAYS.map((d) => chip(day === d, d === 0 ? t.stopOrders.lastDay : String(d), () => setDay(d), d))
          : t.stopOrders.weekdays.map((w, d) => chip(day === d, w, () => setDay(d), d))}
      </ScrollView>

      <Text style={s.label}>{t.stopOrders.times}</Text>
      <TextInput style={s.input} value={payments} onChangeText={(v) => setPayments(v.replace(/\D/g, ''))} keyboardType="number-pad"
        placeholder={t.stopOrders.untilCancelled} placeholderTextColor={colors.muted} accessibilityLabel={t.stopOrders.times} />

      {ready && (
        <Card style={{ marginTop: 16 }}>
          <Text style={s.summary}>{t.stopOrders.summary(fmt(value), label, t.stopOrders.schedule(frequency, day), first)}</Text>
        </Card>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  none: { color: colors.muted, padding: 8, lineHeight: 20 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text },
  summary: { fontSize: 15, color: colors.text, lineHeight: 22 },
  footer: { paddingHorizontal: 16, paddingBottom: 20 },
})
