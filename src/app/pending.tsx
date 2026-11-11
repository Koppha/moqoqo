import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { PendingItem } from '../../shared/api'
import { Avatar, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { dayLabel } from '../lib/mappers'
import { useLocalized } from '../lib/services'
import { colors } from '../theme'

/** Me › Self service › Pending: requests waiting for me or others, unfinished card top-ups, requests under review. */
export default function Pending() {
  const t = useT()
  const L = useLocalized()
  const [items, setItems] = useState<PendingItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  useFocusEffect(
    useCallback(() => {
      api<PendingItem[]>('/v1/pending').then(setItems, () => setFailed(true))
    }, []),
  )

  const row = (p: PendingItem, last: boolean) => {
    const chevron = <Icon name="chevron-forward" size={18} color={colors.muted} />
    switch (p.kind) {
      case 'request_to_pay':
        return <ListRow key={p.messageId} last={last} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: p.chatId } })}
          left={<Avatar name="pay" icon="hand-left" color="#D97706" size={40} />} title={t.svc.pendingToPay(p.from, fmt(p.amount))}
          subtitle={[p.note, dayLabel(p.createdAt, t.common.weekdays)].filter(Boolean).join(' · ')} right={chevron} />
      case 'request_sent':
        return <ListRow key={p.messageId} last={last} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: p.chatId } })}
          left={<Avatar name="sent" icon="time" color={colors.primary} size={40} />} title={t.svc.pendingSent(p.to, fmt(p.amount - p.paid))}
          subtitle={[p.note, dayLabel(p.createdAt, t.common.weekdays)].filter(Boolean).join(' · ')} right={chevron} />
      case 'topup':
        return <ListRow key={p.id} last={last} onPress={() => router.push('/topup')} left={<Avatar name="card" icon="card" color="#0EA5E9" size={40} />}
          title={t.svc.pendingTopup(fmt(p.amount))} subtitle={`${p.card} · ${t.svc.pendingTopupHint}`} right={chevron} />
      case 'atm':
        return <ListRow key={p.withdrawal.id} last={last} onPress={() => router.push('/atm')} left={<Avatar name="atm" icon="cash" color="#15803D" size={40} />}
          title={t.atm.pendingTitle(fmt(p.withdrawal.amount))} subtitle={`${p.withdrawal.reference} · ${t.atm.pendingSub}`} right={chevron} />
      case 'service_request':
        return <ListRow key={p.request.id} last={last} left={<Avatar name="req" icon="document-text" color="#5B2C9F" size={40} />}
          title={L(p.request.serviceName)} subtitle={`${p.request.reference} · ${t.svc.underReview}`} />
    }
  }

  return (
    <Screen>
      <Header title={t.svc.pending} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {!items ? (
          failed ? <Text style={s.muted}>{t.errors.NETWORK}</Text> : <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <View style={s.empty}>
            <Icon name="checkmark-done-circle-outline" size={48} color={colors.success} />
            <Text style={s.emptyText}>{t.svc.nothingPending}</Text>
          </View>
        ) : (
          <Card style={{ paddingVertical: 4 }}>{items.map((p, i) => row(p, i === items.length - 1))}</Card>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  muted: { color: colors.muted, textAlign: 'center', marginTop: 30 },
  empty: { alignItems: 'center', gap: 10, marginTop: 40 },
  emptyText: { fontSize: 15, color: colors.muted },
})
