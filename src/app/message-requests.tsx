import { router } from 'expo-router'
import { StyleSheet, Text } from 'react-native'
import { iconForChat } from '../components/icons'
import { Avatar, Card, Header, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { dayLabel } from '../lib/mappers'
import { preview } from '../lib/preview'
import { useChats } from '../state/AppState'
import { colors } from '../theme'

/** Chats from people who aren't friends (with Me › Who can message me: Friends only). Open one to accept or delete it. */
export default function MessageRequests() {
  const t = useT()
  const requests = useChats().filter((c) => c.request)
  return (
    <Screen>
      <Header title={t.friends.requestsTitle} />
      <Card style={{ paddingVertical: 4 }}>
        {requests.length === 0 ? <Text style={s.none}>{t.friends.requestsNone}</Text> : requests.map((chat, i) => (
          <ListRow key={chat.id} last={i === requests.length - 1} onPress={() => router.push(`/chat/${chat.id}`)}
            left={<Avatar name={chat.name} icon={iconForChat(chat)} size={48} photo={chat.other?.photo} />}
            title={chat.name} subtitle={preview(chat.messages.at(-1) ?? chat.lastMessage, t)}
            right={<Text style={s.time}>{dayLabel(chat.updatedAt, t.common.weekdays)}</Text>} />
        ))}
      </Card>
    </Screen>
  )
}

const s = StyleSheet.create({
  none: { color: colors.muted, padding: 16 },
  time: { fontSize: 12.5, color: colors.muted },
})
