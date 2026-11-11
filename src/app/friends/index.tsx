import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { FriendRequest, FriendsOverview, PublicUser } from '../../../shared/api'
import { Sheet, SheetOption } from '../../components/Sheet'
import { ActionButton, Avatar, Button, Card, Header, Icon, ListRow, Screen, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { maskMsisdn } from '../../lib/format'
import { friendlyError, loadChats } from '../../lib/friends'
import { useAppState } from '../../state/AppState'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

/**
 * Friends: requests to answer, group invites, my friends and the requests I sent. Add by number or @username, by QR
 * code, or from the phone's contacts; people not on EcoCash get an SMS invite.
 */
export default function Friends() {
  const t = useT()
  const { toast, fail, startChat } = useMoqoqo()
  const { dispatch } = useAppState()
  const [d, setD] = useState<FriendsOverview | null>(null)
  const [adding, setAdding] = useState(false)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<PublicUser | null>(null)
  const oops = (e: unknown) => {
    const msg = friendlyError(e)
    if (msg) toast(msg)
    else fail(e)
  }

  const load = useCallback(() => {
    api<FriendsOverview>('/v1/friends').then(setD, () => setD((x) => x ?? { friends: [], incoming: [], outgoing: [], groupInvites: [], messageRequests: 0 }))
  }, [])
  useFocusEffect(load)

  const invite = (msisdn: string) =>
    api('/v1/invites', { body: { msisdn } }).then(() => toast(t.friends.inviteSent(msisdn)), oops)

  const send = async () => {
    const v = who.trim()
    const body = /^[+\d]/.test(v) ? { msisdn: v } : { username: v.replace(/^@/, '') }
    setBusy(true)
    try {
      const r = await api<FriendRequest | { accepted: true }>('/v1/friends/requests', { body })
      toast('accepted' in r ? t.friends.nowFriends(v) : t.friends.sent(r.to.name))
      setAdding(false)
      setWho('')
      load()
    } catch (e) {
      // Not on EcoCash: offer an SMS invite instead.
      if (e instanceof ApiFailure && e.code === 'NOT_REGISTERED' && 'msisdn' in body) {
        Alert.alert(t.friends.notOnEcoCash, e.message, [
          { text: t.friends.cancel, style: 'cancel' },
          { text: t.friends.invite, onPress: () => { setAdding(false); invite(v) } },
        ])
      } else oops(e)
    } finally {
      setBusy(false)
    }
  }

  const answer = (r: FriendRequest, accept: boolean) =>
    api(`/v1/friends/requests/${r.id}/${accept ? 'accept' : 'decline'}`, { body: {} }).then(() => {
      if (accept) toast(t.friends.nowFriends(r.from.name))
      load()
    }, oops)

  const cancel = (r: FriendRequest) => api(`/v1/friends/requests/${r.id}`, { method: 'DELETE' }).then(load, oops)

  const join = async (id: string, title: string, accept: boolean) => {
    try {
      const { chatId } = await api<{ chatId: string }>(`/v1/group-invites/${id}/${accept ? 'accept' : 'decline'}`, { body: {} })
      load()
      if (!accept) return
      dispatch({ type: 'chats', chats: await loadChats() })
      toast(t.friends.joined(title))
      router.push(`/chat/${chatId}`)
    } catch (e) {
      oops(e)
    }
  }

  const message = async (u: PublicUser) => {
    setPicked(null)
    const id = await startChat(u.msisdn)
    if (id) router.push(`/chat/${id}`)
  }

  const remove = (u: PublicUser) => {
    setPicked(null)
    Alert.alert(t.friends.removeTitle(u.name), t.friends.removeBody, [
      { text: t.friends.keep, style: 'cancel' },
      { text: t.friends.remove, style: 'destructive', onPress: () => api(`/v1/friends/${u.id}`, { method: 'DELETE' }).then(load, oops) },
    ])
  }

  return (
    <Screen>
      <Header title={t.friends.title} right={<Pressable accessibilityRole="button" accessibilityLabel={t.friends.add} onPress={() => setAdding(true)} style={s.addBtn}><Icon name="person-add" size={20} color="#fff" /></Pressable>} />
      <View style={s.actions}>
        <ActionButton icon="scan" label={t.friends.scan} onPress={() => router.push('/friends/scan')} />
        <ActionButton icon="qr-code-outline" label={t.friends.myQr} onPress={() => router.push('/friends/qr')} />
        <ActionButton icon="people-circle-outline" label={t.friends.contacts} onPress={() => router.push('/friends/contacts')} />
        <ActionButton icon="people-outline" label={t.friends.newGroup} onPress={() => router.push('/group/new')} />
      </View>

      {!d ? <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} /> : (
        <>
          {d.messageRequests > 0 && (
            <Card style={{ marginTop: 14, paddingVertical: 4 }}>
              <ListRow last onPress={() => router.push('/message-requests')} left={<Avatar name="requests" icon="mail-unread" color="#D97706" size={40} />}
                title={t.friends.messageRequests(d.messageRequests)} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
            </Card>
          )}

          {d.incoming.length > 0 && (
            <>
              <SectionTitle title={t.friends.requests} />
              <Card style={{ paddingVertical: 4 }}>
                {d.incoming.map((r, i) => (
                  <ListRow key={r.id} last={i === d.incoming.length - 1} left={<Avatar name={r.from.name} size={42} photo={r.from.photo} />}
                    title={r.from.name} subtitle={maskMsisdn(r.from.msisdn)}
                    right={<View style={s.pair}><Chip label={t.friends.accept} primary onPress={() => answer(r, true)} /><Chip label={t.friends.decline} onPress={() => answer(r, false)} /></View>} />
                ))}
              </Card>
            </>
          )}

          {d.groupInvites.length > 0 && (
            <>
              <SectionTitle title={t.friends.groupInvites} />
              <Card style={{ paddingVertical: 4 }}>
                {d.groupInvites.map((g, i) => (
                  <ListRow key={g.id} last={i === d.groupInvites.length - 1} left={<Avatar name={g.title} icon="people" color="#0F766E" size={42} />}
                    title={g.title} subtitle={t.friends.groupFrom(g.from.name, g.memberCount)}
                    right={<View style={s.pair}><Chip label={t.friends.join} primary onPress={() => join(g.id, g.title, true)} /><Chip label={t.friends.decline} onPress={() => join(g.id, g.title, false)} /></View>} />
                ))}
              </Card>
            </>
          )}

          <SectionTitle title={t.friends.mine} />
          <Card style={{ paddingVertical: 4 }}>
            {d.friends.length === 0 ? <Text style={s.none}>{t.friends.none}</Text> : d.friends.map((u, i) => (
              <ListRow key={u.id} last={i === d.friends.length - 1} onPress={() => setPicked(u)} left={<Avatar name={u.name} size={42} photo={u.photo} />}
                title={u.name} subtitle={u.username ? `@${u.username}` : maskMsisdn(u.msisdn)} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
            ))}
          </Card>

          {d.outgoing.length > 0 && (
            <>
              <SectionTitle title={t.friends.sentRequests} />
              <Card style={{ paddingVertical: 4 }}>
                {d.outgoing.map((r, i) => (
                  <ListRow key={r.id} last={i === d.outgoing.length - 1} left={<Avatar name={r.to.name} size={42} photo={r.to.photo} />}
                    title={r.to.name} subtitle={t.friends.waiting} right={<Chip label={t.friends.cancel} onPress={() => cancel(r)} />} />
                ))}
              </Card>
            </>
          )}
        </>
      )}

      <Sheet typing visible={adding} title={t.friends.add} onClose={() => setAdding(false)}>
        <Text style={s.hint}>{t.friends.addHint}</Text>
        <TextInput style={s.input} value={who} onChangeText={setWho} autoCapitalize="none" autoCorrect={false} placeholder={t.friends.numberOrUsername}
          placeholderTextColor={colors.muted} accessibilityLabel={t.friends.numberOrUsername} onSubmitEditing={() => who.trim().length >= 3 && send()} />
        <Button label={t.friends.send} icon="person-add" disabled={busy || who.trim().length < 3} onPress={send} />
      </Sheet>

      <Sheet visible={!!picked} title={picked?.name ?? ''} onClose={() => setPicked(null)}>
        {picked && (
          <>
            <SheetOption icon="chatbubble" color={colors.primary} title={t.friends.message} subtitle={maskMsisdn(picked.msisdn)} onPress={() => message(picked)} />
            <SheetOption icon="person-remove" color="#DC2626" title={t.friends.remove} subtitle="" onPress={() => remove(picked)} />
          </>
        )}
      </Sheet>
    </Screen>
  )
}

/** A small answer button in a row (Accept, Decline, Cancel). */
function Chip({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.chip, primary && s.chipPrimary, pressed && { opacity: 0.8 }]}>
      <Text style={[s.chipText, primary && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 6 },
  pair: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  none: { color: colors.muted, padding: 16, lineHeight: 20 },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 12 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text, borderWidth: 1, borderColor: colors.border },
})
