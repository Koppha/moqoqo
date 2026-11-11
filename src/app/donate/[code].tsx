import * as Linking from 'expo-linking'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import type { Cause, MoneyResult } from '../../../shared/api'
import { Sheet, SheetOption } from '../../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Pill, Screen, SectionTitle } from '../../components/ui'
import { iconForChat } from '../../components/icons'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { fmt, uid } from '../../lib/format'
import { useChats } from '../../state/AppState'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors } from '../../theme'

const PINK = '#DB2777'
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * A cause: its story and progress, who gave, and Give. Anyone with the link or code can open it. The organiser also
 * shares it, withdraws what it holds to their wallet, and closes it.
 */
export default function CauseScreen() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const t = useT()
  const moqoqo = useMoqoqo()
  const { state, toast, settled } = moqoqo
  const { askAmount, askPin } = useDialogs()
  const chats = useChats()
  const [c, setC] = useState<Cause | null>(null)
  const [missing, setMissing] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [picking, setPicking] = useState(false)
  const clientId = useRef(uid())
  const fail = (e: unknown) => (e instanceof ApiFailure && ['VALIDATION', 'CONFLICT', 'FORBIDDEN'].includes(e.code) ? toast(e.message) : moqoqo.fail(e))

  const load = useCallback(() => {
    api<Cause>(`/v1/causes/${code}`).then(setC).catch(() => setMissing(true))
  }, [code])
  useFocusEffect(load)

  if (!c) {
    return (
      <Screen>
        <Header title={t.donate.title} />
        {missing ? <Text style={s.muted}>{t.errors.NOT_FOUND}</Text> : <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}
      </Screen>
    )
  }
  const pct = Math.min(100, Math.round((c.raised / c.target) * 100))
  const open = c.status === 'open'

  const give = async () => {
    const amount = await askAmount({ title: t.donate.giveTitle(c.title), balance: state.balance, recipient: { name: c.title, subtitle: t.donate.by(c.organiser.name), icon: 'heart', color: PINK }, quick: [20, 50, 100, 200], confirmLabel: t.dialogs.continue })
    if (!amount) return
    const pin = await askPin({ amount, label: t.donate.giveTitle(c.title) })
    if (!pin) return
    try {
      settled(await api<MoneyResult>(`/v1/causes/${c.id}/donate`, { body: { amount, anonymous, pin, clientId: clientId.current } }))
      clientId.current = uid()
      toast(t.donate.thanks)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const link = Linking.createURL(`/donate/${c.code}`)
  const shareLink = () => Share.share({ message: t.donate.shareText(c.title, link, c.code) }).catch(() => {})
  const shareTo = async (chatId: string) => {
    setPicking(false)
    try {
      await api(`/v1/causes/${c.id}/share`, { body: { chatId } })
      toast(t.donate.shared)
    } catch (e) {
      fail(e)
    }
  }

  const withdraw = async () => {
    const amount = await askAmount({ title: t.donate.withdrawTitle, balance: c.balance ?? 0, recipient: { name: c.title, subtitle: t.donate.inCause(fmt(c.balance ?? 0)), icon: 'heart', color: PINK }, initial: c.balance, confirmLabel: t.dialogs.continue })
    if (!amount) return
    const pin = await askPin({ amount, label: t.donate.withdrawTitle })
    if (!pin) return
    try {
      settled(await api<MoneyResult>(`/v1/causes/${c.id}/withdraw`, { body: { amount, pin } }))
      toast(t.donate.withdrawn)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const close = () =>
    Alert.alert(t.donate.closeTitle, t.donate.closeBody, [
      { text: t.donate.cancel, style: 'cancel' },
      {
        text: t.donate.close,
        style: 'destructive',
        onPress: async () => {
          try {
            setC(await api<Cause>(`/v1/causes/${c.id}/close`, { body: {} }))
            toast(t.donate.closed)
          } catch (e) {
            fail(e)
          }
        },
      },
    ])

  return (
    <Screen>
      <Header title={t.donate.title} />
      <Card style={s.top}>
        <View style={s.row}>
          <Avatar name={c.title} icon="heart" color={PINK} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{c.title}</Text>
            <Text style={s.muted}>{t.donate.by(c.organiser.name)} · {c.code}</Text>
          </View>
          {!open && <Pill label={t.donate.statuses[c.status]} tone={c.status === 'suspended' ? 'warn' : 'primary'} />}
        </View>
        <Text style={s.raised}>{fmt(c.raised)}</Text>
        <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
        <Text style={s.muted}>{t.donate.raisedOf(fmt(c.raised), fmt(c.target))} · {t.donate.givers(c.donorCount)}{c.endsAt ? ` · ${t.donate.ends(day(c.endsAt))}` : ''}</Text>
        {c.statusReason && !open && <Text style={[s.muted, { marginTop: 6 }]}>{c.statusReason}</Text>}
        <Text style={s.story}>{c.description}</Text>
        {c.myTotal > 0 && <Text style={s.gave}>{t.donate.youGave(fmt(c.myTotal))}</Text>}
      </Card>

      {open && (
        <>
          <Button label={t.donate.give} icon="heart" onPress={give} style={{ marginTop: 14, backgroundColor: PINK }} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: anonymous }} onPress={() => setAnonymous((v) => !v)} style={s.check}>
            <Icon name={anonymous ? 'checkbox' : 'square-outline'} size={22} color={anonymous ? PINK : colors.muted} />
            <Text style={s.checkText}>{t.donate.anonymous}</Text>
          </Pressable>
        </>
      )}
      <View style={s.shareRow}>
        <Button label={t.donate.share} icon="share-social" variant="ghost" onPress={shareLink} style={{ flex: 1 }} />
        <Button label={t.donate.shareChat} icon="chatbubbles" variant="ghost" onPress={() => setPicking(true)} style={{ flex: 1 }} />
      </View>

      {c.mine && (
        <Card style={{ marginTop: 14, paddingVertical: 4 }}>
          <ListRow onPress={withdraw} left={<Avatar name="withdraw" icon="arrow-down-circle" color={colors.success} size={38} />}
            title={t.donate.withdraw} subtitle={t.donate.inCause(fmt(c.balance ?? 0))} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} last={!open} />
          {open && <ListRow last onPress={close} left={<Avatar name="close" icon="close-circle" color={colors.danger} size={38} />} title={t.donate.close} />}
        </Card>
      )}

      <SectionTitle title={t.donate.gifts} />
      <Card style={{ paddingVertical: 4 }}>
        {c.donations.length === 0 ? <Text style={[s.muted, { padding: 16 }]}>{t.donate.noGifts}</Text> : c.donations.map((g, i) => (
          <ListRow key={`${g.at}-${i}`} last={i === c.donations.length - 1} left={<Avatar name={g.name ?? '?'} icon={g.name ? undefined : 'heart'} color={g.name ? undefined : PINK} size={36} />}
            title={g.name ?? t.donate.someone} subtitle={g.note ? `“${g.note}” · ${day(g.at)}` : day(g.at)}
            right={<Text style={s.amount}>{fmt(g.amount)}</Text>} />
        ))}
      </Card>

      <Sheet visible={picking} title={t.donate.pickChat} onClose={() => setPicking(false)}>
        {chats.filter((x) => !x.official).slice(0, 8).map((x) => (
          <SheetOption key={x.id} icon={iconForChat(x) ?? 'chatbubble'} title={x.name} subtitle={x.group ? t.donate.shareChat : x.msisdn ?? ''} onPress={() => shareTo(x.id)} />
        ))}
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  top: { paddingVertical: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  muted: { fontSize: 13, color: colors.muted, marginTop: 2 },
  raised: { fontSize: 32, fontWeight: '800', color: colors.text, marginTop: 16 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden', marginTop: 10, marginBottom: 6 },
  fill: { height: '100%', backgroundColor: PINK },
  story: { fontSize: 15, color: colors.text, lineHeight: 22, marginTop: 14 },
  gave: { fontSize: 13.5, fontWeight: '700', color: PINK, marginTop: 12 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkText: { flex: 1, fontSize: 14, color: colors.text },
  shareRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },
})
