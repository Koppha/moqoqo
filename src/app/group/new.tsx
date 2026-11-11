import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { ChatSummary, FriendsOverview, PublicUser } from '../../../shared/api'
import { Avatar, Button, Card, Header, Icon, Screen, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { maskMsisdn } from '../../lib/format'
import { friendlyError, loadChats } from '../../lib/friends'
import { useAppState } from '../../state/AppState'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

/** New group: a name and the friends to invite. I'm in it at once; they join when they accept. */
export default function NewGroup() {
  const t = useT()
  const { toast, fail } = useMoqoqo()
  const { dispatch } = useAppState()
  const [friends, setFriends] = useState<PublicUser[] | null>(null)
  const [title, setTitle] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<FriendsOverview>('/v1/friends').then((d) => setFriends(d.friends), () => setFriends([]))
  }, [])

  const toggle = (id: string) => setChosen((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const create = async () => {
    setBusy(true)
    try {
      const chat = await api<ChatSummary>('/v1/groups', { body: { title: title.trim(), memberIds: [...chosen] } })
      dispatch({ type: 'chats', chats: await loadChats() })
      router.replace(`/chat/${chat.id}`)
    } catch (e) {
      const msg = friendlyError(e)
      if (msg) toast(msg)
      else fail(e)
      setBusy(false)
    }
  }

  return (
    <Screen footer={<View style={s.footer}><Button label={t.friends.groupCreate} icon="people" disabled={busy || title.trim().length < 2 || chosen.size === 0} onPress={create} /></View>}>
      <Header title={t.friends.newGroup} />
      <Text style={s.label}>{t.friends.groupName}</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={60} placeholder="Lelapa" placeholderTextColor={colors.muted} accessibilityLabel={t.friends.groupName} />
      <SectionTitle title={t.friends.groupPick} />
      <Text style={s.hint}>{t.friends.groupHint}</Text>
      {!friends ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} /> : friends.length === 0 ? <Text style={s.hint}>{t.friends.groupNoFriends}</Text> : (
        <Card style={{ paddingVertical: 4 }}>
          {friends.map((u, i) => {
            const on = chosen.has(u.id)
            return (
              <Pressable key={u.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(u.id)} style={[s.row, i < friends.length - 1 && s.rowBorder]}>
                <Avatar name={u.name} size={40} photo={u.photo} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>{u.name}</Text>
                  <Text style={s.sub}>{maskMsisdn(u.msisdn)}</Text>
                </View>
                <Icon name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.primary : colors.muted} />
              </Pressable>
            )
          })}
        </Card>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 13, color: colors.muted },
  footer: { paddingHorizontal: 16, paddingBottom: 20 },
})
