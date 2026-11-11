import { localNumber, type ContactMatch, type FriendsOverview, type PublicUser } from '../../shared/api'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { maskMsisdn } from '../lib/format'
import { friendlyError } from '../lib/friends'
import { allContacts, contactsAllowed, type PhoneContact } from '../lib/phoneContacts'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'
import { FORM_MAX } from '../lib/layout'
import type { Chat } from '../types'
import { iconForChat } from './icons'
import { Avatar, Card, Icon, ListRow } from './ui'

const VALID = /^[56]\d{7}$/

/** Someone picked: an EcoCash user when known, or just a typed number (`user` missing). */
export interface Person { name: string; msisdn: string; user?: PublicUser }

/** Phone contacts, split into who uses EcoCash (with the name saved on the phone) and who doesn't yet. */
interface Book { onEcoCash: { name: string; user: PublicUser }[]; others: PhoneContact[] }

/**
 * One search over recent chats (when given), EcoCash friends and the phone's contacts; a typed number works too.
 * People not on EcoCash get an SMS invite. `exclude`: numbers (+266…) already picked, left out of the lists.
 */
export function PeopleSearch({ chats, onChat, onPerson, exclude, placeholder, autoFocus }: {
  chats?: Chat[]; onChat?: (chatId: string) => void; onPerson: (p: Person) => void; exclude?: ReadonlySet<string>
  placeholder?: string; autoFocus?: boolean
}) {
  const t = useT()
  const { toast, fail } = useMoqoqo()
  const [query, setQuery] = useState('')
  const [friends, setFriends] = useState<PublicUser[]>([])
  const [book, setBook] = useState<Book | 'loading' | 'denied' | null>(null)
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set())

  /** Reads the phone's contacts (asks first if not allowed yet) and finds who uses EcoCash. */
  const loadBook = async () => {
    setBook('loading')
    try {
      const contacts = await allContacts()
      if (contacts === 'denied') return setBook('denied')
      const numbers = [...new Set(contacts.flatMap((c) => c.numbers))].slice(0, 1000)
      const found = numbers.length ? await api<ContactMatch[]>('/v1/contacts/match', { body: { msisdns: numbers.map((n) => '+266' + n) } }) : []
      const byNumber = new Map(found.filter((m) => m.relation !== 'self').map((m) => [m.msisdn.slice(4), m.user]))
      // One row per EcoCash user, even when two contacts lead to the same wallet.
      const users = new Set<string>()
      const onEcoCash = contacts.flatMap((c) => {
        const user = c.numbers.map((x) => byNumber.get(x)).find((u) => u && !users.has(u.id))
        if (!user) return []
        users.add(user.id)
        return [{ name: c.name, user }]
      })
      setBook({ onEcoCash, others: contacts.filter((c) => !c.numbers.some((n) => byNumber.has(n))) })
    } catch (e) {
      setBook(null)
      fail(e)
    }
  }

  useEffect(() => {
    api<FriendsOverview>('/v1/friends').then((d) => setFriends(d.friends), () => {})
    // Contacts already allowed: search them straight away (no prompt).
    contactsAllowed().then((ok) => { if (ok) loadBook() })
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const invite = async (c: PhoneContact) => {
    try {
      await api('/v1/invites', { body: { msisdn: '+266' + c.numbers[0] } })
      setInvited((s) => new Set(s).add(c.numbers[0]))
      toast(t.friends.inviteSent(c.name))
    } catch (e) {
      const msg = friendlyError(e)
      if (msg) toast(msg)
      else fail(e)
    }
  }

  // Match on a name, or on the digits of a number however it's typed.
  const q = query.trim().toLowerCase()
  const digits = localNumber(query)
  const hit = (name: string, msisdn?: string) =>
    !q || name.toLowerCase().includes(q) || (digits.length >= 3 && !!msisdn?.replace(/\D/g, '').includes(digits))
  const out = (msisdn?: string) => !!msisdn && !!exclude?.has(msisdn)

  const shownChats = (chats ?? []).filter((c) => !out(c.msisdn) && hit(c.name, c.msisdn))
  // Friends and contacts who already have a chat here show once, as the chat.
  const inChats = new Set((chats ?? []).flatMap((c) => (c.msisdn ? [c.msisdn] : [])))
  const shownFriends = friends.filter((u) => !inChats.has(u.msisdn) && !out(u.msisdn) && hit(u.name, u.msisdn))
  const listed = new Set([...inChats, ...friends.map((u) => u.msisdn)])
  const shownBook = typeof book === 'object' && book
    ? {
      onEcoCash: book.onEcoCash.filter((c) => !listed.has(c.user.msisdn) && !out(c.user.msisdn) && (hit(c.name, c.user.msisdn) || hit(c.user.name))),
      // People not on EcoCash only show for a search, so the list stays short.
      others: q ? book.others.filter((c) => hit(c.name, c.numbers[0])).slice(0, 20) : [],
    }
    : null
  const typed = '+266' + digits
  const typedNumber = VALID.test(digits) && !out(typed) && ![...listed, ...(shownBook?.onEcoCash.map((c) => c.user.msisdn) ?? [])].includes(typed)
  const nothing = !shownChats.length && !shownFriends.length && !shownBook?.onEcoCash.length && !shownBook?.others.length && !typedNumber
  const chevron = <Icon name="chevron-forward" size={18} color={colors.muted} />

  return (
    <>
      <View style={s.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder={placeholder ?? t.split.search} placeholderTextColor={colors.muted}
          autoCorrect={false} autoCapitalize="none" accessibilityLabel={placeholder ?? t.split.search} autoFocus={autoFocus} />
      </View>

      {typedNumber && (
        <Card style={s.card}>
          <ListRow last onPress={() => onPerson({ name: `+266 ${digits}`, msisdn: typed })} left={<Avatar name="+" icon="person-add" color={colors.primary} size={42} />}
            title={t.split.useNumber(`+266 ${digits}`)} right={chevron} />
        </Card>
      )}

      {shownChats.length > 0 && (
        <>
          <Text style={s.section}>{t.split.recent}</Text>
          <Card style={s.card}>
            {shownChats.map((c, i) => (
              <ListRow key={c.id} last={i === shownChats.length - 1} onPress={() => onChat?.(c.id)}
                left={<Avatar name={c.name} icon={iconForChat(c)} size={42} photo={c.other?.photo} />}
                title={c.group ? `${c.name} (${c.members.length})` : c.name}
                subtitle={c.group ? t.split.members(c.members.length) : c.msisdn ? maskMsisdn(c.msisdn) : undefined} right={chevron} />
            ))}
          </Card>
        </>
      )}

      {shownFriends.length > 0 && (
        <>
          <Text style={s.section}>{t.split.friendsSection}</Text>
          <Card style={s.card}>
            {shownFriends.map((u, i) => (
              <ListRow key={u.id} last={i === shownFriends.length - 1} onPress={() => onPerson({ name: u.name, msisdn: u.msisdn, user: u })}
                left={<Avatar name={u.name} size={42} photo={u.photo} />} title={u.name} subtitle={maskMsisdn(u.msisdn)} right={chevron} />
            ))}
          </Card>
        </>
      )}

      {book === 'loading' ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
        : book === 'denied' ? <Text style={s.note}>{t.friends.contactsDenied}</Text>
        : book === null ? (
          <Pressable accessibilityRole="button" onPress={loadBook} style={s.findContacts}>
            <Icon name="people-circle-outline" size={22} color={colors.primary} />
            <Text style={s.findText}>{t.split.findContacts}</Text>
          </Pressable>
        ) : (
          <>
            {shownBook!.onEcoCash.length > 0 && (
              <>
                <Text style={s.section}>{t.split.contactsSection}</Text>
                <Card style={s.card}>
                  {shownBook!.onEcoCash.map((c, i) => (
                    <ListRow key={c.user.id} last={i === shownBook!.onEcoCash.length - 1} onPress={() => onPerson({ name: c.name, msisdn: c.user.msisdn, user: c.user })}
                      left={<Avatar name={c.name} size={42} photo={c.user.photo} />} title={c.name} subtitle={maskMsisdn(c.user.msisdn)} right={chevron} />
                  ))}
                </Card>
              </>
            )}
            {shownBook!.others.length > 0 && (
              <>
                <Text style={s.section}>{t.split.notOnEcoCash}</Text>
                <Card style={s.card}>
                  {shownBook!.others.map((c, i) => (
                    <ListRow key={c.numbers[0]} last={i === shownBook!.others.length - 1} left={<Avatar name={c.name} size={42} />}
                      title={c.name} subtitle={`+266 ${c.numbers[0]}`}
                      right={invited.has(c.numbers[0]) ? <Text style={s.state}>✓</Text> : (
                        <Pressable accessibilityRole="button" onPress={() => invite(c)} style={s.chip}><Text style={s.chipText}>{t.friends.invite}</Text></Pressable>
                      )} />
                  ))}
                </Card>
              </>
            )}
          </>
        )}

      {nothing && book !== 'loading' && <Text style={s.note}>{q ? t.split.noMatch : chats ? t.split.noChats : ''}</Text>}
    </>
  )
}

/** A full-screen window with the search: pick one person (Split bill › Pay to another person, Add people). */
export function PeoplePicker({ visible, title, onClose, onPerson, exclude }: {
  visible: boolean; title: string; onClose: () => void; onPerson: (p: Person) => void; exclude?: ReadonlySet<string>
}) {
  const t = useT()
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.picker}>
        <View style={s.pickerHead}>
          <Pressable accessibilityLabel={t.common.back} onPress={onClose} style={s.pickerBack}><Icon name="chevron-back" size={26} /></Pressable>
          <Text style={s.pickerTitle}>{title}</Text>
          <View style={s.pickerBack} />
        </View>
        <ScrollView contentContainerStyle={s.pickerList} keyboardShouldPersistTaps="handled">
          <PeopleSearch onPerson={onPerson} exclude={exclude} placeholder={t.split.searchPeople} autoFocus />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 14, height: 52, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 16, color: colors.text },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 14, marginBottom: 8 },
  card: { paddingVertical: 4, marginTop: 6 },
  note: { color: colors.muted, textAlign: 'center', marginTop: 24, lineHeight: 20 },
  findContacts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginTop: 8 },
  findText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.primary },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  state: { color: colors.success, fontWeight: '700', fontSize: 16 },
  picker: { flex: 1, backgroundColor: colors.bg },
  pickerHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  pickerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pickerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  pickerList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
})
