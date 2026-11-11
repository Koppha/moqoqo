import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import type { Message } from '../../../shared/api'
import { Avatar, Card, Header, ListRow, Pill, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { fmt } from '../../lib/format'
import { dayLabel } from '../../lib/mappers'
import { useAppState } from '../../state/AppState'
import { colors } from '../../theme'

/** Split bills I sent or was part of, newest first. Tapping one opens its chat. */
export default function SplitHistory() {
  const t = useT()
  const { state } = useAppState()
  const [items, setItems] = useState<Message[] | null>(null)

  useFocusEffect(useCallback(() => {
    let alive = true
    api<Message[]>('/v1/splits').then((list) => { if (alive) setItems(list) }, () => { if (alive) setItems([]) })
    return () => { alive = false }
  }, []))

  return (
    <Screen>
      <Header title={t.split.history} />
      {!items ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        : items.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 40 }}>{t.split.historyEmpty}</Text>
          : (
            <Card style={{ paddingVertical: 4 }}>
              {items.map((m, i) => {
                const r = m.request!
                const shares = (r.split?.shares ?? []).filter((s) => s.status !== 'reassigned')
                const paid = shares.filter((s) => s.status === 'paid' || s.status === 'covered').length
                const mine = m.senderId === state.me?.id
                const organiser = shares.find((s) => s.userId === m.senderId)?.name ?? state.chats[m.chatId]?.members.find((u) => u.id === m.senderId)?.name ?? ''
                return (
                  <ListRow key={m.id} last={i === items.length - 1} onPress={() => router.push(`/chat/${m.chatId}`)}
                    left={<Avatar name="split" icon="document-text" color={colors.primary} size={42} />}
                    title={r.note ?? t.split.defaultNote}
                    subtitle={`${mine ? t.split.youOrganised : t.split.from(organiser)} · ${state.chats[m.chatId]?.title ?? ''} · ${dayLabel(m.createdAt, t.common.weekdays)}`}
                    right={
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{fmt(r.amount > 0 ? r.amount : r.paid)}</Text>
                        <Pill label={r.status === 'paid' ? t.split.allPaid : r.status === 'cancelled' ? t.split.isCancelled : t.split.progress(paid, shares.length)}
                          tone={r.status === 'paid' ? 'success' : r.status === 'cancelled' ? 'primary' : 'warn'} />
                      </View>
                    } />
                )
              })}
            </Card>
          )}
    </Screen>
  )
}
