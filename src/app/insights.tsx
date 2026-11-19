import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { SpendingCategory, SpendingInsights } from '../../shared/api'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen, type IconName } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { useAppState } from '../state/AppState'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const LOOK: Record<SpendingCategory, { icon: IconName; color: string }> = {
  people: { icon: 'people', color: '#DB2777' },
  shops: { icon: 'storefront', color: '#16A34A' },
  transport: { icon: 'bus', color: '#E0482F' },
  electricity: { icon: 'flash', color: '#F59E0B' },
  water: { icon: 'water', color: '#0EA5E9' },
  school: { icon: 'school', color: '#5B2C9F' },
  airtime: { icon: 'call', color: '#15803D' },
  insurance: { icon: 'shield-checkmark', color: '#5B2FD1' },
  society: { icon: 'people-circle', color: '#0F766E' },
  cash: { icon: 'cash', color: '#1A1F71' },
  fees: { icon: 'receipt', color: '#6B7280' },
  other: { icon: 'ellipsis-horizontal', color: '#6B7280' },
}

/** "2026-11" for this month, or `back` months before (phone's local calendar; Lesotho phones are on UTC+2). */
const monthKey = (back: number) => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - back)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Spending insights: a month's money out by category, beside the month before, and who got the most. */
export default function Insights() {
  const t = useT()
  const { state } = useAppState()
  const { fail } = useMoqoqo()
  const [back, setBack] = useState(0)
  const [loaded, setLoaded] = useState<SpendingInsights | null>(null)
  // Shows the spinner while another month loads, instead of the last month's numbers.
  const data = loaded?.month === monthKey(back) ? loaded : null

  useEffect(() => {
    let live = true
    api<SpendingInsights>(`/v1/insights?month=${monthKey(back)}`).then((d) => live && setLoaded(d), (e) => live && fail(e))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back])

  const [year, mon] = monthKey(back).split('-').map(Number)
  const monthTitle = `${t.insights.months[mon - 1]} ${year}`
  const pct = data && data.lastMonthSpent > 0 ? Math.round(((data.spent - data.lastMonthSpent) / data.lastMonthSpent) * 100) : null
  const biggest = data?.categories.reduce((m, c) => Math.max(m, c.amount, c.lastMonth), 0) ?? 0
  const openAssistant = () => {
    const chat = Object.values(state.chats).find((c) => c.assistant)
    router.push(chat ? { pathname: '/chat/[id]', params: { id: chat.id } } : '/chats')
  }

  return (
    <Screen>
      <Header title={t.insights.title} />
      <View style={s.months}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.insights.prevMonth} hitSlop={10} disabled={back >= 11} onPress={() => setBack((b) => b + 1)}>
          <Icon name="chevron-back" size={22} color={back >= 11 ? colors.muted : colors.primary} />
        </Pressable>
        <Text style={s.month}>{monthTitle}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t.insights.nextMonth} hitSlop={10} disabled={back === 0} onPress={() => setBack((b) => b - 1)}>
          <Icon name="chevron-forward" size={22} color={back === 0 ? colors.muted : colors.primary} />
        </Pressable>
      </View>

      {!data ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <>
          <Card style={s.totals}>
            <View style={{ flex: 1 }}>
              <Text style={s.small}>{t.insights.spent}</Text>
              <Text style={s.big}>{fmt(data.spent)}</Text>
              {pct !== null && <Text style={[s.small, { color: pct > 0 ? colors.danger : colors.success }]}>{t.insights.vsLast(pct)}</Text>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.small}>{t.insights.received}</Text>
              <Text style={s.mid}>{fmt(data.received)}</Text>
            </View>
          </Card>

          {data.categories.filter((c) => c.amount > 0).length === 0 ? <Text style={s.empty}>{t.insights.empty}</Text> : (
            <Card style={{ marginTop: 14, gap: 14 }}>
              {data.categories.map((c) => {
                const look = LOOK[c.category]
                const width = (n: number) => `${biggest > 0 ? Math.max(2, (n / biggest) * 100) : 0}%` as const
                return (
                  <View key={c.category} accessible accessibilityLabel={`${t.insights.categories[c.category]}: ${fmt(c.amount)}. ${t.insights.lastMonth(fmt(c.lastMonth))}`}>
                    <View style={s.row}>
                      <Avatar name={c.category} icon={look.icon} color={look.color} size={32} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.cat}>{t.insights.categories[c.category]}</Text>
                        <Text style={s.small}>{c.count > 0 ? `${t.insights.payments(c.count)} · ` : ''}{t.insights.lastMonth(fmt(c.lastMonth))}</Text>
                      </View>
                      <Text style={s.amount}>{fmt(c.amount)}</Text>
                    </View>
                    <View style={s.track}>
                      <View style={[s.bar, { width: width(c.amount), backgroundColor: look.color }]} />
                    </View>
                    <View style={s.trackThin}>
                      <View style={[s.barThin, { width: width(c.lastMonth) }]} />
                    </View>
                  </View>
                )
              })}
            </Card>
          )}

          {data.topPayees.length > 0 && (
            <>
              <Text style={s.section}>{t.insights.topPayees}</Text>
              <Card style={{ paddingVertical: 4 }}>
                {data.topPayees.map((p, i) => (
                  <ListRow key={p.name} last={i === data.topPayees.length - 1} left={<Avatar name={p.name} size={40} />} title={p.name}
                    right={<Text style={s.amount}>{fmt(p.amount)}</Text>} />
                ))}
              </Card>
            </>
          )}

          <Button label={t.insights.ask} icon="sparkles" variant="ghost" onPress={openAssistant} style={{ marginTop: 18 }} />
        </>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 },
  month: { fontSize: 17, fontWeight: '800', color: colors.text },
  totals: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  small: { fontSize: 13, color: colors.muted },
  big: { fontSize: 30, fontWeight: '800', color: colors.text, marginVertical: 2 },
  mid: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 2 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cat: { fontSize: 15, fontWeight: '700', color: colors.text },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text },
  track: { height: 8, borderRadius: radius.lg, backgroundColor: colors.surface, marginTop: 8, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.lg },
  trackThin: { height: 3, marginTop: 3, overflow: 'hidden' },
  barThin: { height: 3, borderRadius: 2, backgroundColor: colors.border },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
})
