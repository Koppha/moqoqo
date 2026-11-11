import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { localNumber, SEND_MANY_MAX, USERNAME_PATTERN, type PublicUser, type SendManyResult } from '../../shared/api'
import { ContactPickButton } from '../components/ContactPickButton'
import { Avatar, Button, Card, Header, Icon, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt, maskMsisdn, uid } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { useAppState, useChats } from '../state/AppState'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const VALID = /^[56]\d{7}$/
const isUsername = (v: string) => USERNAME_PATTERN.test(v.replace(/^@/, '').toLowerCase())

/** Keeps a typed amount to digits and one decimal point with at most 2 decimals. */
const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
const toCents = (v: string | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** `error`: why this person was not paid on the last try. */
interface Row { user: PublicUser; amount: string; error?: string }

/**
 * Send to many: add people (number, @username, contacts or recent chats), give each an amount or one amount for
 * everyone, then one PIN. Each person is paid on their own: whoever was paid leaves the list, and whoever was not stays
 * with the reason, ready to try again (the same clientId, so no one is paid twice). The money goes in each chat.
 */
export default function SendMany() {
  const t = useT()
  const { state, dispatch } = useAppState()
  const chats = useChats()
  const { toast, fail } = useMoqoqo()
  const { askPin } = useDialogs()
  const [rows, setRows] = useState<Row[]>([])
  const [number, setNumber] = useState('')
  const [adding, setAdding] = useState(false)
  const [same, setSame] = useState(true)
  const [each, setEach] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const clientId = useRef(uid())

  const meId = state.me?.id
  const recent = chats
    .filter((c) => c.kind === 'direct' && !!c.msisdn)
    .map((c) => c.members.find((u) => u.id !== meId && !u.official))
    .filter((u): u is PublicUser => !!u && !rows.some((r) => r.user.id === u.id))
    .slice(0, 8)
  const cents = (r: Row) => toCents(same ? each : r.amount)
  const totalCents = rows.reduce((a, r) => a + cents(r), 0)
  const valid = rows.length > 0 && rows.every((r) => cents(r) > 0)

  const add = (user: PublicUser) => {
    if (user.id === meId) return toast(t.sendMany.self)
    if (rows.some((r) => r.user.id === user.id)) return toast(t.sendMany.already)
    if (rows.length >= SEND_MANY_MAX) return toast(t.sendMany.max)
    setRows((rs) => [...rs, { user, amount: '' }])
  }

  const lookup = async (input: string) => {
    const query = VALID.test(input) ? `msisdn=${encodeURIComponent('+266' + input)}` : `username=${encodeURIComponent(input.replace(/^@/, ''))}`
    setAdding(true)
    try {
      add(await api<PublicUser>(`/v1/users/lookup?${query}`))
      setNumber('')
    } catch (e) {
      fail(e)
    } finally {
      setAdding(false)
    }
  }

  const send = async () => {
    const pin = await askPin({ amount: totalCents / 100, label: t.sendMany.pinLabel(rows.length) })
    if (!pin) return
    setSending(true)
    try {
      const res = await api<SendManyResult>('/v1/payments/send-many', {
        body: {
          recipients: rows.map((r) => ({ to: r.user.msisdn, amount: cents(r) / 100 })),
          pin,
          note: note.trim() || undefined,
          clientId: clientId.current,
        },
      })
      dispatch({ type: 'balance', balance: res.balance })
      const failed = new Map<string, string>()
      for (const p of res.payments) {
        if (p.ok) {
          dispatch({ type: 'transaction', transaction: p.transaction })
          dispatch({ type: 'message', message: p.message })
        } else failed.set(p.to, p.error.code === 'VALIDATION' ? p.error.message : t.errors[p.error.code] ?? p.error.message)
      }
      const sent = res.payments.length - failed.size
      if (!failed.size) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        toast(t.sendMany.sent(fmt(res.total), sent))
        return router.back()
      }
      Haptics.notificationAsync(sent ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error)
      toast(sent ? t.sendMany.partly(fmt(res.total), sent, failed.size) : t.sendMany.noneSent)
      setRows((rs) => rs.filter((r) => failed.has(r.user.msisdn)).map((r) => ({ ...r, error: failed.get(r.user.msisdn) })))
    } catch (e) {
      // The PIN was wrong or the connection dropped. Trying again is safe: the same clientId never pays anyone twice.
      fail(e)
    } finally {
      setSending(false)
    }
  }

  return (
    <Screen
      footer={
        <View style={s.footer}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>{t.sendMany.total} · {t.sendMany.people(rows.length)}</Text>
            <Text style={[s.totalValue, !valid && s.dim]}>{fmt(totalCents / 100)}</Text>
          </View>
          <Button label={(rows.some((r) => r.error) ? t.sendMany.retry : t.sendMany.send)(fmt(totalCents / 100))} disabled={!valid || sending || totalCents / 100 > state.balance} onPress={send} />
        </View>
      }>
      <Header title={t.sendMany.title} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <Card>
          <Text style={s.hint}>{t.sendMany.addHint}</Text>
          <View style={s.numberRow}>
            <View style={s.field}>
              {!number.startsWith('@') && /^\d/.test(number) && <Text style={s.prefix}>+266</Text>}
              <TextInput style={s.input} value={number}
                onChangeText={(v) => setNumber(/^[\d+(]/.test(v.trim()) ? localNumber(v) : v.replace(/[^@A-Za-z0-9._]/g, '').slice(0, 21))}
                autoCapitalize="none" autoCorrect={false} placeholder={t.svc.numberOrUsername} placeholderTextColor={colors.muted}
                accessibilityLabel={t.svc.ecocashNumber} returnKeyType="done"
                onSubmitEditing={() => (VALID.test(number) || isUsername(number)) && lookup(number)} />
              <ContactPickButton onPick={(n) => lookup(n)} />
            </View>
            <Button label={t.sendMany.add} disabled={adding || (!VALID.test(number) && !isUsername(number))} onPress={() => lookup(number)} style={{ paddingHorizontal: 18 }} />
          </View>
          {recent.length > 0 && (
            <>
              <Text style={s.sub}>{t.sendMany.recent}</Text>
              <View style={s.chips}>
                {recent.map((u) => (
                  <Pressable key={u.id} accessibilityRole="button" onPress={() => add(u)} style={s.chip}>
                    <Icon name="add" size={16} color={colors.primary} />
                    <Text style={s.chipText} numberOfLines={1}>{u.businessName ?? u.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <View style={s.sameRow}>
            <Text style={s.sameLabel}>{t.sendMany.sameAmount}</Text>
            <Switch value={same} onValueChange={setSame} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff"
              accessibilityLabel={t.sendMany.sameAmount} />
          </View>
          {same && (
            <View style={s.eachRow}>
              <Text style={s.eachLabel}>{t.sendMany.amountEach}</Text>
              <Text style={s.currency}>M</Text>
              <TextInput style={s.eachInput} value={each} onChangeText={(v) => setEach(cleanAmount(v))} keyboardType="decimal-pad"
                placeholder="0.00" placeholderTextColor={colors.muted} accessibilityLabel={t.sendMany.amountEach} maxLength={9} />
            </View>
          )}
        </Card>

        <Text style={s.section}>{t.sendMany.people(rows.length)}</Text>
        <Card style={{ paddingVertical: rows.length ? 4 : undefined }}>
          {!rows.length && <Text style={s.empty}>{t.sendMany.empty}</Text>}
          {rows.map((r, i) => {
            const name = r.user.businessName ?? r.user.name
            return (
              <View key={r.user.id} style={[s.person, i < rows.length - 1 && s.divider]}>
                <Avatar name={name} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={s.personName} numberOfLines={1}>{name}</Text>
                  <Text style={s.personSub}>{maskMsisdn(r.user.msisdn)}</Text>
                  {r.error && <Text style={s.personError}>{r.error}</Text>}
                </View>
                {same ? (
                  <Text style={s.personAmount}>{each ? fmt(cents(r) / 100) : '—'}</Text>
                ) : (
                  <View style={s.amountWrap}>
                    <Text style={s.currency}>M</Text>
                    <TextInput style={s.amountInput} value={r.amount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted}
                      onChangeText={(v) => setRows((rs) => rs.map((x) => (x.user.id === r.user.id ? { ...x, amount: cleanAmount(v) } : x)))}
                      accessibilityLabel={t.sendMany.amountFor(name)} maxLength={9} />
                  </View>
                )}
                <Pressable accessibilityRole="button" accessibilityLabel={t.sendMany.remove(name)} hitSlop={8}
                  onPress={() => setRows((rs) => rs.filter((x) => x.user.id !== r.user.id))}>
                  <Icon name="close-circle" size={22} color={colors.muted} />
                </Pressable>
              </View>
            )
          })}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <TextInput style={s.note} value={note} onChangeText={setNote} placeholder={t.sendMany.notePlaceholder} placeholderTextColor={colors.muted}
            maxLength={140} accessibilityLabel={t.sendMany.notePlaceholder} />
        </Card>
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  hint: { fontSize: 13, color: colors.muted, marginBottom: 10 },
  numberRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 12, backgroundColor: colors.surface },
  prefix: { fontSize: 16, fontWeight: '600', color: colors.text, marginRight: 8 },
  input: { flex: 1, fontSize: 17, color: colors.text, letterSpacing: 1 },
  sub: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160, paddingVertical: 7, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  chipText: { color: colors.primary, fontWeight: '600', fontSize: 13.5, flexShrink: 1 },
  sameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sameLabel: { fontSize: 15.5, fontWeight: '600', color: colors.text },
  eachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  eachLabel: { flex: 1, fontSize: 15, color: colors.text },
  eachInput: { minWidth: 90, textAlign: 'right', fontSize: 18, fontWeight: '700', color: colors.text, paddingVertical: 6 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  empty: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  personName: { fontSize: 15.5, fontWeight: '600', color: colors.text },
  personSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  personError: { fontSize: 12.5, color: colors.danger, marginTop: 3 },
  personAmount: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  amountWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.sm, backgroundColor: colors.surface2, paddingHorizontal: 10 },
  amountInput: { minWidth: 64, textAlign: 'right', fontSize: 16, fontWeight: '600', color: colors.text, paddingVertical: 8 },
  currency: { fontSize: 15, color: colors.text, fontWeight: '600' },
  note: { fontSize: 15.5, color: colors.text, paddingVertical: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', gap: 10 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, color: colors.muted },
  totalValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  dim: { color: colors.muted },
})
