import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  remitFee,
  remitReceive,
  type RemitCorridor,
  type Remittance,
  type RemittanceResult,
  type RemitPayout,
  type RemitSettings,
} from '../../shared/api'
import { Sheet, SheetOption } from '../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen, type IconName } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt, uid } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const PAYOUT_ICON: Record<RemitPayout, IconName> = { mobile: 'phone-portrait-outline', bank: 'business-outline', cash: 'cash-outline' }

/** "ZAR 1,234.50" */
const foreign = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** 0.055 → "0.055", 1 → "1" */
const rateText = (rate: number) => String(Number(rate.toFixed(6)))

/** Who gets the money, checked on this phone before the amount (the server checks again). */
interface Target {
  corridor: RemitCorridor
  payout: RemitPayout
  recipientName: string
  recipientPhone: string
  bankName: string
  accountNumber: string
}

/**
 * Send abroad (remittance): country → how the recipient receives it (mobile wallet, bank, cash pick-up) → their details
 * → amount, fee, exchange rate and what they receive → PIN. Countries, rates, fees and limits come from the portal.
 */
export default function Remit() {
  const t = useT()
  // ?amount=… when the assistant prepared it: the amount screen opens pre-filled.
  const preset = Number(useLocalSearchParams<{ amount?: string }>().amount) || undefined
  const { state, settled, fail, toast } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [settings, setSettings] = useState<RemitSettings | null>(null)
  const [recent, setRecent] = useState<Remittance[]>([])
  const [corridor, setCorridor] = useState<RemitCorridor | null>(null)
  const [payout, setPayout] = useState<RemitPayout>('mobile')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [bankName, setBankName] = useState('')
  const [account, setAccount] = useState('')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = (c: RemitCorridor, keep?: RemitPayout) => {
    setCorridor(c)
    setPayout(keep && c.payouts.includes(keep) ? keep : c.payouts[0])
    setError(null)
  }

  useEffect(() => {
    let alive = true
    Promise.all([api<RemitSettings>('/v1/remit'), api<Remittance[]>('/v1/remittances')]).then(
      ([s, r]) => {
        if (!alive) return
        setSettings(s)
        setRecent(r)
        const first = s.corridors[0]
        if (first) choose(first)
      },
      (e) => {
        if (!alive) return
        fail(e)
        setSettings({ corridors: [], dailyMax: 0 })
      },
    )
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- load once

  /** "Send again": the form filled from an earlier remittance (if that country is still available). */
  const again = (r: Remittance) => {
    const c = settings?.corridors.find((x) => x.code === r.country)
    if (!c) return toast(t.remit.none)
    choose(c, r.payout)
    setName(r.recipientName)
    setPhone(r.recipientPhone ?? '')
    setBankName(r.bankName ?? '')
    setAccount(r.accountNumber ?? '')
  }

  const go = async () => {
    if (!corridor) return setPicking(true)
    const recipientName = name.trim().replace(/\s+/g, ' ')
    const digits = phone.replace(/[\s()-]/g, '')
    if (recipientName.length < 3 || !recipientName.includes(' ')) return setError(t.remit.badName)
    if (payout === 'bank' && (bankName.trim().length < 2 || account.replace(/[\s-]/g, '').length < 6)) return setError(t.remit.badAccount)
    if (payout !== 'bank' && !/^\+?\d{8,15}$/.test(digits)) return setError(t.remit.badPhone)
    setError(null)
    const to: Target = { corridor, payout, recipientName, recipientPhone: digits, bankName: bankName.trim(), accountNumber: account.replace(/[\s-]/g, '') }
    const a = await askAmount({
      title: t.remit.sendTo(recipientName, corridor.country),
      balance: state.balance,
      confirmLabel: t.remit.continue,
      initial: preset,
      recipient: { name: recipientName, subtitle: `${t.remit.payouts[payout]} · ${t.remit.maxHint(fmt(corridor.max))}`, icon: 'globe-outline' },
    })
    if (!a) return
    setTarget(to)
    setAmount(a)
  }

  const send = async () => {
    if (!target || !amount) return
    const fee = remitFee(target.corridor, amount)
    const pin = await askPin({ amount: amount + fee, label: t.remit.pin(target.recipientName, target.corridor.country) })
    if (!pin) return
    setBusy(true)
    try {
      const res = await api<RemittanceResult>('/v1/remittances', {
        body: {
          country: target.corridor.code,
          payout: target.payout,
          recipientName: target.recipientName,
          recipientPhone: target.recipientPhone || undefined,
          bankName: target.payout === 'bank' ? target.bankName : undefined,
          accountNumber: target.payout === 'bank' ? target.accountNumber : undefined,
          amount,
          pin,
          clientId: uid(),
        },
      })
      settled(res.money)
      setAmount(null)
      const r = res.remittance
      toast(t.remit.done(fmt(r.amount), r.recipientName))
      if (r.pickupCode) {
        Alert.alert(t.remit.pickupTitle, t.remit.pickupBody(r.pickupCode, r.recipientName), [{ text: 'OK', onPress: () => router.back() }])
      } else {
        router.back()
      }
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const fee = target && amount !== null ? remitFee(target.corridor, amount) : 0
  return (
    <Screen>
      <Header title={t.remit.title} />
      {!settings ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : settings.corridors.length === 0 ? (
        <Text style={s.empty}>{t.remit.none}</Text>
      ) : (
        <View style={s.column}>
          <Text style={s.intro}>{t.remit.intro}</Text>
          <Card style={s.form}>
            <Text style={s.label}>{t.remit.country}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t.remit.chooseCountry} onPress={() => setPicking(true)} style={[s.input, s.picker]}>
              <Text style={[s.pickerText, !corridor && { color: colors.muted }]}>{corridor?.country ?? t.remit.chooseCountry}</Text>
              <Icon name="chevron-down" size={18} color={colors.muted} />
            </Pressable>
            {corridor && <Text style={s.rate}>{t.remit.rate(corridor.currency, rateText(corridor.rate))}</Text>}

            {corridor && (
              <>
                <Text style={s.label}>{t.remit.how}</Text>
                <View style={s.payouts} accessibilityRole="radiogroup">
                  {corridor.payouts.map((p) => (
                    <Pressable key={p} accessibilityRole="radio" accessibilityState={{ checked: payout === p }} accessibilityHint={t.remit.payoutHints[p]}
                      onPress={() => { setPayout(p); setError(null) }} style={[s.payout, payout === p && s.payoutOn]}>
                      <Icon name={PAYOUT_ICON[p]} size={20} color={payout === p ? colors.primary : colors.muted} />
                      <Text style={[s.payoutText, payout === p && { color: colors.primary }]}>{t.remit.payouts[p]}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.hint}>{t.remit.payoutHints[payout]}</Text>
              </>
            )}

            <Text style={s.label}>{t.remit.name}</Text>
            <TextInput style={s.input} value={name} onChangeText={(v) => { setName(v); setError(null) }} autoCapitalize="words" autoComplete="name"
              placeholder="Thabo Mokoena" placeholderTextColor={colors.muted} accessibilityLabel={t.remit.name} maxLength={120} />
            {payout === 'bank' ? (
              <>
                <Text style={s.label}>{t.remit.bankName}</Text>
                <TextInput style={s.input} value={bankName} onChangeText={(v) => { setBankName(v); setError(null) }} autoCapitalize="words"
                  placeholderTextColor={colors.muted} accessibilityLabel={t.remit.bankName} maxLength={80} />
                <Text style={s.label}>{t.remit.accountNumber}</Text>
                <TextInput style={s.input} value={account} onChangeText={(v) => { setAccount(v.replace(/[^A-Za-z0-9 -]/g, '')); setError(null) }}
                  autoCapitalize="characters" placeholderTextColor={colors.muted} accessibilityLabel={t.remit.accountNumber} maxLength={40} />
              </>
            ) : (
              <>
                <Text style={s.label}>{t.remit.phone}</Text>
                <TextInput style={s.input} value={phone} onChangeText={(v) => { setPhone(v.replace(/[^\d+ ()-]/g, '')); setError(null) }}
                  keyboardType="phone-pad" placeholder="+27 82 123 4567" placeholderTextColor={colors.muted} accessibilityLabel={t.remit.phone} maxLength={22} />
              </>
            )}
            {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
            <Button label={t.remit.continue} onPress={go} disabled={busy || !corridor} style={{ marginTop: 14 }} />
          </Card>

          {recent.length > 0 && (
            <>
              <Text style={s.section}>{t.remit.recent}</Text>
              <Card style={{ paddingVertical: 4 }}>
                {recent.slice(0, 5).map((r, i, list) => (
                  <ListRow key={r.id} last={i === list.length - 1} onPress={() => again(r)}
                    left={<Avatar name={r.recipientName} size={42} />}
                    title={r.recipientName}
                    subtitle={`${r.countryName} · ${t.remit.payouts[r.payout]} · ${t.remit.status[r.status]}${r.pickupCode ? ` · ${r.pickupCode}` : ''}`}
                    right={<Text style={s.recentAmount}>{fmt(r.amount)}</Text>} />
                ))}
              </Card>
            </>
          )}
          <Text style={s.note}>{t.remit.note}</Text>
        </View>
      )}

      <Sheet visible={picking} title={t.remit.chooseCountry} onClose={() => setPicking(false)}>
        {settings?.corridors.map((c) => (
          <SheetOption key={c.code} icon="globe-outline" color={colors.primary} title={c.country} subtitle={t.remit.rate(c.currency, rateText(c.rate))}
            selected={corridor?.code === c.code} onPress={() => { choose(c, payout); setPicking(false) }} />
        ))}
      </Sheet>

      <Sheet visible={amount !== null} title={t.remit.summary} onClose={() => setAmount(null)}>
        {target && amount !== null && (
          <View style={{ gap: 10 }}>
            <View style={s.row}><Text style={s.rowLabel}>{t.remit.youSend}</Text><Text style={s.rowValue}>{fmt(amount)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>{t.remit.fee}</Text><Text style={s.rowValue}>{fmt(fee)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>{t.remit.total}</Text><Text style={s.rowValue}>{fmt(amount + fee)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>{t.remit.rateLabel}</Text><Text style={s.rowValue}>{t.remit.rate(target.corridor.currency, rateText(target.corridor.rate))}</Text></View>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t.remit.theyReceive}</Text>
              <Text style={[s.rowValue, { fontSize: 20, fontWeight: '800' }]}>{foreign(remitReceive(target.corridor, amount), target.corridor.currency)}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t.remit.recipient}</Text>
              <Text style={s.rowValue}>
                {target.recipientName} · {target.corridor.country}{'\n'}
                {target.payout === 'bank' ? `${target.bankName} ••${target.accountNumber.slice(-4)}` : `${t.remit.payouts[target.payout]} ${target.recipientPhone}`}
              </Text>
            </View>
            <Button label={t.remit.send(fmt(amount))} onPress={send} disabled={busy} />
          </View>
        )}
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  intro: { fontSize: 14, color: colors.muted, marginBottom: 12, lineHeight: 20 },
  empty: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 40 },
  form: { gap: 4 },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, minHeight: 54, paddingHorizontal: 14, fontSize: 17, fontWeight: '600', color: colors.text },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 16, fontWeight: '600', color: colors.text },
  rate: { fontSize: 13, color: colors.success, fontWeight: '600', marginTop: 6 },
  payouts: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  payout: { flexGrow: 1, flexBasis: 0, minWidth: 96, minHeight: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8 },
  payoutOn: { borderColor: colors.primary, backgroundColor: colors.surface2 },
  payoutText: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'center' },
  hint: { fontSize: 12.5, color: colors.muted, marginTop: 6 },
  error: { fontSize: 13, color: colors.danger, marginTop: 8 },
  recentAmount: { fontSize: 15, fontWeight: '700', color: colors.text },
  note: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
})
