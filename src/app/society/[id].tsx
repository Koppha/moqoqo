import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { MoneyResult, SocietyDetail, SocietyMember, SocietyTransfer } from '../../../shared/api'
import { KIND_LOOK } from '../../components/icons'
import { Sheet } from '../../components/Sheet'
import { ActionButton, Avatar, Button, Card, Header, Icon, ListRow, Pill, Screen, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { fmt, uid } from '../../lib/format'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * Society (Mekhatlo), step 2: the society's balance and what I can do. Everyone pays in and sees recent
 * transactions. Executives (signatories) add and remove members, make payments from the society, and approve or
 * reject each other's payments; a payment moves once enough executives approve. A Motšelo (monthly contribution)
 * also shows who has paid this month, and executives can remind the rest.
 */
export default function Society() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const t = useT()
  const moqoqo = useMoqoqo()
  const { state, toast, settled } = moqoqo
  const { askAmount, askPin } = useDialogs()
  const [d, setD] = useState<SocietyDetail | null>(null)
  const [sheet, setSheet] = useState<'add' | 'pay' | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [executive, setExecutive] = useState(false)
  const [busy, setBusy] = useState(false)
  const clientId = useRef(uid())
  // Rules from the server ("needs at least 2 executives", "the society has M20") say exactly what went wrong.
  const fail = (e: unknown) => (e instanceof ApiFailure && (e.code === 'VALIDATION' || e.code === 'CONFLICT') ? toast(e.message) : moqoqo.fail(e))

  const load = useCallback(() => {
    api<SocietyDetail>(`/v1/societies/${id}`).then(setD).catch(() => setD(null))
  }, [id])
  useFocusEffect(load)

  if (!d) return <Screen><Header title={t.society.title} /><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>
  const exec = d.myRole === 'signatory'
  const pending = d.transfers.filter((x) => x.status === 'pending')
  const done = d.transfers.filter((x) => x.status !== 'pending').slice(0, 5)
  const monthly = d.contribution != null
  const paidCount = d.members.filter((m) => m.paidThisMonth).length
  const iPaid = d.members.some((m) => m.user.id === state.me?.id && m.paidThisMonth)

  const payIn = async () => {
    const value = await askAmount({ title: t.society.payInTitle(d.name), balance: state.balance, recipient: { name: d.name, subtitle: `${t.society.kinds[d.kind]} ${d.code}`, icon: KIND_LOOK[d.kind].icon, color: KIND_LOOK[d.kind].color }, confirmLabel: t.dialogs.continue, initial: monthly && !iPaid ? d.contribution : undefined })
    if (!value) return
    const pin = await askPin({ amount: value, label: t.society.payInTitle(d.name) })
    if (!pin) return
    try {
      settled(await api<MoneyResult>(`/v1/societies/${id}/contributions`, { body: { amount: value, pin } }))
      toast(t.society.payInDone)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const payOut = async () => {
    const value = Number(amount)
    setSheet(null)
    const pin = await askPin({ amount: value, label: `${t.society.payOutTitle} · ${to.trim()}` })
    if (!pin) return
    setBusy(true)
    try {
      const res = await api<SocietyTransfer>(`/v1/societies/${id}/transfers`, { body: { to: to.trim(), amount: value, note: note.trim() || undefined, pin, clientId: clientId.current } })
      clientId.current = uid()
      setTo('')
      setAmount('')
      setNote('')
      toast(res.status === 'paid' ? t.society.paid : t.society.payOutSent)
      load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const decide = async (x: SocietyTransfer, action: 'approve' | 'reject') => {
    const pin = await askPin({ amount: x.amount, label: `${action === 'approve' ? t.society.approve : t.society.reject} · ${t.society.decideLabel(x.reference)}` })
    if (!pin) return
    try {
      const res = await api<SocietyTransfer>(`/v1/society-transfers/${x.id}/${action}`, { body: { pin } })
      toast(res.status === 'paid' ? t.society.paid : action === 'approve' ? t.society.approved : t.society.rejected)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const remind = async () => {
    try {
      const r = await api<{ reminded: number }>(`/v1/societies/${id}/remind`, { body: {} })
      toast(t.society.reminded(r.reminded))
    } catch (e) {
      fail(e)
    }
  }

  const addMember = async () => {
    setBusy(true)
    try {
      setD(await api<SocietyDetail>(`/v1/societies/${id}/members`, { body: { to: to.trim(), role: executive ? 'signatory' : 'member' } }))
      setSheet(null)
      setTo('')
      setExecutive(false)
      toast(t.society.added)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const remove = (m: SocietyMember) =>
    Alert.alert(t.society.removeTitle(m.user.name), t.society.removeBody, [
      { text: t.society.cancel, style: 'cancel' },
      {
        text: t.society.remove,
        style: 'destructive',
        onPress: async () => {
          try {
            setD(await api<SocietyDetail>(`/v1/societies/${id}/members/${m.user.id}`, { method: 'DELETE' }))
            toast(t.society.removed)
          } catch (e) {
            fail(e)
          }
        },
      },
    ])

  const open = (s: 'add' | 'pay') => {
    setTo('')
    setSheet(s)
  }

  return (
    <Screen>
      <Header title={d.name} />
      <Card style={s.top}>
        <Text style={s.code}>{t.society.kinds[d.kind]} {d.code} · {t.society.roles[d.myRole]}</Text>
        <Text style={s.label}>{t.society.balance}</Text>
        <Text style={s.balance}>{fmt(d.balance)}</Text>
        <Text style={s.code}>{t.society.members(d.memberCount)}</Text>
        {monthly && (
          <>
            <Text style={s.monthly}>{t.society.monthly(fmt(d.contribution!))} · {t.society.paidCount(paidCount, d.members.length)}</Text>
            <View style={s.track}><View style={[s.fill, { width: `${Math.round((paidCount / Math.max(1, d.members.length)) * 100)}%` }]} /></View>
          </>
        )}
      </Card>

      <View style={s.actions}>
        <ActionButton icon="arrow-down-circle" label={t.society.payIn} onPress={payIn} />
        {exec && <ActionButton icon="arrow-up-circle" label={t.society.payOut} onPress={() => open('pay')} />}
        <ActionButton icon="cash-outline" label={t.society.loans} onPress={() => router.push({ pathname: '/society/loans', params: { id, name: d.name } })} />
        {exec && <ActionButton icon="person-add" label={t.society.addMember} onPress={() => open('add')} />}
        {exec && monthly && paidCount < d.members.length && <ActionButton icon="notifications" label={t.society.remind} onPress={remind} />}
      </View>

      {pending.length > 0 && (
        <>
          <SectionTitle title={t.society.approvals} />
          {pending.map((x) => (
            <Card key={x.id} style={s.transfer}>
              <View style={s.transferHead}>
                <Text style={s.transferAmt}>{fmt(x.amount)}</Text>
                <Pill label={t.society.approvalsOf(x.approvals.length, x.approvalsRequired)} tone="warn" />
              </View>
              <Text style={s.transferTo}>{x.to.businessName ?? x.to.name}{x.note ? ` · ${x.note}` : ''}</Text>
              <Text style={s.muted}>{x.reference} · {t.society.by(x.requestedBy.name)} · {day(x.createdAt)}</Text>
              {x.canDecide && (
                <View style={s.btns}>
                  <Button label={t.society.reject} variant="ghost" onPress={() => decide(x, 'reject')} style={{ flex: 1 }} />
                  <Button label={t.society.approve} onPress={() => decide(x, 'approve')} style={{ flex: 1 }} />
                </View>
              )}
            </Card>
          ))}
        </>
      )}

      <SectionTitle title={t.society.recent} />
      <Card style={{ paddingVertical: 4 }}>
        {d.recent.length === 0 ? <Text style={[s.muted, { padding: 16 }]}>{t.society.noRecent}</Text>
          : d.recent.slice(0, 10).map((x, i, all) => (
            <ListRow key={x.id} last={i === all.length - 1}
              left={<Avatar name={x.who || '?'} icon={x.amount > 0 ? 'arrow-down' : 'arrow-up'} color={x.amount > 0 ? colors.success : colors.primary} size={36} />}
              title={x.who || x.label}
              subtitle={`${x.label} · ${day(x.at)}`}
              right={<Text style={[s.amt, x.amount > 0 && { color: colors.success }]}>{x.amount > 0 ? '+' : '−'}{fmt(Math.abs(x.amount))}</Text>} />
          ))}
      </Card>

      {done.length > 0 && (
        <>
          <SectionTitle title={t.society.payments} />
          <Card style={{ paddingVertical: 4 }}>
            {done.map((x, i) => (
              <ListRow key={x.id} last={i === done.length - 1} title={`${fmt(x.amount)} · ${x.to.businessName ?? x.to.name}`}
                subtitle={`${x.reference} · ${t.society.by(x.requestedBy.name)}`}
                right={<Pill label={t.society.statuses[x.status]} tone={x.status === 'paid' ? 'success' : 'primary'} />} />
            ))}
          </Card>
        </>
      )}

      <SectionTitle title={t.society.membersTitle} />
      <Card style={{ paddingVertical: 4 }}>
        {d.members.map((m, i) => (
          <ListRow key={m.user.id} last={i === d.members.length - 1}
            left={<Avatar name={m.user.name} size={36} photo={m.user.photo} />}
            title={m.user.id === state.me?.id ? `${m.user.name} ✓` : m.user.name}
            subtitle={t.society.roles[m.role]}
            right={
              <View style={s.memberRight}>
                {monthly && <Pill label={m.paidThisMonth ? t.society.paidMonth : t.society.dueMonth} tone={m.paidThisMonth ? 'success' : 'warn'} />}
                {exec && m.user.id !== state.me?.id && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t.society.removeTitle(m.user.name)} onPress={() => remove(m)} hitSlop={10}>
                    <Icon name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                )}
              </View>
            } />
        ))}
      </Card>

      <Sheet typing visible={sheet === 'add'} title={t.society.addTitle} onClose={() => setSheet(null)}>
        <TextInput style={s.input} value={to} onChangeText={setTo} placeholder={t.society.to} placeholderTextColor={colors.muted}
          autoCapitalize="none" autoCorrect={false} accessibilityLabel={t.society.to} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: executive }} onPress={() => setExecutive((v) => !v)} style={s.check}>
          <Icon name={executive ? 'checkbox' : 'square-outline'} size={22} color={executive ? colors.primary : colors.muted} />
          <Text style={s.checkText}>{t.society.makeExecutive}</Text>
        </Pressable>
        <Button label={t.society.addMember} disabled={busy || !to.trim()} onPress={addMember} />
      </Sheet>

      <Sheet typing visible={sheet === 'pay'} title={t.society.payOutTitle} onClose={() => setSheet(null)}>
        <TextInput style={s.input} value={to} onChangeText={setTo} placeholder={t.society.to} placeholderTextColor={colors.muted}
          autoCapitalize="none" autoCorrect={false} accessibilityLabel={t.society.to} />
        <TextInput style={s.input} value={amount} onChangeText={(v) => setAmount(cleanAmount(v))} placeholder="M 0.00" placeholderTextColor={colors.muted}
          keyboardType="decimal-pad" maxLength={9} accessibilityLabel={t.society.payOut} />
        <TextInput style={s.input} value={note} onChangeText={setNote} placeholder={t.society.note} placeholderTextColor={colors.muted}
          maxLength={60} accessibilityLabel={t.society.note} />
        <Text style={[s.muted, { marginBottom: 12 }]}>{t.society.payOutNeeds(d.approvalsRequired)}</Text>
        <Button label={t.society.next} disabled={busy || !to.trim() || !(Number(amount) > 0)} onPress={payOut} />
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  top: { alignItems: 'center', paddingVertical: 20 },
  code: { fontSize: 13.5, color: colors.muted },
  label: { fontSize: 14, color: colors.muted, marginTop: 14 },
  balance: { fontSize: 36, fontWeight: '800', color: colors.text, marginVertical: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 16 },
  transfer: { marginBottom: 10 },
  transferHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transferAmt: { fontSize: 20, fontWeight: '800', color: colors.text },
  transferTo: { fontSize: 15, color: colors.text, marginTop: 4 },
  muted: { fontSize: 13, color: colors.muted, marginTop: 2 },
  btns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  amt: { fontSize: 15, fontWeight: '700', color: colors.text },
  monthly: { fontSize: 13.5, color: colors.text, fontWeight: '600', marginTop: 12 },
  track: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', marginTop: 8, marginHorizontal: 24 },
  fill: { height: '100%', backgroundColor: colors.success },
  memberRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text, marginBottom: 12 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  checkText: { flex: 1, fontSize: 14.5, color: colors.text },
})
