import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'
import type { FriendRequest, UserRelation } from '../../shared/api'
import { Avatar, Button, Card, Header, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { maskMsisdn } from '../lib/format'
import { friendlyError } from '../lib/friends'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors } from '../theme'

/**
 * A person from their QR code or link (moqoqo://add?u=<userId>): add them as a friend, accept their request, or
 * message them when you're friends already. Someone I blocked: unblock them here first. Someone who blocked me:
 * adding them is refused with a neutral message (they aren't revealed).
 */
export default function AddFriend() {
  const { u } = useLocalSearchParams<{ u?: string }>()
  const t = useT()
  const { toast, fail, startChat } = useMoqoqo()
  const [r, setR] = useState<UserRelation | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!u) return
    api<UserRelation>(`/v1/users/${encodeURIComponent(u)}/relation`).then(setR, (e) => setMissing(friendlyError(e) ?? t.friends.notFriendQr))
  }, [u, t])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!r) return
    setBusy(true)
    try {
      const res = await api<FriendRequest | { accepted: true }>('/v1/friends/requests', { body: { userId: r.user.id } })
      toast('accepted' in res ? t.friends.nowFriends(r.user.name) : t.friends.sent(r.user.name))
      load()
    } catch (e) {
      const msg = friendlyError(e)
      if (msg) toast(msg)
      else fail(e)
    } finally {
      setBusy(false)
    }
  }

  const unblock = async () => {
    if (!r) return
    setBusy(true)
    try {
      await api(`/v1/blocks/${r.user.id}`, { method: 'DELETE' })
      toast(t.block.unblocked(r.user.name))
      load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const message = async () => {
    if (!r) return
    const id = await startChat(r.user.msisdn)
    if (id) router.replace(`/chat/${id}`)
  }

  return (
    <Screen>
      <Header title={t.friends.profileTitle} />
      {!u || missing ? <Text style={s.muted}>{missing ?? t.friends.notFriendQr}</Text> : !r ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <Card style={s.card}>
          <Avatar name={r.user.name} size={72} photo={r.user.photo} />
          <Text style={s.name}>{r.user.name}</Text>
          <Text style={s.muted}>{r.user.username ? `@${r.user.username} · ` : ''}{maskMsisdn(r.user.msisdn)}</Text>
          {r.blockedByMe ? (
            <>
              <Text style={[s.muted, { marginTop: 16 }]}>{t.block.bar(r.user.name)}</Text>
              <Button label={t.block.unblock} icon="lock-open-outline" variant="ghost" disabled={busy} onPress={unblock} style={s.btn} />
            </>
          ) : r.relation === 'self' ? <Text style={[s.muted, { marginTop: 16 }]}>{t.friends.you}</Text>
            : r.relation === 'friend' ? <Button label={t.friends.message} icon="chatbubble" onPress={message} style={s.btn} />
            : r.relation === 'outgoing' ? <Button label={t.friends.requested} icon="time-outline" variant="ghost" disabled style={s.btn} />
            : <Button label={r.relation === 'incoming' ? t.friends.accepted : t.friends.addFriend} icon="person-add" disabled={busy} onPress={add} style={s.btn} />}
        </Card>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  card: { alignItems: 'center', paddingVertical: 28, gap: 4 },
  name: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 10 },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  btn: { alignSelf: 'stretch', marginTop: 20 },
})
