import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cardTopupFee, type Card as SavedCard, type Tariff, type Topup, type TopupResult, type TopupStart } from '../../shared/api'
import { Sheet } from '../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api, errorCode } from '../lib/api'
import { brandName, cardBrand, cardDigits, cardLabel, formatCardNumber, luhn, maskExpiry, parseExpiry } from '../lib/cards'
import { fmt, uid } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

/**
 * Card to wallet: pick a saved card (or add one), choose the amount, see the fee, confirm with the PIN, then the
 * bank's one-time code (3-D Secure). Only the gateway's token and the last 4 digits are kept.
 */
export default function TopUp() {
  const t = useT()
  // ?amount=… when the EcoCash Assistant prepared it: the amount screen opens pre-filled.
  const preset = Number(useLocalSearchParams<{ amount?: string }>().amount) || undefined
  const { state, settled, fail, toast } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [tariff, setTariff] = useState<Tariff | null>(null)
  const [cards, setCards] = useState<SavedCard[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ number: '', expiry: '', cvv: '', name: state.me?.name ?? '' })
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [pending, setPending] = useState<{ topup: Topup; hint: string } | null>(null)
  const [otp, setOtp] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([api<Tariff>('/v1/tariff'), api<SavedCard[]>('/v1/cards')]).then(
      ([tf, cs]) => { if (alive) { setTariff(tf); setCards(cs); setAdding(cs.length === 0); setSelected(cs[0]?.id ?? null) } },
      (e) => { if (alive) { fail(e); setCards([]) } },
    )
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- load once

  const card = cards?.find((c) => c.id === selected) ?? null
  const digits = cardDigits(form.number)
  const brand = cardBrand(digits)

  const addCard = async () => {
    const expiry = parseExpiry(form.expiry)
    const problem = !luhn(digits) ? t.cash.badCard : !brand ? t.cash.onlyVisaMc : !expiry ? t.cash.badExpiry
      : !/^\d{3}$/.test(form.cvv) ? t.cash.badCvv : form.name.trim().length < 2 ? t.cash.badName : ''
    if (problem) return Alert.alert(t.cash.addCard, problem)
    setBusy(true)
    try {
      const saved = await api<SavedCard>('/v1/cards', { body: { number: digits, expMonth: expiry!.month, expYear: expiry!.year, cvv: form.cvv, holderName: form.name.trim() } })
      setCards((cs) => [saved, ...(cs ?? [])])
      setSelected(saved.id)
      setAdding(false)
      setForm({ number: '', expiry: '', cvv: '', name: form.name })
      toast(t.cash.cardAdded)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const removeCard = (c: SavedCard) =>
    Alert.alert(t.cash.removeCard, t.cash.removeConfirm(cardLabel(c)), [
      { text: t.cash.cancel, style: 'cancel' },
      {
        text: t.cash.remove, style: 'destructive', onPress: () => {
          api(`/v1/cards/${c.id}`, { method: 'DELETE' }).then(() => {
            setCards((cs) => (cs ?? []).filter((x) => x.id !== c.id))
            if (selected === c.id) setSelected(null)
          }, fail)
        },
      },
    ])

  const chooseAmount = async () => {
    if (!card || !tariff) return
    const a = await askAmount({
      title: t.cash.amountTitle, balance: state.balance, confirmLabel: t.cash.continue, initial: preset,
      recipient: { name: cardLabel(card), subtitle: t.cash.maxHint(fmt(tariff.cardTopupMax)), icon: 'card' },
    })
    if (a) setAmount(a)
  }

  const start = async () => {
    if (!card || !amount) return
    const pin = await askPin({ amount, label: t.cash.topupPin(cardLabel(card)) })
    if (!pin) return
    setBusy(true)
    try {
      const res = await api<TopupStart>('/v1/topups', { body: { cardId: card.id, amount, pin, clientId: uid() } })
      setAmount(null)
      setOtp('')
      setPending({ topup: res.topup, hint: res.otpHint })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const res = await api<TopupResult>(`/v1/topups/${pending.topup.id}/confirm`, { body: { otp } })
      settled(res.money)
      setPending(null)
      toast(t.cash.topupDone(fmt(res.topup.amount)))
      router.back()
    } catch (e) {
      fail(e)
      // A declined or used-up top-up can't be retried with another code.
      if (errorCode(e) === 'CARD_DECLINED' || errorCode(e) === 'CONFLICT') setPending(null)
      setOtp('')
    } finally {
      setBusy(false)
    }
  }

  const fee = tariff && amount ? cardTopupFee(tariff, amount) : 0
  return (
    <Screen footer={!adding && card ? (
      <View style={s.footer}><Button label={t.cash.continue} onPress={chooseAmount} disabled={busy || !tariff} /></View>
    ) : undefined}>
      <Header title={t.cash.topupTitle} />
      {!cards ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <View style={s.column}>
          {cards.length > 0 && (
            <>
              <Text style={s.section}>{t.cash.yourCards}</Text>
              <Card style={{ paddingVertical: 4 }}>
                {cards.map((c, i) => (
                  <ListRow key={c.id} last={i === cards.length - 1} onPress={() => { setSelected(c.id); setAdding(false) }}
                    left={<Avatar name={c.brand} icon="card" color={c.brand === 'visa' ? '#1A1F71' : '#EB001B'} size={42} />}
                    title={cardLabel(c)} subtitle={`${c.holderName} · ${t.cash.expires(`${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(2)}`)}`}
                    right={
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Pressable accessibilityRole="button" accessibilityLabel={t.cash.removeCard} onPress={() => removeCard(c)} hitSlop={8}>
                          <Icon name="trash-outline" size={20} color={colors.muted} />
                        </Pressable>
                        <Icon name={selected === c.id && !adding ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected === c.id && !adding ? colors.primary : colors.muted} />
                      </View>
                    } />
                ))}
              </Card>
            </>
          )}
          {cards.length === 0 && <Text style={s.empty}>{t.cash.noCards}</Text>}

          {adding ? (
            <Card style={s.form}>
              <Text style={s.formTitle}>{t.cash.addCard}</Text>
              <Text style={s.label}>{t.cash.cardNumber}</Text>
              <View style={s.inputRow}>
                <TextInput style={[s.input, { flex: 1 }]} value={formatCardNumber(form.number)} onChangeText={(v) => setForm({ ...form, number: v })}
                  keyboardType="number-pad" placeholder="4242 4242 4242 4242" placeholderTextColor={colors.muted} maxLength={23}
                  accessibilityLabel={t.cash.cardNumber} autoComplete="cc-number" />
                {brand && <Text style={s.brand}>{brandName(brand)}</Text>}
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{t.cash.expiry}</Text>
                  <TextInput style={s.input} value={form.expiry} onChangeText={(v) => setForm({ ...form, expiry: maskExpiry(v) })}
                    keyboardType="number-pad" placeholder="MM/YY" placeholderTextColor={colors.muted} maxLength={5} accessibilityLabel={t.cash.expiry} autoComplete="cc-exp" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{t.cash.cvv}</Text>
                  <TextInput style={s.input} value={form.cvv} onChangeText={(v) => setForm({ ...form, cvv: v.replace(/\D/g, '').slice(0, 3) })}
                    keyboardType="number-pad" placeholder="123" placeholderTextColor={colors.muted} maxLength={3} secureTextEntry accessibilityLabel={t.cash.cvv} autoComplete="cc-csc" />
                </View>
              </View>
              <Text style={s.label}>{t.cash.holder}</Text>
              <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoCapitalize="words" accessibilityLabel={t.cash.holder} autoComplete="cc-name" />
              <View style={s.safety}>
                <Icon name="lock-closed" size={16} color={colors.muted} />
                <Text style={s.safetyText}>{t.cash.cardSafety}</Text>
              </View>
              <Button label={t.cash.saveCard} onPress={addCard} disabled={busy} />
              {cards.length > 0 && <Button label={t.cash.cancel} variant="ghost" onPress={() => setAdding(false)} />}
            </Card>
          ) : (
            <Button label={t.cash.addCard} icon="add" variant="ghost" onPress={() => setAdding(true)} />
          )}
        </View>
      )}

      <Sheet visible={amount !== null} title={t.cash.summary} onClose={() => setAmount(null)}>
        {card && amount !== null && (
          <View style={{ gap: 10 }}>
            <Row label={t.cash.youReceive} value={fmt(amount)} strong />
            <Row label={t.cash.fee} value={fmt(fee)} />
            <Row label={t.cash.cardCharged} value={`${fmt(amount + fee)} · ${cardLabel(card)}`} />
            <Button label={t.cash.confirm} onPress={start} disabled={busy} />
          </View>
        )}
      </Sheet>

      <Sheet typing visible={!!pending} title={t.cash.otpTitle} onClose={() => setPending(null)}>
        {pending && (
          <View style={{ gap: 10 }}>
            <Text style={s.hint}>{pending.hint}</Text>
            <TextInput style={[s.input, s.otp]} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad" maxLength={6} placeholder="••••••" placeholderTextColor={colors.muted} autoFocus
              accessibilityLabel={t.cash.otpLabel} autoComplete="sms-otp" textContentType="oneTimeCode" />
            <Button label={t.cash.confirm} onPress={confirm} disabled={busy || otp.length < 4} />
          </View>
        )}
      </Sheet>
    </Screen>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && { fontSize: 20, fontWeight: '800' }]}>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  empty: { color: colors.muted, textAlign: 'center', marginVertical: 16 },
  form: { marginTop: 14, gap: 6 },
  formTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, height: 54, paddingHorizontal: 14, fontSize: 17, fontWeight: '600', color: colors.text },
  brand: { fontSize: 13, fontWeight: '800', color: colors.primary },
  safety: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10 },
  safetyText: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  footer: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  hint: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  otp: { textAlign: 'center', fontSize: 26, letterSpacing: 8 },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
})
