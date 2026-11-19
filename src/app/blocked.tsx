import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { BlockedUser } from '../../shared/api'
import { Avatar, Button, Card, Header, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { maskMsisdn } from '../lib/format'
import { loadChats } from '../lib/friends'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors } from '../theme'

/** Me › Privacy › Blocked people: everyone I blocked, with Unblock. */
export default function BlockedPeople() {
  const t = useT()
  const { dispatch, fail, toast } = useMoqoqo()
  const [list, setList] = useState<BlockedUser[] | null>(null)

  const load = useCallback(() => api<BlockedUser[]>('/v1/blocks').then(setList, (e) => { setList([]); fail(e) }), [fail])
  useEffect(() => { load() }, [load])

  const unblock = async (b: BlockedUser) => {
    try {
      setList(await api<BlockedUser[]>(`/v1/blocks/${b.user.id}`, { method: 'DELETE' }))
      dispatch({ type: 'chats', chats: await loadChats() })
      toast(t.block.unblocked(b.user.name))
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Screen>
      <Header title={t.block.title} />
      {!list ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {list.length === 0 ? <Text style={s.none}>{t.block.none}</Text> : list.map((b, i) => (
            <ListRow key={b.user.id} last={i === list.length - 1}
              left={<Avatar name={b.user.name} size={44} photo={b.user.photo} />}
              title={b.user.name}
              subtitle={`${maskMsisdn(b.user.msisdn)} · ${t.block.since(new Date(b.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}`}
              right={<Button label={t.block.unblock} variant="ghost" onPress={() => unblock(b)} style={{ marginTop: 0 }} />} />
          ))}
        </Card>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  center: { padding: 32, alignItems: 'center' },
  none: { color: colors.muted, padding: 16 },
})
