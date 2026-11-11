import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Image, StyleSheet, Text, TextInput } from 'react-native'
import { localNumber, type StopOrder, type StopOrderRun } from '../../../shared/api'
import { Sheet, SheetOption } from '../../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen, SectionTitle, type IconName } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { fmt, maskMsisdn } from '../../lib/format'
import { removeRecipient, removeSavedBill, saveRecipient, useSavedBills, useSavedRecipients } from '../../lib/saved'
import { apiUrl } from '../../lib/server'
import { useLocalized } from '../../lib/services'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

/** Me › Stop orders: payments that go by themselves on their day, and the saved bills and people they pay. */
export default function StopOrders() {
  const t = useT()
  const L = useLocalized()
  const { toast, fail } = useMoqoqo()
  const [orders, setOrders] = useState<StopOrder[] | null>(null)
  const { bills, reload: reloadBills } = useSavedBills()
  const { people, reload: reloadPeople } = useSavedRecipients()
  const [open, setOpen] = useState<StopOrder | null>(null)
  const [runs, setRuns] = useState<StopOrderRun[]>([])
  const [adding, setAdding] = useState(false)
  const [number, setNumber] = useState('')
  const [nickname, setNickname] = useState('')

  const load = useCallback(() => {
    api<StopOrder[]>('/v1/stop-orders').then(setOrders, () => setOrders((o) => o ?? []))
    reloadBills()
    reloadPeople()
  }, [reloadBills, reloadPeople])
  useFocusEffect(load)

  const oops = (e: unknown) => (e instanceof ApiFailure && e.message ? toast(e.message) : fail(e))

  const show = async (o: StopOrder) => {
    setOpen(o)
    setRuns([])
    api<StopOrderRun[]>(`/v1/stop-orders/${o.id}/runs`).then(setRuns, () => {})
  }
  const setStatus = async (o: StopOrder, status: 'active' | 'paused') => {
    try {
      await api(`/v1/stop-orders/${o.id}`, { method: 'PUT', body: { status } })
      setOpen(null)
      load()
    } catch (e) {
      oops(e)
    }
  }
  const cancel = (o: StopOrder) =>
    Alert.alert(t.stopOrders.cancelTitle(o.label), t.stopOrders.cancelBody, [
      { text: t.stopOrders.keep, style: 'cancel' },
      { text: t.stopOrders.cancel, style: 'destructive', onPress: () => api(`/v1/stop-orders/${o.id}`, { method: 'DELETE' }).then(() => { setOpen(null); load() }, oops) },
    ])

  const addPerson = async () => {
    try {
      await saveRecipient('+266' + localNumber(number), nickname.trim())
      setAdding(false)
      setNumber('')
      setNickname('')
      reloadPeople()
    } catch (e) {
      oops(e)
    }
  }

  const schedule = (o: StopOrder) => t.stopOrders.schedule(o.frequency, o.day)
  const active = (orders ?? []).filter((o) => o.status !== 'ended')

  return (
    <Screen>
      <Header title={t.stopOrders.title} />
      <Text style={s.intro}>{t.stopOrders.intro}</Text>
      <Button label={t.stopOrders.new} icon="add" onPress={() => router.push('/stop-orders/new')} />

      <SectionTitle title={t.stopOrders.mine} />
      <Card style={{ paddingVertical: 4 }}>
        {active.length === 0 ? <Text style={s.none}>{t.stopOrders.none}</Text> : active.map((o, i) => (
          <ListRow key={o.id} last={i === active.length - 1} onPress={() => show(o)}
            left={<Avatar name={o.label} icon={o.kind === 'bill' ? 'receipt' : 'person'} color={o.status === 'paused' ? colors.muted : colors.primary} size={42} />}
            title={`${fmt(o.amount)} · ${o.label}`}
            subtitle={o.status === 'paused' ? t.stopOrders.paused : `${schedule(o)} · ${t.stopOrders.next(o.nextRun)}${o.last?.status === 'retrying' ? ` · ${t.stopOrders.retrying}` : ''}`}
            right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
        ))}
      </Card>

      <SectionTitle title={t.saved.billsTitle} />
      <Card style={{ paddingVertical: 4 }}>
        {bills.length === 0 ? <Text style={s.none}>{t.saved.billsNone}</Text> : bills.map((b, i) => (
          <ListRow key={b.id} last={i === bills.length - 1}
            left={b.image ? <Image source={{ uri: apiUrl() + b.image }} style={s.logo} accessibilityIgnoresInvertColors /> : <Avatar name={b.nickname} icon={b.icon as IconName} color={b.color} size={40} />}
            title={b.nickname} subtitle={`${L(b.billerName)} · ${b.account}`}
            right={<Icon name="trash-outline" size={20} color={colors.muted} />}
            onPress={() => Alert.alert(t.saved.removeTitle(b.nickname), '', [
              { text: t.stopOrders.keep, style: 'cancel' },
              { text: t.saved.remove, style: 'destructive', onPress: () => removeSavedBill(b.id).then(reloadBills, oops) },
            ])} />
        ))}
      </Card>

      <SectionTitle title={t.saved.peopleTitle} action="add" onAction={() => setAdding(true)} />
      <Card style={{ paddingVertical: 4 }}>
        {people.length === 0 ? <Text style={s.none}>{t.saved.peopleNone}</Text> : people.map((p, i) => (
          <ListRow key={p.id} last={i === people.length - 1} left={<Avatar name={p.user.name} photo={p.user.photo} size={40} />}
            title={p.nickname || p.user.name} subtitle={`${p.nickname ? `${p.user.name} · ` : ''}${maskMsisdn(p.user.msisdn)}`}
            right={<Icon name="trash-outline" size={20} color={colors.muted} />}
            onPress={() => Alert.alert(t.saved.removeTitle(p.nickname || p.user.name), '', [
              { text: t.stopOrders.keep, style: 'cancel' },
              { text: t.saved.remove, style: 'destructive', onPress: () => removeRecipient(p.id).then(reloadPeople, oops) },
            ])} />
        ))}
      </Card>

      <Sheet visible={!!open} title={open?.label} onClose={() => setOpen(null)}>
        {open && (
          <>
            <Text style={s.sheetLine}>{fmt(open.amount)} · {schedule(open)}</Text>
            <Text style={s.sheetMuted}>{open.status === 'paused' ? t.stopOrders.paused : t.stopOrders.next(open.nextRun)}{open.remaining !== undefined ? ` · ${t.stopOrders.left(open.remaining)}` : ''}</Text>
            {runs.slice(0, 5).map((r) => (
              <Text key={r.id} style={s.run}>{r.dueOn} · {fmt(r.amount)} · {t.stopOrders.runStatus[r.status]}{r.error ? ` (${r.error})` : ''}</Text>
            ))}
            {open.status === 'active'
              ? <SheetOption icon="pause" color="#D97706" title={t.stopOrders.pause} subtitle={t.stopOrders.pauseHint} onPress={() => setStatus(open, 'paused')} />
              : <SheetOption icon="play" color="#16A34A" title={t.stopOrders.resume} subtitle={t.stopOrders.resumeHint} onPress={() => setStatus(open, 'active')} />}
            <SheetOption icon="close-circle" color={colors.danger} title={t.stopOrders.cancel} subtitle="" onPress={() => cancel(open)} />
          </>
        )}
      </Sheet>

      <Sheet typing visible={adding} title={t.saved.addPerson} onClose={() => setAdding(false)}>
        <TextInput style={s.input} value={number} onChangeText={(v) => setNumber(localNumber(v))} keyboardType="number-pad" placeholder="6200 0021"
          placeholderTextColor={colors.muted} accessibilityLabel={t.saved.number} />
        <TextInput style={[s.input, { marginTop: 10 }]} value={nickname} onChangeText={setNickname} maxLength={30} placeholder={t.saved.nicknameOptional}
          placeholderTextColor={colors.muted} accessibilityLabel={t.saved.nicknameOptional} />
        <Button label={t.saved.save} icon="bookmark" disabled={!/^[56]\d{7}$/.test(number)} onPress={addPerson} />
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  none: { color: colors.muted, padding: 16, lineHeight: 20 },
  logo: { width: 40, height: 40, borderRadius: 20 },
  sheetLine: { fontSize: 17, fontWeight: '700', color: colors.text },
  sheetMuted: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 8 },
  run: { fontSize: 13, color: colors.text, paddingVertical: 3 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text },
})
