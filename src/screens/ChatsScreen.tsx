import { router } from 'expo-router'
import { localNumber } from '../../shared/api'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { iconForChat } from '../components/icons'
import { Sheet } from '../components/Sheet'
import { Avatar, Button, Card, CircleIconButton, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { dayLabel } from '../lib/mappers'
import { preview } from '../lib/preview'
import { useChats } from '../state/AppState'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const VALID = /^[56]\d{7}$/

/** Chat list, shared by the customer app and EcoCash Business. */
export default function ChatsScreen() {
  const { state, startChat } = useMoqoqo()
  const t = useT()
  const all = useChats()
  // Message requests wait on their own list (Friends › Message requests), not here.
  const chats = all.filter((c) => !c.request)
  const requests = all.length - chats.length
  const [adding, setAdding] = useState(false)
  const [number, setNumber] = useState('')

  const start = async () => {
    setAdding(false)
    const id = await startChat('+266' + number)
    setNumber('')
    if (id) router.push(`/chat/${id}`)
  }

  return (
    <Screen>
      <View style={c.head}>
        <View style={{ flex: 1 }}>
          <Text style={c.title}>{t.chats.title}</Text>
          {!state.online && <Text style={c.offline}>{t.common.offline}</Text>}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <CircleIconButton icon="people-outline" label={t.friends.title} onPress={() => router.push('/friends')} />
          <CircleIconButton icon="create-outline" label={t.chats.newChat} onPress={() => setAdding(true)} />
        </View>
      </View>
      {requests > 0 && (
        <Card style={{ paddingVertical: 4, marginBottom: 12 }}>
          <ListRow last onPress={() => router.push('/message-requests')} left={<Avatar name="requests" icon="mail-unread" color="#D97706" size={44} />}
            title={t.friends.messageRequests(requests)} />
        </Card>
      )}
      <Card style={{ paddingVertical: 4 }}>
        {chats.length === 0 && <Text style={c.empty}>{t.chats.empty}</Text>}
        {chats.map((chat, i) => {
          const waiting = chat.messages.some((x) => x.type === 'request' && x.from === 'them' && x.request.status === 'pending')
          return (
            <ListRow key={chat.id} last={i === chats.length - 1} onPress={() => router.push(`/chat/${chat.id}`)}
              left={<Avatar name={chat.name} icon={iconForChat(chat)} size={48} photo={chat.other?.photo} />}
              title={chat.name + (chat.official ? ' ✓' : '')}
              subtitle={preview(chat.messages.at(-1) ?? chat.lastMessage, t)}
              right={
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={c.time}>{dayLabel(chat.updatedAt, t.common.weekdays)}</Text>
                  {chat.unread > 0 ? <Text style={c.badge}>{chat.unread}</Text>
                    : waiting ? <View style={c.dot} accessibilityLabel={t.chats.requestWaiting} /> : null}
                </View>
              } />
          )
        })}
      </Card>

      <Sheet typing visible={adding} title={t.chats.newChatTitle} onClose={() => setAdding(false)}>
        <Text style={c.label}>{t.chats.numberLabel}</Text>
        <View style={c.field}>
          <Text style={c.prefix}>+266</Text>
          <TextInput style={c.input} value={number} onChangeText={(v) => setNumber(localNumber(v))}
            keyboardType="number-pad" placeholder="6200 0021" placeholderTextColor={colors.muted} maxLength={20}
            accessibilityLabel={t.chats.numberLabel} autoFocus onSubmitEditing={() => VALID.test(number) && start()} />
        </View>
        <Button label={t.chats.startChat} disabled={!VALID.test(number)} onPress={start} />
      </Sheet>
    </Screen>
  )
}

const c = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  offline: { fontSize: 12.5, color: colors.warn, marginTop: 2 },
  time: { fontSize: 12, color: colors.muted },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.primary, color: '#fff', fontSize: 11.5, fontWeight: '700', textAlign: 'center', lineHeight: 20, overflow: 'hidden' },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, height: 56 },
  prefix: { fontSize: 17, fontWeight: '600', color: colors.text, marginRight: 10 },
  input: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text },
})
