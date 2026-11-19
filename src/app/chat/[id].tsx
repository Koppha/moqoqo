import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { BILL_ICON, chatIcon, iconForChat } from '../../components/icons'
import { MessageView } from '../../components/MessageView'
import { useKeyboardShown } from '../../components/useKeyboardScroll'
import { Sheet, SheetGrid, SheetOption } from '../../components/Sheet'
import { Avatar, Button, CircleIconButton, Icon } from '../../components/ui'
import { BILL_KEYS, BILLS } from '../../data/bills'
import { useT } from '../../i18n'
import { maskMsisdn } from '../../lib/format'
import { loadChats } from '../../lib/friends'
import { api } from '../../lib/api'
import { CONTENT_MAX } from '../../lib/layout'
import { useChat } from '../../state/AppState'
import { useAppMode } from '../../state/Auth'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

type Menu = 'actions' | 'request' | 'bills' | 'members' | 'group' | 'person' | null

/** A chat from someone who isn't a friend: accept it (a normal chat, with notifications) or delete it. */
function RequestBanner({ chatId, name }: { chatId: string; name: string }) {
  const t = useT()
  const { dispatch, fail } = useMoqoqo()
  const answer = async (accept: boolean) => {
    try {
      await api(`/v1/chats/${chatId}/${accept ? 'accept' : 'decline'}-request`, { body: {} })
      dispatch({ type: 'chats', chats: await loadChats() })
      if (!accept) router.back()
    } catch (e) {
      fail(e)
    }
  }
  return (
    <View style={x.request}>
      <Text style={x.requestText}>{t.friends.requestBanner(name)}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label={t.friends.declineRequest} variant="ghost" onPress={() => answer(false)} style={{ flex: 1, marginTop: 0 }} />
        <Button label={t.friends.acceptRequest} onPress={() => answer(true)} style={{ flex: 1, marginTop: 0 }} />
      </View>
    </View>
  )
}

