import { StyleSheet, Text, View } from 'react-native'
import { TxIcon } from '../components/TxIcon'
import { Card, Header, Icon, ListRow, Pill, Screen, SectionTitle } from '../components/ui'
import { useT } from '../i18n'
import { useServices } from '../lib/services'
import { fmt } from '../lib/format'
import { useTransactions } from '../state/AppState'
import { colors, radius } from '../theme'

// Demo monthly spending (month index, amount); October adds today's live transactions.
const MONTHS = [[4, 1450], [5, 1980], [6, 1210], [7, 2240], [8, 1730]] as const
const NOW = 9

export default function Transactions() {
  const transactions = useTransactions()
  const { services } = useServices()
  const t = useT()
  const out = transactions.filter((x) => x.amount < 0).reduce((a, x) => a - x.amount, 0)
  const inc = transactions.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0)
  const bars = [...MONTHS.map(([m, v]) => ({ m, v, now: false })), { m: NOW, v: 1600 + out, now: true }]
  const max = Math.max(...bars.map((b) => b.v))

  return (
    <Screen>
      <Header title={t.tx.title} />
      <View>
        <View style={ts.spendRow}>
          <View>
            <Text style={ts.lbl}>{t.tx.spending(t.tx.months[NOW])}</Text>
            <Text style={ts.total}>{fmt(bars[bars.length - 1].v)}</Text>
          </View>
          <Pill label={t.tx.months[NOW]} tone="primary" />
        </View>

        <View style={ts.chart} accessibilityLabel={t.tx.chart}>
          {bars.map((b) => (
            <View key={b.m} style={ts.barCol}>
              <View style={[ts.bar, { height: `${(b.v / max) * 100}%`, backgroundColor: b.now ? colors.primary : '#E3E5EC' }]} />
              <Text style={[ts.month, b.now && { color: colors.primary, fontWeight: '700' }]}>{t.tx.monthsShort[b.m]}</Text>
            </View>
          ))}
        </View>

        <View style={ts.tiles}>
          <Card style={ts.tile}>
            <View style={[ts.tileIc, { backgroundColor: colors.successSoft }]}><Icon name="arrow-down" size={18} color={colors.success} /></View>
            <Text style={ts.lbl}>{t.tx.income}</Text>
            <Text style={ts.tileAmt}>{fmt(inc)}</Text>
          </Card>
          <Card style={ts.tile}>
            <View style={[ts.tileIc, { backgroundColor: colors.primarySoft }]}><Icon name="arrow-up" size={18} color={colors.primary} /></View>
            <Text style={ts.lbl}>{t.tx.outcome}</Text>
            <Text style={ts.tileAmt}>{fmt(out)}</Text>
          </Card>
        </View>

        <SectionTitle title={t.tx.list} />
        <Card style={{ paddingVertical: 4, marginBottom: 16 }}>
          {transactions.map((x, i, arr) => {
            return (
              <ListRow key={x.id} last={i === arr.length - 1}
                left={<TxIcon description={x.description} amount={x.amount} services={services} size={40} />}
                title={x.description} subtitle={x.time}
                right={<Text style={[ts.amt, x.amount > 0 && { color: colors.success }]}>{x.amount > 0 ? '+' : '−'}{fmt(Math.abs(x.amount))}</Text>} />
            )
          })}
        </Card>
      </View>
    </Screen>
  )
}

const ts = StyleSheet.create({
  spendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  lbl: { fontSize: 13, color: colors.muted },
  total: { fontSize: 30, fontWeight: '800', color: colors.text },
  chart: { flexDirection: 'row', height: 170, gap: 10, alignItems: 'flex-end', marginTop: 18 },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  bar: { width: '100%', borderRadius: 10 },
  month: { fontSize: 12, color: colors.muted },
  tiles: { flexDirection: 'row', gap: 12, marginTop: 18 },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: radius.lg },
  tileIc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  tileAmt: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 2 },
  amt: { fontSize: 14.5, fontWeight: '700', color: colors.text },
})
