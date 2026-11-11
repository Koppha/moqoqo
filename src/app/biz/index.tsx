import { LinearGradient } from 'expo-linear-gradient'
import { router, useFocusEffect, type Href } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AgentSummary, MerchantSummary, Transaction as ApiTransaction } from '../../../shared/api'
import { TxIcon } from '../../components/TxIcon'
import { NoticeBanners } from '../../components/Maintenance'
import { useLightStatusBar } from '../../components/useLightStatusBar'
import { ActionButton, Avatar, Card, ListRow, SectionTitle, type IconName } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { useServices } from '../../lib/services'
import { fmt } from '../../lib/format'
import { CONTENT_MAX } from '../../lib/layout'
import { dayLabel, toMessage } from '../../lib/mappers'
import { useAppState } from '../../state/AppState'
import { colors, gradients, radius } from '../../theme'

/**
 * Business home: agents see float and today's cash in/out; merchants see today's sales and who still has to pay.
 * Both can take cash out at an ATM (agents from their float, merchants from their takings).
 */
export default function BusinessHome() {
  const t = useT()
  const { services } = useServices()
  const insets = useSafeAreaInsets()
  const { state } = useAppState()
  const me = state.me
  const isAgent = me?.role === 'agent'
  const [agent, setAgent] = useState<AgentSummary | null>(null)
  const [merchant, setMerchant] = useState<MerchantSummary | null>(null)
  useLightStatusBar()

  // Refresh on focus and whenever money moves or a message changes (a customer approved or paid).
  const msgCount = Object.values(state.messages).reduce((n, list) => n + list.length, 0)
  useFocusEffect(useCallback(() => {
    if (!me) return
    const load = isAgent
      ? api<AgentSummary>('/v1/agent/summary').then(setAgent)
      : api<MerchantSummary>('/v1/merchant/summary').then(setMerchant)
    load.catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch triggers
  }, [me?.id, isAgent, state.balance, state.transactions.length, msgCount]))

  // Loading the account (just signed in, or just opened from EcoCash Super App).
  if (!me) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>
  const recent: ApiTransaction[] = (isAgent ? agent?.recent : merchant?.recent) ?? []
  const [whole, cents] = fmt(isAgent ? state.balance : merchant?.salesToday.total ?? 0).slice(1).split('.')
  const actions: { icon: IconName; label: string; to: Href }[] = isAgent
    ? [
        { icon: 'arrow-down-circle-outline', label: t.biz.cashIn, to: '/biz-action/cash-in' },
        { icon: 'arrow-up-circle-outline', label: t.biz.cashOut, to: '/receive?purpose=cashout' },
        { icon: 'person-add-outline', label: t.biz.register, to: '/biz-action/register' },
        { icon: 'cash-outline', label: t.atm.title, to: '/atm' },
      ]
    : [
        { icon: 'qr-code-outline', label: t.receive.title, to: '/receive' },
        { icon: 'receipt-outline', label: t.biz.charge, to: '/biz-action/charge' },
        { icon: 'print-outline', label: t.receive.myQr, to: '/my-qr' },
        { icon: 'cash-outline', label: t.atm.title, to: '/atm' },
        ...(/taxi/i.test(me.businessName ?? '') ? [{ icon: 'bus-outline' as IconName, label: t.biz.taxi, to: '/taxi' as Href }] : []),
      ]

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={[s.hero, { paddingTop: insets.top + 12 }]}>
        <View style={s.column}>
          <Text style={s.business}>{me.businessName ?? me.name}</Text>
          {me.code && <Text style={s.code}>{isAgent ? t.biz.agent(me.code) : t.biz.merchant(me.code)}</Text>}
          <Text style={s.label}>{isAgent ? t.biz.float : t.biz.salesToday}</Text>
          <Text style={s.amount}>M{whole}<Text style={s.cents}>.{cents}</Text></Text>
          {!isAgent && merchant && <Text style={s.sub}>{t.biz.count(merchant.salesToday.count)}</Text>}
          {!state.online && <Text style={s.offline}>{t.common.offline}</Text>}
        </View>
      </LinearGradient>

      <View style={s.column}>
        <View style={s.actions}>
          {actions.map((a) => <ActionButton key={a.label} icon={a.icon} label={a.label} onPress={() => router.push(a.to)} />)}
        </View>
        <NoticeBanners />

        {isAgent && agent && (
          <View style={s.tiles}>
            <Tile label={t.biz.cashInToday} value={fmt(agent.cashInToday.total)} sub={t.biz.count(agent.cashInToday.count)} />
            <Tile label={t.biz.cashOutToday} value={fmt(agent.cashOutToday.total)} sub={t.biz.count(agent.cashOutToday.count)} />
            <Tile label={t.biz.commission} value={fmt(agent.commissionToday)} />
          </View>
        )}

        {!isAgent && merchant && merchant.pending.length > 0 && (
          <>
            <SectionTitle title={t.biz.waiting} />
            <Card style={{ paddingVertical: 4 }}>
              {merchant.pending.map((m, i) => {
                const chat = state.chats[m.chatId]
                const customer = chat?.members.find((u) => u.id !== me.id)
                const v = toMessage(m, me.id, chat?.members ?? [], false)
                return (
                  <ListRow key={m.id} last={i === merchant.pending.length - 1} onPress={() => router.push(`/chat/${m.chatId}`)}
                    left={<Avatar name={customer?.name ?? '?'} size={42} />}
                    title={customer?.name ?? ''} subtitle={v.time}
                    right={<Text style={s.rowAmount}>{fmt((m.request?.amount ?? 0) - (m.request?.paid ?? 0))}</Text>} />
                )
              })}
            </Card>
          </>
        )}

        <SectionTitle title={t.biz.recent} />
        <Card style={{ paddingVertical: 4 }}>
          {recent.length === 0 && <Text style={s.none}>{t.biz.none}</Text>}
          {recent.map((x, i) => {
            return (
              <ListRow key={x.id} last={i === recent.length - 1}
                left={<TxIcon description={x.description} amount={x.amount} services={services} size={42} />}
                title={x.counterpartyName} subtitle={`${x.description} · ${dayLabel(x.createdAt, t.common.weekdays)}`}
                right={<Text style={[s.rowAmount, x.amount > 0 && { color: colors.success }]}>{x.amount > 0 ? '+' : '−'}{fmt(Math.abs(x.amount))}</Text>} />
            )
          })}
        </Card>
      </View>
    </ScrollView>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileValue}>{value}</Text>
      {sub && <Text style={s.tileSub}>{sub}</Text>}
    </Card>
  )
}

const s = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 26, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  column: { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 16 },
  business: { color: colors.heroText, fontSize: 20, fontWeight: '800' },
  code: { color: colors.heroMuted, fontSize: 13, marginTop: 2 },
  label: { color: colors.heroMuted, fontSize: 13, marginTop: 20 },
  amount: { color: colors.heroText, fontSize: 36, fontWeight: '800', marginTop: 2 },
  cents: { fontSize: 24, fontWeight: '700' },
  sub: { color: colors.heroMuted, fontSize: 13, marginTop: 2 },
  offline: { color: '#FCD34D', fontSize: 12.5, marginTop: 8 },
  actions: { flexDirection: 'row', backgroundColor: colors.surface, marginTop: 16, paddingVertical: 16, paddingHorizontal: 6, borderRadius: radius.lg },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 16 },
  tile: { flex: 1, padding: 12, borderRadius: radius.md },
  tileLabel: { fontSize: 11.5, color: colors.muted },
  tileValue: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 4 },
  tileSub: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: colors.text },
  none: { color: colors.muted, textAlign: 'center', paddingVertical: 20 },
})
