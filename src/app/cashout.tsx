import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Avatar, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { UssdFallback } from '../components/UssdFallback'
import { useT } from '../i18n'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { colors } from '../theme'

/** Cash out: at an EcoCash agent (scan their QR or type the agent code) or at an ATM without a card. */
export default function CashOut() {
  const t = useT()
  const { state } = useAppState()
  const tier1 = state.me?.kycTier === 1
  const chevron = <Icon name="chevron-forward" size={18} color={colors.muted} />
  return (
    <Screen>
      <Header title={t.cashOutHub.title} />
      <View style={s.body}>
        <Text style={s.intro}>{t.cashOutHub.intro}</Text>
        {tier1 && (
          <Card style={s.kyc}>
            <Icon name="shield-checkmark-outline" size={22} color="#92400E" />
            <Text style={s.kycText}>{t.cashOutHub.kycFirst}</Text>
          </Card>
        )}
        <Card style={{ paddingVertical: 4 }}>
          <ListRow left={<Avatar name="agent" icon="storefront" color="#E8590C" size={44} />} title={t.cashOutHub.agent} subtitle={t.cashOutHub.agentSub}
            onPress={() => router.push({ pathname: '/pay', params: { for: 'agent' } })} right={chevron} />
          <ListRow last left={<Avatar name="atm" icon="cash" color="#15803D" size={44} />} title={t.cashOutHub.atm} subtitle={t.cashOutHub.atmSub}
            onPress={() => router.push('/atm')} right={chevron} />
        </Card>
        <UssdFallback fn="cashout" />
        <Text style={s.note}>{t.cashOutHub.note}</Text>
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 16, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  intro: { fontSize: 14, color: colors.muted, marginBottom: 14 },
  kyc: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#FEF3C7', marginBottom: 14 },
  kycText: { flex: 1, fontSize: 13.5, color: '#92400E' },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 14 },
})
