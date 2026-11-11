import { router, useLocalSearchParams } from 'expo-router'
import { useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ChatSummary, ContactMatch, Message, PublicUser, SplitMethod, SplitPayTo } from '../../../shared/api'
import { iconForChat } from '../../components/icons'
import { PeoplePicker, PeopleSearch, type Person } from '../../components/PeopleSearch'
import { Sheet, SheetOption } from '../../components/Sheet'
import { Avatar, Button, Header, Icon, Screen, type IconName } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { fmt, uid } from '../../lib/format'
import { FORM_MAX } from '../../lib/layout'
import { useAppState, useChat } from '../../state/AppState'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

type PayKind = 'me' | 'person' | 'merchant'
const PAY_KINDS: { key: PayKind; icon: IconName }[] = [
  { key: 'me', icon: 'person-circle-outline' },
  { key: 'person', icon: 'people-circle-outline' },
  { key: 'merchant', icon: 'storefront-outline' },
]

const METHODS: { key: SplitMethod; icon: IconName }[] = [
  { key: 'equal', icon: 'reorder-two-outline' },
  { key: 'specific', icon: 'create-outline' },
  { key: 'enter', icon: 'people-outline' },
]

/** Keeps a typed amount to digits and one decimal point with at most 2 decimals. */
const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
const toCents = (v: string | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/**
 * Split bill, step 2: how to split, the total, who is in, who gets the money, what it's for; then confirm with the PIN
 * and send to the chat. Everyone in the chat is selected at first, the organiser included: the organiser pays their
 * own cut now (or the whole bill when they pay a merchant in full), everyone else approves theirs.
 */
export default function NewSplit() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>()
  const t = useT()
  const chat = useChat(chatId)
  const { state, dispatch } = useAppState()
  const { fail, toast } = useMoqoqo()
  const { askPin } = useDialogs()
  const meId = state.me?.id
  // People added here who aren't in the chat: sending then makes a group chat for the bill with everyone in it.
  const [extras, setExtras] = useState<PublicUser[]>([])
  const people = [...(chat?.members ?? []).filter((u) => !u.official), ...extras]
  const ordered = [...people.filter((u) => u.id === meId), ...people.filter((u) => u.id !== meId)]

  const [method, setMethod] = useState<SplitMethod>('equal')
  const [total, setTotal] = useState('')
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [sheet, setSheet] = useState<'method' | 'payTo' | 'confirm' | null>(null)
  const [payKind, setPayKind] = useState<PayKind>('me')
  const [payee, setPayee] = useState('')
  // The name of the person picked to get the money (a friend, a phone contact); cleared when the field is typed in.
  const [payeeName, setPayeeName] = useState<string | null>(null)
  const [pickingPayee, setPickingPayee] = useState(false)
  const [covers, setCovers] = useState(true)
  const [choosing, setChoosing] = useState(false)
  const [sending, setSending] = useState(false)
  const clientId = useRef(uid())

  const selected = picked ?? new Set(ordered.map((u) => u.id))
  const chosen = ordered.filter((u) => selected.has(u.id))
  const others = chosen.filter((u) => u.id !== meId).length
  const totalCents = toCents(total)
  const sumCents = chosen.reduce((a, u) => a + toCents(amounts[u.id]), 0)
  const valid = others > 0 && (
    method === 'equal' ? totalCents >= chosen.length
      : method === 'specific' ? chosen.every((u) => toCents(amounts[u.id]) > 0)
        : total === '' || totalCents > 0) && (payKind === 'me' || payee.trim().length > 0)
  const nameOf = (id: string, name: string) => (id === meId ? t.split.me(name) : name)

  // What I pay now: my own cut, or the whole bill when I pay the merchant in full.
  const n = chosen.length
  const myCutCents = !selected.has(meId ?? '') ? 0
    : method === 'equal' ? Math.floor(totalCents / Math.max(n, 1)) + (n && totalCents % n ? 1 : 0)
      : method === 'specific' ? toCents(amounts[meId ?? '']) : 0
  const payNowCents = payKind === 'merchant' && covers ? (method === 'specific' ? sumCents : totalCents) : payKind === 'me' ? 0 : myCutCents
  const payTo: SplitPayTo | undefined = payKind === 'person' ? { subscriber: payee.trim() }
    : payKind === 'merchant' ? { merchantCode: payee.trim().toUpperCase(), organiserCovers: covers } : undefined

  const chooseKind = (k: PayKind) => {
    setPayKind(k)
    setPayee('')
    setPayeeName(null)
    // Members can only type their own amounts when the money comes to me.
    if (k !== 'me' && method === 'enter') setMethod('equal')
    setSheet(null)
  }

  const extraIds = new Set(extras.map((u) => u.id))
  const newGroup = chosen.some((u) => extraIds.has(u.id))
  const groupName = (note.trim() || t.split.defaultNote).slice(0, 60)

  /** Adds someone from the search: an EcoCash user, or a typed number looked up first. */
  const addPerson = async (p: Person): Promise<PublicUser | null> => {
    try {
      const user = p.user ?? (await api<ContactMatch[]>('/v1/contacts/match', { body: { msisdns: [p.msisdn] } }))[0]?.user
      if (!user) {
        // An alert, not a toast: the member picker covers the screen.
        Alert.alert(t.friends.notOnEcoCash, t.split.notOnEcoCashPerson(p.name))
        return null
      }
      if (user.id === meId || people.some((u) => u.id === user.id)) return null
      setExtras((x) => [...x, user])
      return user
    } catch (e) {
      fail(e)
      return null
    }
  }

  const send = async () => {
    setSheet(null)
    const pin = await askPin({ amount: payNowCents > 0 ? payNowCents / 100 : undefined, label: t.split.pinLabel(note.trim() || t.split.defaultNote) })
    if (!pin) return
    setSending(true)
    try {
      // Someone new is in the bill: a group chat with everyone in it, and the split goes there.
      let target = chatId
      if (newGroup) {
        const group = await api<ChatSummary>('/v1/chats', { body: { title: groupName, memberMsisdns: chosen.filter((u) => u.id !== meId).map((u) => u.msisdn) } })
        dispatch({ type: 'chat', chat: group })
        target = group.id
      }
      const message = await api<Message>('/v1/splits', {
        body: {
          chatId: target,
          clientId: clientId.current,
          method,
          total: method === 'specific' || (method === 'enter' && !totalCents) ? undefined : totalCents / 100,
          participants: chosen.map((u) => ({ userId: u.id, amount: method === 'specific' ? toCents(amounts[u.id]) / 100 : undefined })),
          note: note.trim() || undefined,
          pin,
          payTo,
        },
      })
      dispatch({ type: 'message', message })
      toast(t.split.sent)
      router.dismissAll()
      router.push(`/chat/${target}`)
    } catch (e) {
      fail(e)
    } finally {
      setSending(false)
    }
  }

  if (!chat) return null
  const [methodName] = t.split.methods[method]

  const summary = method === 'equal'
    ? <><Text style={s.sumLabel}>{t.split.each}</Text><Text style={[s.sumValue, !valid && s.dim]}>{fmt(valid ? Math.floor(totalCents / chosen.length) / 100 : 0)}</Text></>
    : method === 'specific'
      ? <><Text style={s.sumLabel}>{t.split.total}</Text><Text style={[s.sumValue, !valid && s.dim]}>{fmt(sumCents / 100)}</Text></>
      : <><Text style={s.sumLabel}>{methodName}</Text><Text style={s.sumText}>{t.split.membersEnter}</Text></>

  return (
    <Screen
      footer={
        <View style={s.footer}>
          {summary}
          <Button label={t.split.create} disabled={!valid} onPress={() => setSheet('confirm')} style={s.create} />
        </View>
      }>
      <Header title={t.split.title} />
      <Pressable accessibilityRole="button" accessibilityLabel={t.split.methodTitle} onPress={() => setSheet('method')} style={s.method}>
        <Text style={s.methodText}>{methodName}</Text>
        <Icon name="chevron-down" size={18} color={colors.primary} />
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel={t.split.payTo} onPress={() => setSheet('payTo')} style={s.row}>
        <Text style={s.rowLabel}>{t.split.payTo}</Text>
        <Text style={s.rowValue}>{t.split.payToKinds[payKind][0]}</Text>
        <Icon name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
      {payKind !== 'me' && (
        <View style={[s.block, s.payeeRow]}>
          <TextInput style={s.payee} value={payeeName ?? payee} autoCorrect={false}
            onChangeText={(v) => { setPayeeName(null); setPayee(payKind === 'merchant' ? v.replace(/\D/g, '') : v) }}
            autoCapitalize="none" keyboardType={payKind === 'merchant' ? 'number-pad' : 'default'}
            placeholder={payKind === 'person' ? t.split.personPlaceholder : t.split.merchantPlaceholder} placeholderTextColor={colors.muted}
            maxLength={40}
            accessibilityLabel={payKind === 'person' ? t.split.personPlaceholder : t.split.merchantPlaceholder} />
          {payKind === 'person' && (
            <Pressable accessibilityRole="button" accessibilityLabel={t.split.choosePerson} onPress={() => setPickingPayee(true)} hitSlop={10}>
              <Icon name="people-circle-outline" size={26} color={colors.primary} />
            </Pressable>
          )}
        </View>
      )}
      {payKind === 'merchant' && (
        <View style={s.block}>
          <Text style={s.blockTitle}>{t.split.merchantHow}</Text>
          {([[true, t.split.covers], [false, t.split.merchantWaits]] as const).map(([value, [title, subtitle]]) => (
            <Pressable key={title} accessibilityRole="radio" accessibilityState={{ checked: covers === value }} onPress={() => setCovers(value)} style={s.radioRow}>
              <Icon name={covers === value ? 'radio-button-on' : 'radio-button-off'} size={22} color={covers === value ? colors.primary : colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={s.radioTitle}>{title}</Text>
                <Text style={s.radioSub}>{subtitle}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={s.row}>
        <Text style={s.rowLabel}>{method === 'enter' ? t.split.totalOptional : t.split.total}</Text>
        {method === 'specific'
          ? <Text style={s.rowValue}>{fmt(sumCents / 100)}</Text>
          : (
            <View style={s.amountWrap}>
              <TextInput style={s.amountInput} value={total} onChangeText={(v) => setTotal(cleanAmount(v))} keyboardType="decimal-pad"
                placeholder="0.00" placeholderTextColor={colors.muted} accessibilityLabel={t.split.total} maxLength={9} />
              <Text style={s.currency}>M</Text>
            </View>
          )}
      </View>

      <Pressable accessibilityRole="button" onPress={() => setChoosing(true)} style={s.row}>
        <Text style={s.rowLabel}>{t.split.participants}</Text>
        <Text style={s.rowValue}>{chosen.length}</Text>
        <Icon name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>

      {method === 'specific' && (
        <View style={s.block}>
          {chosen.map((u, i) => (
            <View key={u.id} style={[s.shareRow, i < chosen.length - 1 && s.divider]}>
              <Avatar name={u.name} size={32} photo={u.photo} />
              <Text style={s.shareName} numberOfLines={1}>{nameOf(u.id, u.name)}</Text>
              <TextInput style={s.shareInput} value={amounts[u.id] ?? ''} onChangeText={(v) => setAmounts((a) => ({ ...a, [u.id]: cleanAmount(v) }))}
                keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted} accessibilityLabel={t.split.amountFor(u.name)} maxLength={9} />
              <Text style={s.currency}>M</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.block}>
        <TextInput style={s.note} value={note} onChangeText={setNote} placeholder={t.split.notePlaceholder} placeholderTextColor={colors.muted}
          maxLength={60} multiline accessibilityLabel={t.split.notePlaceholder} />
      </View>

      <Sheet visible={sheet === 'method'} title={t.split.methodTitle} onClose={() => setSheet(null)}>
        {METHODS.filter((m) => payKind === 'me' || m.key !== 'enter').map((m) => (
          <SheetOption key={m.key} icon={m.icon} color={colors.primary} title={t.split.methods[m.key][0]} subtitle={t.split.methods[m.key][1]}
            selected={method === m.key} onPress={() => { setMethod(m.key); setSheet(null) }} />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'payTo'} title={t.split.payTo} onClose={() => setSheet(null)}>
        {PAY_KINDS.map((k) => (
          <SheetOption key={k.key} icon={k.icon} color={colors.primary} title={t.split.payToKinds[k.key][0]} subtitle={t.split.payToKinds[k.key][1]}
            selected={payKind === k.key} onPress={() => chooseKind(k.key)} />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'confirm'} title={t.split.sendTo} onClose={() => setSheet(null)}>
        {/* Where the request is posted (who approves) is not who gets the money: say both. */}
        <View style={s.sendTo}>
          <View style={s.sendRow}>
            <Text style={s.sendLabel}>{t.split.postedIn}</Text>
            <View style={s.sendValueRow}>
              <Avatar name={newGroup ? groupName : chat.name} icon={newGroup ? 'people' : iconForChat(chat)} size={28} />
              <Text style={[s.sendValue, s.sendChat]} numberOfLines={1}>{newGroup ? groupName : chat.name}</Text>
            </View>
          </View>
          <View style={s.rule} />
          <View style={s.sendRow}>
            <Text style={s.sendLabel}>{t.split.moneyTo}</Text>
            <Text style={s.sendValue} numberOfLines={1}>
              {payKind === 'me' ? t.split.you : payKind === 'merchant' ? t.split.merchantNamed(payee.trim()) : payeeName ?? payee.trim()}
            </Text>
          </View>
          {note.trim() !== '' && (
            <>
              <View style={s.rule} />
              <View style={s.sendRow}>
                <Text style={s.sendLabel}>{t.split.forWhat}</Text>
                <Text style={s.sendValue} numberOfLines={1}>{note.trim()}</Text>
              </View>
            </>
          )}
        </View>
        {newGroup && <Text style={s.sendLine}>{t.split.newGroup(groupName)}</Text>}
        {payNowCents > 0 && (
          <Text style={[s.sendLine, { color: colors.text, fontWeight: '600' }]}>
            {payKind === 'merchant' && covers ? t.split.payNowAll(fmt(payNowCents / 100)) : t.split.payNowCut(fmt(payNowCents / 100))}
          </Text>
        )}
        <Text style={s.sendLine}>{t.split.howItWorks}</Text>
        <View style={s.sendBtns}>
          <Button label={t.split.cancel} variant="ghost" onPress={() => setSheet(null)} style={{ flex: 1 }} />
          <Button label={t.split.send} disabled={sending} onPress={send} style={{ flex: 1 }} />
        </View>
      </Sheet>

      <PeoplePicker visible={pickingPayee} title={t.split.choosePerson} onClose={() => setPickingPayee(false)}
        exclude={state.me ? new Set([state.me.msisdn]) : undefined}
        onPerson={(p) => { setPayee(p.msisdn); setPayeeName(p.user ? p.name : null); setPickingPayee(false) }} />

      <MemberPicker visible={choosing} people={ordered} selected={selected} meId={meId} onClose={() => setChoosing(false)}
        onDone={(next) => { setPicked(next); setChoosing(false) }} onAdd={addPerson} />
    </Screen>
  )
}

/**
 * "Select members": tick who shares the bill. Select all toggles everyone. Add people finds more (friends, phone
 * contacts, a number); they come in ticked.
 */
function MemberPicker({ visible, people, selected, meId, onClose, onDone, onAdd }: {
  visible: boolean; people: { id: string; name: string; msisdn: string; photo?: string }[]; selected: ReadonlySet<string>; meId?: string
  onClose: () => void; onDone: (s: ReadonlySet<string>) => void; onAdd: (p: Person) => Promise<PublicUser | null>
}) {
  const t = useT()
  const [draft, setDraft] = useState<ReadonlySet<string>>(selected)
  const [adding, setAdding] = useState(false)
  const all = draft.size === people.length
  const toggle = (id: string) => setDraft((d) => {
    const n = new Set(d)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const add = async (p: Person) => {
    const user = await onAdd(p)
    if (!user) return
    setDraft((d) => new Set(d).add(user.id))
    setAdding(false)
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (adding ? setAdding(false) : onClose())}
      onShow={() => { setDraft(selected); setAdding(false) }}>
      {adding ? (
        <SafeAreaView style={s.picker}>
          <View style={s.pickerHead}>
            <Pressable accessibilityLabel={t.common.back} onPress={() => setAdding(false)} style={s.pickerBack}><Icon name="chevron-back" size={26} /></Pressable>
            <Text style={s.pickerTitle}>{t.split.addPeople}</Text>
            <View style={s.pickerBack} />
          </View>
          <ScrollView contentContainerStyle={s.pickerList} keyboardShouldPersistTaps="handled">
            <PeopleSearch onPerson={add} exclude={new Set(people.map((u) => u.msisdn))} placeholder={t.split.searchPeople} autoFocus />
          </ScrollView>
        </SafeAreaView>
      ) : (
      <SafeAreaView style={s.picker}>
        <View style={s.pickerHead}>
          <Pressable accessibilityLabel={t.common.back} onPress={onClose} style={s.pickerBack}><Icon name="chevron-back" size={26} /></Pressable>
          <Text style={s.pickerTitle}>{t.split.selectMembers}</Text>
          <Pressable accessibilityRole="button" disabled={draft.size === 0} onPress={() => onDone(draft)}
            style={[s.okBtn, draft.size === 0 && { opacity: 0.45 }]}>
            <Text style={s.okText}>{t.split.ok(draft.size)}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.pickerList}>
          {people.map((u) => {
            const on = draft.has(u.id)
            return (
              <Pressable key={u.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(u.id)} style={s.pickRow}>
                <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={on ? colors.primary : colors.muted} />
                <Avatar name={u.name} size={40} photo={u.photo} />
                <Text style={s.pickName} numberOfLines={1}>{u.id === meId ? t.split.me(u.name) : u.name}</Text>
              </Pressable>
            )
          })}
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={s.pickRow}>
            <Icon name="add-circle" size={26} color={colors.primary} />
            <Text style={[s.pickName, s.addText]}>{t.split.addPeople}</Text>
          </Pressable>
        </ScrollView>
        <View style={s.pickerFoot}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: all }} style={s.selectAll}
            onPress={() => setDraft(all ? new Set() : new Set(people.map((u) => u.id)))}>
            <Icon name={all ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={all ? colors.primary : colors.muted} />
            <Text style={s.selectAllText}>{t.split.selectAll}</Text>
          </Pressable>
          <Text style={s.hint} numberOfLines={2}>{t.split.reminderHint}</Text>
        </View>
      </SafeAreaView>
      )}
    </Modal>
  )
}

const s = StyleSheet.create({
  method: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 6 },
  methodText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, height: 60, marginBottom: 12 },
  rowLabel: { flex: 1, fontSize: 16, color: colors.text },
  rowValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  amountWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  amountInput: { minWidth: 90, textAlign: 'right', fontSize: 17, fontWeight: '600', color: colors.text, paddingVertical: 8 },
  currency: { fontSize: 16, color: colors.text, fontWeight: '600' },
  block: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, marginBottom: 12 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  shareName: { flex: 1, fontSize: 15, color: colors.text },
  shareInput: { minWidth: 80, textAlign: 'right', fontSize: 16, fontWeight: '600', color: colors.text, paddingVertical: 6 },
  payeeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payee: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 16 },
  addText: { color: colors.primary, fontWeight: '600' },
  blockTitle: { fontSize: 14, color: colors.muted, paddingTop: 12, paddingBottom: 4 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  radioTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  radioSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  note: { fontSize: 16, color: colors.text, minHeight: 90, textAlignVertical: 'top', paddingVertical: 14 },
  footer: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  sumLabel: { fontSize: 14, color: colors.muted },
  sumValue: { fontSize: 40, fontWeight: '800', color: colors.text, marginTop: 2 },
  sumText: { fontSize: 15, color: colors.text, marginTop: 6, textAlign: 'center' },
  dim: { color: colors.muted },
  create: { alignSelf: 'stretch' },
  sendTo: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14 },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  sendLabel: { fontSize: 14, color: colors.muted },
  rule: { height: 1, backgroundColor: colors.border },
  sendChat: { flex: 0, flexShrink: 1 },
  sendValueRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  sendValue: { flex: 1, textAlign: 'right', fontSize: 16, fontWeight: '600', color: colors.text },
  sendLine: { fontSize: 14, color: colors.muted, marginTop: 14, marginHorizontal: 4 },
  sendBtns: { flexDirection: 'row', gap: 12, marginTop: 8 },
  picker: { flex: 1, backgroundColor: colors.bg },
  pickerHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  pickerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pickerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  okBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9 },
  okText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  pickerList: { paddingHorizontal: 16, paddingTop: 8, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  pickName: { flex: 1, fontSize: 16, color: colors.text },
  pickerFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 16 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectAllText: { fontSize: 16, fontWeight: '600', color: colors.text },
  hint: { flex: 1, textAlign: 'right', color: colors.muted, fontSize: 12.5 },
})
