import { router, useLocalSearchParams } from 'expo-router'
import { localNumber } from '../../../shared/api'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Message as ApiMessage, MoneyResult, PublicUser } from '../../../shared/api'
import { Avatar, Button, Card, Header, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { fmt, maskMsisdn } from '../../lib/format'
import { FORM_MAX } from '../../lib/layout'
import { useMoqoqo } from '../../state/useMoqoqo'
import { useDialogs } from '../../state/Dialogs'
import { colors, radius } from '../../theme'

type Kind = 'cash-in' | 'cash-out' | 'charge' | 'register'
const VALID = /^[56]\d{7}$/

/**
 * One screen for every business action: find the customer by number, then
 * cash in (agent's float → customer, agent's PIN), cash out (customer approves in chat),
 * charge (merchant asks the customer to pay, in chat) or register a new wallet.
 */
export default function BusinessAction() {
  const { kind } = useLocalSearchParams<{ kind: Kind }>()
  const t = useT()
  const { state, dispatch, toast, fail, settled } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [number, setNumber] = useState('')
  const [customer, setCustomer] = useState<PublicUser | null>(null)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = { 'cash-in': t.biz.cashIn, 'cash-out': t.biz.cashOut, charge: t.biz.charge, register: t.biz.register }[kind] ?? ''
  const msisdn = '+266' + number

  const find = async () => {
    setError(null)
    setBusy(true)
    try {
      setCustomer(await api<PublicUser>(`/v1/users/lookup?msisdn=${encodeURIComponent(msisdn)}`))
    } catch (e) {
      setError(t.errors[e instanceof ApiFailure ? e.code : 'UNKNOWN'])
    }
    setBusy(false)
  }

  const go = async () => {
    if (kind === 'register') {
      setBusy(true)
      try {
        await api<PublicUser>('/v1/agent/register', { body: { msisdn, name: name.trim(), pin } })
        toast(t.biz.registered(name.trim()))
        router.back()
      } catch (e) {
        fail(e)
      }
      setBusy(false)
      return
    }
    if (!customer) return
    const recipient = { name: customer.name, subtitle: maskMsisdn(customer.msisdn) }
    const amountTitle = kind === 'cash-in' ? t.biz.cashInFor(customer.name) : kind === 'cash-out' ? t.biz.cashOutFor(customer.name) : t.biz.chargeFor(customer.name)
    const amount = await askAmount({ title: amountTitle, balance: state.balance, recipient, confirmLabel: t.dialogs.continue })
    if (!amount) return
    try {
      if (kind === 'cash-in') {
        const agentPin = await askPin({ amount, label: t.biz.cashInFor(customer.name) })
        if (!agentPin) return
        settled(await api<MoneyResult>('/v1/agent/cash-in', { body: { customerMsisdn: msisdn, amount, pin: agentPin } }))
        toast(t.biz.cashInDone(fmt(amount), customer.name))
        router.back()
      } else {
        // Cash out and charges become a request in the chat with the customer; follow it there.
        const message = kind === 'cash-out'
          ? await api<ApiMessage>('/v1/agent/cash-out', { body: { customerMsisdn: msisdn, amount } })
          : await api<ApiMessage>('/v1/merchant/charge', { body: { customerMsisdn: msisdn, amount, note: note.trim() || undefined } })
        dispatch({ type: 'message', message })
        toast(kind === 'cash-out' ? t.biz.cashOutSent(customer.name) : t.biz.chargeSent(customer.name))
        router.replace(`/chat/${message.chatId}`)
      }
    } catch (e) {
      fail(e)
    }
  }

  const ready = kind === 'register' ? VALID.test(number) && name.trim().length >= 3 && /^\d{4}$/.test(pin) : !!customer

  return (
    <Screen scroll>
      <Header title={title} />
      <View style={s.form}>
        <Text style={s.label}>{t.biz.customerNumber}</Text>
        <View style={s.field}>
          <Text style={s.prefix}>+266</Text>
          <TextInput style={s.input} value={number} keyboardType="number-pad" maxLength={20} placeholder="6200 0021" placeholderTextColor={colors.muted}
            accessibilityLabel={t.biz.customerNumber} autoFocus
            onChangeText={(v) => { setNumber(localNumber(v)); setCustomer(null); setError(null) }}
            onSubmitEditing={() => kind !== 'register' && VALID.test(number) && find()} />
        </View>

        {kind === 'register' ? (
          <>
            <Text style={s.label}>{t.biz.customerName}</Text>
            <TextInput style={[s.field, s.input, s.plain]} value={name} onChangeText={setName} autoCapitalize="words" accessibilityLabel={t.biz.customerName} />
            <Text style={s.label}>{t.biz.newPin}</Text>
            <TextInput style={[s.field, s.input, s.plain]} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad" secureTextEntry maxLength={4} accessibilityLabel={t.biz.newPin} />
            <Text style={s.hint}>{t.biz.registerHint}</Text>
          </>
        ) : (
          <>
            {!customer && <Button label={t.biz.find} icon="search" variant="ghost" disabled={!VALID.test(number) || busy} onPress={find} />}
            {busy && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}
            {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
            {customer && (
              <Card style={s.customer}>
                <Avatar name={customer.name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={s.customerName}>{t.biz.found(customer.name)}</Text>
                  <Text style={s.customerNumber}>{maskMsisdn(customer.msisdn)}</Text>
                </View>
              </Card>
            )}
            {customer && kind === 'charge' && (
              <>
                <Text style={s.label}>{t.biz.note}</Text>
                <TextInput style={[s.field, s.input, s.plain]} value={note} onChangeText={setNote} maxLength={80} accessibilityLabel={t.biz.note} />
              </>
            )}
          </>
        )}
        <Button label={kind === 'register' ? t.biz.register : t.dialogs.continue} disabled={!ready || busy} onPress={go} style={{ marginTop: 24 }} />
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  form: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', paddingTop: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8, marginTop: 18 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, height: 56 },
  plain: { fontSize: 17 },
  prefix: { fontSize: 17, fontWeight: '600', color: colors.text, marginRight: 10 },
  input: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text },
  hint: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
  error: { color: colors.danger, fontSize: 13.5, marginTop: 12 },
  customer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 14 },
  customerName: { fontSize: 15, fontWeight: '700', color: colors.text },
  customerNumber: { fontSize: 13, color: colors.muted, marginTop: 2 },
})