export default function ChatScreen() {
  const mode = useAppMode()
  // send / request: an amount the EcoCash Assistant prepared (opens the amount screen pre-filled, then the PIN).
  const { id, send: presetSend, note: presetNote, request: presetRequest } = useLocalSearchParams<{ id: string; send?: string; note?: string; request?: string }>()
  const { state, dispatch, toast, fail, sendMoney, createRequest, sendText, others } = useMoqoqo()
  const safe = useSafeAreaInsets()
  // No navigation-bar space under the composer while the keyboard is up (the keyboard already sits over it).
  const insets = { bottom: useKeyboardShown() ? 0 : safe.bottom }
  const t = useT()
  const chat = useChat(id)
  // The group was deleted, or left, while open here: back to the list (not a blank screen).
  const seen = useRef(false)
  useEffect(() => {
    if (chat) seen.current = true
    else if (seen.current) router.back()
  }, [chat])
  const [menu, setMenu] = useState<Menu>(null)
  const [giftKind, setGiftKind] = useState<'money' | 'mpho'>('money')
  const [text, setText] = useState('')
  const scroll = useRef<ScrollView>(null)

  // While this chat is on screen, incoming messages don't count as unread.
  useEffect(() => {
    if (!id) return
    dispatch({ type: 'openChat', chatId: id })
    api(`/v1/chats/${id}/read`, { method: 'POST' }).catch(() => {})
    return () => dispatch({ type: 'openChat', chatId: null })
  }, [id, dispatch])

  // Run a prepared send or request once, as soon as the chat is here.
  const presetDone = useRef(false)
  useEffect(() => {
    if (!chat || presetDone.current || !(presetSend || presetRequest)) return
    presetDone.current = true
    router.setParams({ send: undefined, note: undefined, request: undefined })
    // send=open: the Send money screen picked this person; no amount yet.
    const amount = Number(presetSend || presetRequest) || undefined
    // After the screen has slid in (not cancelled on re-render: presetDone keeps it to once).
    setTimeout(() => {
      if (presetSend) sendMoney(id, 'money', undefined, amount ? { amount, note: presetNote || undefined } : undefined)
      else createRequest(id, undefined, amount)
    }, 300)
  }, [chat, id, presetSend, presetNote, presetRequest, sendMoney, createRequest])

  if (!chat) return null
  const mine = !!chat.group && chat.createdBy === state.me?.id

  /** Group menu: the one who made it deletes it for everyone; anyone else leaves. Asks first. */
  const removeGroup = () => {
    setMenu(null)
    const [title, body] = mine ? t.chat.deleteConfirm(chat.name) : t.chat.leaveConfirm(chat.name)
    Alert.alert(title, body, [
      { text: t.split.cancel, style: 'cancel' },
      {
        text: mine ? t.chat.deleteGroup[0] : t.chat.leaveGroup[0], style: 'destructive', onPress: async () => {
          try {
            await (mine ? api(`/v1/chats/${chat.id}`, { method: 'DELETE' }) : api(`/v1/chats/${chat.id}/leave`, { body: {} }))
            dispatch({ type: 'chatRemoved', chatId: chat.id })
            toast(mine ? t.chat.groupDeleted(chat.name) : t.chat.groupLeft(chat.name))
          } catch (e) {
            fail(e)
          }
        },
      },
    ])
  }
  // One to one with another customer (not a merchant, agent or official account): they can be blocked.
  const blockable = !chat.group && !chat.official && chat.other?.role === 'customer' && mode !== 'business'
  const setBlocked = async (block: boolean) => {
    try {
      await (block ? api('/v1/blocks', { body: { userId: chat.other!.id } }) : api(`/v1/blocks/${chat.other!.id}`, { method: 'DELETE' }))
      dispatch({ type: 'chats', chats: await loadChats() })
      toast(block ? t.block.blocked(chat.name) : t.block.unblocked(chat.name))
    } catch (e) {
      fail(e)
    }
  }
  const askBlock = () => {
    setMenu(null)
    const [title, body] = t.block.confirm(chat.name)
    Alert.alert(title, body, [
      { text: t.split.cancel, style: 'cancel' },
      { text: t.block.block, style: 'destructive', onPress: () => setBlocked(true) },
    ])
  }
  const typing = !!state.typing[id]
  // A new assistant chat: a few ideas to start with.
  const showIdeas = chat.assistant && !chat.messages.some((m) => m.from === 'me')
  // In a group, money goes to one member: pick who first.
  const send = (kind: 'money' | 'mpho') => {
    if (!chat.group) return run(() => sendMoney(id, kind))
    setGiftKind(kind)
    setMenu('members')
  }

  // Close the sheet first, then open the full-screen amount/PIN flow.
  const run = (fn: () => void) => {
    setMenu(null)
    setTimeout(fn, 250)
  }
  const submit = () => {
    if (!text.trim()) return
    sendText(id, text.trim())
    setText('')
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      <View style={x.header}>
        <CircleIconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
        <Avatar name={chat.name} icon={iconForChat(chat)} size={40} photo={chat.other?.photo} />
        <View style={{ flex: 1 }}>
          <Text style={x.name} numberOfLines={1}>{chat.name}</Text>
          <Text style={x.sub}>{chat.assistant ? (typing ? t.assistant.typing : t.assistant.subtitle) : chat.msisdn ? maskMsisdn(chat.msisdn) : chat.official ? t.chat.official : t.common.group}</Text>
        </View>
        {chat.group ? <CircleIconButton icon="ellipsis-vertical" label={t.chat.groupMenu} onPress={() => setMenu('group')} />
          : !chat.assistant && !chat.blockedByMe && <CircleIconButton icon="call-outline" label={t.common.call} onPress={() => toast(t.common.voiceCall)} />}
        {blockable && <CircleIconButton icon="ellipsis-vertical" label={t.block.menu} onPress={() => setMenu('person')} />}
      </View>

      {chat.request && <RequestBanner chatId={chat.id} name={chat.name} />}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView ref={scroll} contentContainerStyle={x.msgs} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {chat.messages.map((m) => <MessageView key={m.id} chatId={id} m={m} />)}
          {typing && <Text style={x.typing} accessibilityLiveRegion="polite">{t.assistant.typing}</Text>}
        </ScrollView>

        {chat.assistant ? (
          <View style={[x.composer, { paddingBottom: 10 + insets.bottom, flexDirection: 'column', alignItems: 'stretch' }]}>
            {showIdeas && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={x.ideas} keyboardShouldPersistTaps="handled">
                {t.assistant.ideas.map((idea) => (
                  <Pressable key={idea} accessibilityRole="button" onPress={() => sendText(id, idea)} style={x.idea}>
                    <Text style={x.ideaText}>{idea}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput style={x.input} placeholder={t.assistant.placeholder} placeholderTextColor={colors.muted} value={text} onChangeText={setText}
                onSubmitEditing={submit} returnKeyType="send" maxLength={1000} accessibilityLabel={t.assistant.placeholder} />
              <Pressable accessibilityRole="button" accessibilityLabel={t.chat.sendMessage} onPress={submit} style={x.sendBtn}>
                <Icon name="send" size={18} color={colors.primary} />
              </Pressable>
            </View>
            <Text style={x.assistantNote}>{t.assistant.disclaimer}</Text>
          </View>
        ) : chat.support ? (
          <View style={[x.composer, { paddingBottom: 10 + insets.bottom }]}>
            <TextInput style={x.input} placeholder={t.chat.placeholder} placeholderTextColor={colors.muted} value={text} onChangeText={setText}
              onSubmitEditing={submit} returnKeyType="send" maxLength={2000} accessibilityLabel={t.chat.placeholder} />
            <Pressable accessibilityRole="button" accessibilityLabel={t.chat.sendMessage} onPress={submit} style={x.sendBtn}>
              <Icon name="send" size={18} color={colors.primary} />
            </Pressable>
          </View>
        ) : chat.official ? (
          <Text style={[x.officialNote, { paddingBottom: 14 + insets.bottom }]}>{t.chat.official}</Text>
        ) : chat.blockedByMe ? (
          <View style={[x.composer, x.blockedBar, { paddingBottom: 10 + insets.bottom }]}>
            <Text style={x.blockedText}>{t.block.bar(chat.name)}</Text>
            <Button label={t.block.unblock} variant="ghost" onPress={() => setBlocked(false)} style={{ marginTop: 0 }} />
          </View>
        ) : (
        <View style={[x.composer, { paddingBottom: 10 + insets.bottom }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.chat.moneyAndMore} onPress={() => setMenu('actions')} style={x.plus}>
            <Icon name="add" size={26} color="#fff" />
          </Pressable>
          <TextInput style={x.input} placeholder={t.chat.placeholder} placeholderTextColor={colors.muted} value={text} onChangeText={setText} onSubmitEditing={submit} returnKeyType="send" />
          <Pressable accessibilityRole="button" accessibilityLabel={t.chat.sendMessage} onPress={submit} style={x.sendBtn}>
            <Icon name="send" size={18} color={colors.primary} />
          </Pressable>
        </View>
        )}
      </KeyboardAvoidingView>

      <Sheet visible={menu === 'person'} title={chat.name} onClose={() => setMenu(null)}>
        {chat.blockedByMe
          ? <SheetOption icon="lock-open-outline" color={colors.primary} title={t.block.unblock} subtitle="" onPress={() => { setMenu(null); setBlocked(false) }} />
          : <SheetOption icon="ban" color={colors.danger} title={t.block.block} subtitle={t.block.blockSub} onPress={askBlock} />}
      </Sheet>

      <Sheet visible={menu === 'group'} title={chat.name} onClose={() => setMenu(null)}>
        <SheetOption icon={mine ? 'trash' : 'exit-outline'} color={colors.danger} title={mine ? t.chat.deleteGroup[0] : t.chat.leaveGroup[0]}
          subtitle={mine ? t.chat.deleteGroup[1] : t.chat.leaveGroup[1]} onPress={removeGroup} />
      </Sheet>

      <Sheet visible={menu === 'actions'} title={t.chat.moneySheet} onClose={() => setMenu(null)}>
        <SheetGrid items={mode === 'business' ? [
          { icon: 'arrow-up-circle-outline', label: t.common.send, onPress: () => send('money') },
          { icon: 'hand-left-outline', label: t.common.request, onPress: () => run(() => createRequest(id)) },
        ] : [
          { icon: 'arrow-up-circle-outline', label: t.common.send, onPress: () => send('money') },
          { icon: 'hand-left-outline', label: t.common.request, onPress: () => setMenu('request') },
          { icon: 'gift-outline', label: 'Mpho', onPress: () => send('mpho') },
          { icon: 'document-text-outline', label: t.chat.split, onPress: () => run(() => router.push({ pathname: '/split/new', params: { chatId: id } })) },
          { icon: 'image-outline', label: t.chat.photo, onPress: () => run(() => toast(t.chat.photo)) },
          { icon: 'location-outline', label: t.chat.location, onPress: () => run(() => toast(t.chat.locationToast)) },
          { icon: 'call-outline', label: t.common.call, onPress: () => run(() => toast(t.common.voiceCall)) },
          { icon: 'flash-outline', label: 'LEC', onPress: () => run(() => router.push('/lec')) },
        ]} />
      </Sheet>

      <Sheet visible={menu === 'request'} title={t.chat.requestFrom(chat.name)} onClose={() => setMenu(null)}>
        <SheetOption icon="cash-outline" color={colors.primary} title={t.chat.kopaTitle} subtitle={t.chat.kopaSub} onPress={() => run(() => createRequest(id))} />
        <SheetOption icon="receipt-outline" color="#E0482F" title={t.chat.ntefelleTitle} subtitle={t.chat.ntefelleSub} onPress={() => setMenu('bills')} />
      </Sheet>

      <Sheet visible={menu === 'bills'} title={t.chat.whichBill} onClose={() => setMenu(null)}>
        {BILL_KEYS.map((k) => (
          <SheetOption key={k} icon={BILL_ICON[k].icon} color={BILL_ICON[k].color} title={t.bills[k].name} subtitle={BILLS[k].detail} onPress={() => run(() => createRequest(id, k))} />
        ))}
      </Sheet>

      <Sheet visible={menu === 'members'} title={t.chat.pickMember} onClose={() => setMenu(null)}>
        {others(id).map((u) => (
          <SheetOption key={u.id} icon={chatIcon(u) ?? 'person'} title={u.name} subtitle={maskMsisdn(u.msisdn)} onPress={() => run(() => sendMoney(id, giftKind, u.id))} />
        ))}
      </Sheet>
    </SafeAreaView>
  )
}

const x = StyleSheet.create({
  request: { margin: 12, padding: 14, gap: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: '#D97706' },
  requestText: { fontSize: 14, lineHeight: 20, color: colors.text },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.bg, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted },
  msgs: { padding: 16, gap: 10, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  blockedBar: { justifyContent: 'space-between' },
  blockedText: { flex: 1, color: colors.muted, fontSize: 14.5 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  plus: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, height: 44, backgroundColor: colors.surface2, borderRadius: radius.pill, paddingHorizontal: 16, fontSize: 15, color: colors.text },
  officialNote: { textAlign: 'center', color: colors.muted, fontSize: 12.5, paddingTop: 12, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  typing: { alignSelf: 'flex-start', color: colors.muted, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 6 },
  ideas: { gap: 8, paddingBottom: 10 },
  idea: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  ideaText: { color: colors.primary, fontSize: 13.5, fontWeight: '600' },
  assistantNote: { textAlign: 'center', color: colors.muted, fontSize: 11.5, marginTop: 8 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
})
