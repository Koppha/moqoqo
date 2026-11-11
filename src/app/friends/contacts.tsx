import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ContactMatch, FriendRelation, FriendRequest } from '../../../shared/api'
import { Avatar, Card, Header, ListRow, Screen, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { maskMsisdn } from '../../lib/format'
import { friendlyError } from '../../lib/friends'
import { allContacts, type PhoneContact } from '../../lib/phoneContacts'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

/** The phone's contacts: who uses EcoCash (add them), and who doesn't yet (invite them by SMS). */
export default function FriendContacts() {
  const t = useT()
  const { toast, fail } = useMoqoqo()
  const [denied, setDenied] = useState(false)
  const [matches, setMatches] = useState<ContactMatch[] | null>(null)
  const [others, setOthers] = useState<PhoneContact[]>([])
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const oops = (e: unknown) => {
    const msg = friendlyError(e)
    if (msg) toast(msg)
    else fail(e)
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const contacts = await allContacts().catch(() => [] as PhoneContact[])
      if (contacts === 'denied') return alive && setDenied(true)
      const numbers = [...new Set(contacts.flatMap((c) => c.numbers))].slice(0, 1000)
      const found = numbers.length ? await api<ContactMatch[]>('/v1/contacts/match', { body: { msisdns: numbers.map((n) => '+266' + n) } }) : []
      if (!alive) return
      const onEcoCash = new Set(found.map((m) => m.msisdn.slice(4)))
      setMatches(found.filter((m) => m.relation !== 'self'))
      setOthers(contacts.filter((c) => !c.numbers.some((n) => onEcoCash.has(n))).slice(0, 300))
    })().catch((e) => {
      if (alive) setMatches([])
      oops(e)
    })
    return () => { alive = false }
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setRelation = (msisdn: string, relation: FriendRelation) =>
    setMatches((list) => list && list.map((m) => (m.msisdn === msisdn ? { ...m, relation } : m)))

  const add = async (m: ContactMatch) => {
    try {
      const r = await api<FriendRequest | { accepted: true }>('/v1/friends/requests', { body: { userId: m.user.id } })
      setRelation(m.msisdn, 'accepted' in r ? 'friend' : 'outgoing')
      toast('accepted' in r ? t.friends.nowFriends(m.user.name) : t.friends.sent(m.user.name))
    } catch (e) {
      oops(e)
    }
  }

  const invite = async (c: PhoneContact) => {
    try {
      await api('/v1/invites', { body: { msisdn: '+266' + c.numbers[0] } })
      setInvited((s) => new Set(s).add(c.numbers[0]))
      toast(t.friends.inviteSent(c.name))
    } catch (e) {
      oops(e)
    }
  }

  const action = (m: ContactMatch) =>
    m.relation === 'friend' ? <Text style={s.state}>{t.friends.isFriend}</Text>
      : m.relation === 'outgoing' ? <Text style={s.state}>{t.friends.requested}</Text>
      : <Chip label={m.relation === 'incoming' ? t.friends.accept : t.friends.addFriend} primary onPress={() => add(m)} />

  return (
    <Screen>
      <Header title={t.friends.contactsTitle} />
      <Text style={s.hint}>{denied ? t.friends.contactsDenied : t.friends.contactsHint}</Text>
      {denied ? null : !matches ? <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} /> : (
        <>
          {matches.length > 0 && (
            <>
              <SectionTitle title={t.friends.onEcoCash} />
              <Card style={{ paddingVertical: 4 }}>
                {matches.map((m, i) => (
                  <ListRow key={m.msisdn} last={i === matches.length - 1} left={<Avatar name={m.user.name} size={42} photo={m.user.photo} />}
                    title={m.user.name} subtitle={maskMsisdn(m.msisdn)} right={action(m)} />
                ))}
              </Card>
            </>
          )}
          {others.length > 0 && (
            <>
              <SectionTitle title={t.friends.notOnEcoCash} />
              <Card style={{ paddingVertical: 4 }}>
                {others.map((c, i) => (
                  <ListRow key={`${c.name}-${c.numbers[0]}`} last={i === others.length - 1} left={<Avatar name={c.name} size={42} />}
                    title={c.name} subtitle={`+266 ${c.numbers[0].slice(0, 4)} ${c.numbers[0].slice(4)}`}
                    right={invited.has(c.numbers[0]) ? <Text style={s.state}>{t.friends.invited}</Text> : <Chip label={t.friends.invite} onPress={() => invite(c)} />} />
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  )
}

function Chip({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.chip, primary && s.chipPrimary, pressed && { opacity: 0.8 }]}>
        <Text style={[s.chipText, primary && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 6 },
  state: { fontSize: 13.5, fontWeight: '700', color: colors.muted },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
})
