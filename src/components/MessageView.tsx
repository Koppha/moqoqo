import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BILLS } from '../data/bills'
import { useT } from '../i18n'
import { fmt } from '../lib/format'
import { useAppState, useChat } from '../state/AppState'
import { useMoqoqo } from '../state/useMoqoqo'
import { useSplit } from '../state/useSplit'
import { colors, gradients, radius, shadow } from '../theme'
import { SPLIT_PROBLEM, type AssistantAction, type SplitShare, type SplitShareStatus } from '../../shared/api'
import { useAssistantAction } from '../lib/assistantActions'
import type { Message } from '../types'
import { BillIcon } from './TxIcon'
import { Sheet, SheetOption } from './Sheet'
import { Avatar, Icon, type IconName } from './ui'

export function MessageView({ chatId, m }: { chatId: string; m: Message }) {
  const t = useT()
  const { retryText } = useMoqoqo()
  const mine = m.from === 'me'
  const who = m.who ? <Text style={b.who}>{m.who}</Text> : null
  switch (m.type) {
    case 'system':
      return <Text style={b.system}>{m.text}</Text>
    case 'text':
      return (
        <Pressable disabled={!m.failed} onPress={() => retryText(chatId, m.id)} accessibilityRole={m.failed ? 'button' : undefined}
          style={[b.bubble, mine ? b.me : b.them, m.failed && b.failedBubble]}>
          {who}
          <Text style={[b.text, mine && { color: '#fff' }]}>{m.text}</Text>
          {m.failed
            ? <Text style={[b.time, { color: '#FFE1E1' }]}>{t.chat.retry}</Text>
            : <Text style={[b.time, mine && { color: '#E5DAF7' }]}>{m.pending ? '···' : m.time}</Text>}
        </Pressable>
      )
    case 'money':
      return (
        <View style={[b.card, mine ? b.right : b.left]}>
          {who}
          <View style={b.cardHead}>
            <Avatar name="money" icon={mine ? 'arrow-up' : 'arrow-down'} color={mine ? colors.primary : colors.success} size={32} />
            <Text style={b.cardLabel}>{mine ? t.msg.youSent : t.msg.received}</Text>
          </View>
          <Text style={b.amt}>{fmt(m.amount)}</Text>
          {m.note && <Text style={b.note}>{m.note}</Text>}
          <Text style={b.ok}>✓ {mine ? t.msg.delivered : t.msg.received} · {m.time}</Text>
        </View>
      )
    case 'mpho':
      return (
        <LinearGradient colors={gradients.mpho} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[b.card, mine ? b.right : b.left]}>
          <View style={b.cardHead}><Icon name="gift" size={22} color="#fff" /><Text style={[b.cardLabel, { color: '#fff' }]}>Mpho</Text></View>
          <Text style={[b.amt, { color: '#fff' }]}>{fmt(m.amount)}</Text>
          <Text style={[b.note, { color: '#FFE7D6' }]}>{m.note ?? t.msg.luckyEnvelope}</Text>
          <Text style={[b.ok, { color: '#FFE7B3' }]}>{t.msg.tapToOpen} · {m.time}</Text>
        </LinearGradient>
      )
    case 'receipt':
      return (
        <View style={[b.card, mine ? b.right : b.left]}>
          <View style={b.cardHead}><Avatar name="taxi" icon="wifi" color="#E0482F" size={32} /><Text style={b.cardLabel}>{t.msg.tapReceipt}</Text></View>
          <Text style={b.amt}>{fmt(m.amount)}</Text>
          <Text style={b.note}>{m.note}</Text>
          <Text style={b.ok}>✓ {t.msg.paidByTap} · {m.time}</Text>
        </View>
      )
    case 'request':
      return <RequestBubble chatId={chatId} m={m} />
    case 'action':
      return <ActionBubble m={m} />
    case 'cause':
      return <CauseBubble m={m} />
  }
}

/** A Donate cause shared in the chat: its progress, and a button to open it and give. */
function CauseBubble({ m }: { m: Extract<Message, { type: 'cause' }> }) {
  const t = useT()
  const c = m.cause
  const pct = Math.min(100, Math.round((c.raised / c.target) * 100))
  return (
    <View style={[b.card, m.from === 'me' ? b.right : b.left, { width: '82%' }]}>
      <View style={b.cardHead}>
        <Avatar name="donate" icon="heart" color="#DB2777" size={32} />
        <Text style={b.cardLabel}>{t.donate.cardLabel}</Text>
      </View>
      <Text style={[b.amt, { fontSize: 17 }]} numberOfLines={2}>{c.title}</Text>
      <View style={b.track}><View style={[b.fill, { width: `${pct}%` }]} /></View>
      <Text style={b.note}>{t.donate.raisedOf(fmt(c.raised), fmt(c.target))} · {t.donate.givers(c.donorCount)}</Text>
      <View style={b.btns}>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/donate/[code]', params: { code: c.code } })} style={[b.btn, { backgroundColor: c.status === 'open' ? '#DB2777' : colors.surface2 }]}>
          <Text style={[b.btnText, { color: c.status === 'open' ? '#fff' : colors.text }]}>{c.status === 'open' ? t.donate.give : t.donate.view}</Text>
        </Pressable>
      </View>
      <Text style={[b.note, { marginTop: 8 }]}>{m.time}</Text>
    </View>
  )
}

const ACTION_ICON: Record<AssistantAction['type'], IconName> = {
  send_money: 'arrow-up-circle',
  request_money: 'hand-left',
  buy_electricity: 'flash',
  top_up: 'card',
  bank_transfer: 'business',
  ecosure_quote: 'shield-checkmark',
  open: 'open-outline',
}

/** Something the EcoCash Assistant got ready. Tapping opens EcoCash Super App's own screen; the PIN is still asked there. */
function ActionBubble({ m }: { m: Extract<Message, { type: 'action' }> }) {
  const t = useT()
  const run = useAssistantAction()
  const open = m.action.type === 'open'
  return (
    <View style={[b.card, b.left, { width: '82%' }]}>
      <View style={b.cardHead}>
        <Avatar name="action" icon={ACTION_ICON[m.action.type]} color={colors.primary} size={32} />
        <Text style={[b.cardLabel, { color: colors.text, fontSize: 14.5 }]}>{m.text}</Text>
      </View>
      {!open && <Text style={b.note}>{t.assistant.confirmHint}</Text>}
      <View style={b.btns}>
        <Pressable accessibilityRole="button" onPress={() => run(m.action)} style={[b.btn, { backgroundColor: colors.primary }]}>
          <Text style={[b.btnText, { color: '#fff' }]}>{open ? t.assistant.open : t.assistant.review}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const SHARE_ICON: Record<SplitShareStatus, [IconName, string]> = {
  paid: ['checkmark-circle', colors.success],
  covered: ['checkmark-done-circle', colors.muted],
  collecting: ['time-outline', colors.warn],
  awaiting: ['ellipse-outline', colors.muted],
  declined: ['alert-circle', colors.danger],
  expired: ['alert-circle', colors.danger],
  lapsed: ['alert-circle', colors.danger],
  reassigned: ['arrow-redo-outline', colors.muted],
  cancelled: ['close-circle-outline', colors.muted],
}
const shortDate = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Split bill card: everyone's share and where it stands. A participant approves (then it is collected without a PIN),
 * declines, or pays what is left now. The organiser decides about declined, expired and lapsed shares, or cancels.
 */
function SplitBubble({ chatId, m }: { chatId: string; m: Extract<Message, { type: 'request' }> }) {
  const { payRequest } = useMoqoqo()
  const split = useSplit()
  const { state } = useAppState()
  const chat = useChat(chatId)
  const t = useT()
  const [deciding, setDeciding] = useState<SplitShare | null>(null)
  const [moving, setMoving] = useState<SplitShare | null>(null)
  const r = m.request
  const info = r.split!
  const shares = info.shares
  const meId = state.me?.id
  const mine = shares.find((s) => s.userId === meId)
  const organiser = m.from === 'me'
  const open = r.status === 'pending'
  const counted = shares.filter((s) => s.status !== 'reassigned')
  const doneCount = counted.filter((s) => s.status === 'paid' || s.status === 'covered').length
  const problems = shares.filter((s) => SPLIT_PROBLEM.includes(s.status))
  const shown = shares.slice(0, 8)
  const senderId = state.messages[chatId]?.find((x) => x.id === m.id)?.senderId
  const sender = chat?.members.find((u) => u.id === senderId)
  const organiserName = sender?.businessName ?? sender?.name ?? m.who ?? ''
  const owed = (s: SplitShare) => Math.round(((s.amount ?? 0) - s.paid) * 100) / 100
  const candidates = (chat?.members ?? []).filter((u) => !u.official && u.id !== meId && u.id !== info.payee?.id && !shares.some((s) => s.userId === u.id))
  return (
    <View style={[b.card, organiser ? b.right : b.left, { width: '82%' }]}>
      {m.who && <Text style={b.who}>{m.who}</Text>}
      <View style={b.cardHead}>
        <Avatar name="split" icon="document-text" color={colors.primary} size={32} />
        <Text style={b.cardLabel}>{t.split.title}{r.note ? ` · ${r.note}` : ''}</Text>
      </View>
      <Text style={b.amt}>{r.amount > 0 ? fmt(r.amount) : t.split.collected(fmt(r.paid ?? 0))}</Text>
      {info.payee && <Text style={b.note}>{t.split.forPayee(info.payee.name)}</Text>}
      {mine && !organiser && open && (
        <Text style={[b.note, { color: colors.text, fontWeight: '600' }]}>
          {mine.status === 'awaiting'
            ? mine.amount !== undefined ? t.split.yourShare(fmt(mine.amount)) : t.split.yourShareOpen
            : mine.status === 'collecting' ? t.split.youOwe(fmt(owed(mine))) : t.split.status[mine.status]}
        </Text>
      )}
      <View style={b.shares}>
        {shown.map((s) => {
          const [icon, color] = SHARE_ICON[s.status]
          const decide = organiser && open && SPLIT_PROBLEM.includes(s.status)
          return (
            <Pressable key={s.userId} disabled={!decide} onPress={() => setDeciding(s)} accessibilityRole={decide ? 'button' : undefined}
              accessibilityLabel={`${s.name}: ${t.split.status[s.status]}`} style={b.shareRow}>
              <Icon name={icon} size={16} color={color} />
              <View style={{ flex: 1 }}>
                <Text style={[b.shareName, s.status === 'reassigned' && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                  {s.userId === meId ? t.split.me(s.name) : s.name}
                </Text>
                {s.status !== 'paid' && <Text style={[b.shareStatus, decide && { color: colors.danger }]}>{t.split.status[s.status]}</Text>}
              </View>
              <Text style={b.shareAmt}>
                {s.amount === undefined ? '—' : s.status === 'collecting' ? `${fmt(s.paid)} / ${fmt(s.amount)}` : fmt(s.amount)}
              </Text>
              {decide && <Icon name="chevron-forward" size={14} color={colors.muted} />}
            </Pressable>
          )
        })}
        {shares.length > shown.length && <Text style={b.note}>{t.split.more(shares.length - shown.length)}</Text>}
      </View>
      {organiser && open && problems.length > 0 && <Text style={[b.note, { color: colors.danger }]}>{t.split.needsYou(problems.length)}</Text>}
      <Text style={[b.ok, open && { color: colors.warn }, r.status === 'cancelled' && { color: colors.muted }]}>
        {r.status === 'paid' ? t.split.allPaid : r.status === 'cancelled' ? t.split.isCancelled : t.split.progress(doneCount, counted.length)} · {m.time}
      </Text>

      {mine && !organiser && open && mine.status === 'awaiting' && (
        <>
          {mine.approveBy && <Text style={b.note}>{t.split.approveBy(shortDate(mine.approveBy))}</Text>}
          <Text style={[b.note, { fontSize: 12 }]}>{t.split.approveHint}</Text>
          <View style={b.btns}>
            <Pressable accessibilityRole="button" onPress={() => split.decline(m.id)} style={[b.btn, { backgroundColor: colors.surface2 }]}>
              <Text style={b.btnText}>{t.split.decline}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => split.approve(m.id, mine, organiserName, r.note)} style={[b.btn, { backgroundColor: colors.primary }]}>
              <Text style={[b.btnText, { color: '#fff' }]}>{mine.amount !== undefined ? t.split.approve(fmt(mine.amount)) : t.split.approveOpen}</Text>
            </Pressable>
          </View>
        </>
      )}
      {mine && !organiser && open && mine.status === 'collecting' && (
        <Pressable accessibilityRole="button" onPress={() => payRequest(chatId, m.id)} style={[b.btn, { backgroundColor: colors.primary, marginTop: 12, flex: 0 }]}>
          <Text style={[b.btnText, { color: '#fff' }]}>{t.split.payRest(fmt(owed(mine)))}</Text>
        </Pressable>
      )}
      {organiser && open && (
        <Pressable accessibilityRole="button" onPress={() => split.cancel(m.id, r)} style={[b.btn, { backgroundColor: colors.surface2, marginTop: 12, flex: 0 }]}>
          <Text style={b.btnText}>{t.split.cancelSplit}</Text>
        </Pressable>
      )}

      <Sheet visible={!!deciding} title={deciding ? t.split.decideTitle(deciding.name) : undefined} onClose={() => setDeciding(null)}>
        {deciding && (
          <>
            {deciding.amount !== undefined && owed(deciding) > 0 && (
              <SheetOption icon="arrow-redo" color={colors.primary} title={t.split.moveTo[0]} subtitle={t.split.moveTo[1]}
                onPress={() => { setMoving(deciding); setDeciding(null) }} />
            )}
            {r.toUserId !== meId && owed(deciding) > 0
              ? <SheetOption icon="wallet" color={colors.success} title={t.split.coverPay(fmt(owed(deciding)))[0]} subtitle={t.split.coverPay(fmt(owed(deciding)))[1]}
                  onPress={() => { const s = deciding; setDeciding(null); void split.cover(m.id, s, true) }} />
              : <SheetOption icon="checkmark-done" color={colors.success} title={t.split.coverIt[0]} subtitle={t.split.coverIt[1]}
                  onPress={() => { const s = deciding; setDeciding(null); void split.cover(m.id, s, false) }} />}
            <SheetOption icon="close-circle" color={colors.danger} title={t.split.cancelSplit} subtitle={t.split.cancelBody}
              onPress={() => { setDeciding(null); split.cancel(m.id, r) }} />
          </>
        )}
      </Sheet>
      <Sheet visible={!!moving} title={t.split.pickPerson} onClose={() => setMoving(null)}>
        {candidates.length === 0 && <Text style={[b.note, { textAlign: 'center', marginVertical: 16 }]}>{t.split.nobodyElse}</Text>}
        {moving && candidates.map((u) => (
          <SheetOption key={u.id} icon="person" color={colors.primary} title={u.name} subtitle={fmt(owed(moving))}
            onPress={() => { const s = moving; setMoving(null); void split.reassign(m.id, s.userId, u.id) }} />
        ))}
      </Sheet>
    </View>
  )
}

function RequestBubble({ chatId, m }: { chatId: string; m: Extract<Message, { type: 'request' }> }) {
  if (m.request.split) return <SplitBubble chatId={chatId} m={m} />
  return <PlainRequestBubble chatId={chatId} m={m} />
}

function PlainRequestBubble({ chatId, m }: { chatId: string; m: Extract<Message, { type: 'request' }> }) {
  const { payRequest, declineRequest, toast } = useMoqoqo()
  const t = useT()
  const chat = useChat(chatId)
  const r = m.request
  // Who asked: named in groups; in a direct chat it's the other person (or business).
  const requester = m.who ?? chat?.other?.businessName ?? chat?.name ?? ''
  const title = (bill: { name: string } | null) => (bill ? t.msg.payForMe(bill.name)
    : r.kind === 'cashout' ? t.msg.cashoutTitle(requester)
      : r.kind === 'merchant' ? t.msg.merchantTitle(requester)
        : t.msg.requestEcocash)
  const bill = r.bill ? t.bills[r.bill] : null
  const due = r.amount - (r.paid ?? 0)
  const mine = m.from === 'me'
  return (
    <View style={[b.card, mine ? b.right : b.left, { width: '82%' }]}>
      {m.who && <Text style={b.who}>{m.who}</Text>}
      <View style={b.cardHead}>
        {bill && r.bill
          ? <BillIcon bill={r.bill} name={bill.name} size={32} />
          : <Avatar name="request" icon={r.kind === 'cashout' ? 'cash' : r.kind === 'merchant' ? 'storefront' : 'hand-left'} color={colors.primary} size={32} />}
        <Text style={b.cardLabel}>{title(bill)}</Text>
      </View>
      <Text style={b.amt}>{fmt(r.amount)}</Text>
      {r.bill ? <Text style={b.note}>{r.detail ?? BILLS[r.bill].detail}</Text> : r.note ? <Text style={b.note}>{r.note}</Text> : null}
      {r.paid && r.status === 'pending' ? (
        <>
          <View style={b.track}><View style={[b.fill, { width: `${(r.paid / r.amount) * 100}%` }]} /></View>
          <Text style={b.note}>{t.msg.partial(fmt(r.paid), fmt(due))}</Text>
        </>
      ) : null}
      {r.status === 'paid' && <Text style={b.ok}>{t.msg.paidStatus(bill?.payee, r.paidBy)}</Text>}
      {r.status === 'declined' && <Text style={[b.ok, { color: colors.muted }]}>{t.msg.declined}</Text>}
      {r.status === 'cancelled' && <Text style={[b.ok, { color: colors.muted }]}>{t.msg.cancelled}</Text>}
      {r.status === 'pending' && !mine && (
        <View style={b.btns}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.msg.pay(fmt(due))} onPress={() => payRequest(chatId, m.id)} style={[b.btn, { backgroundColor: colors.primary }]}>
            <Text style={[b.btnText, { color: '#fff' }]}>{t.msg.pay(fmt(due))}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t.msg.decline} onPress={() => declineRequest(chatId, m.id)} style={[b.btn, { backgroundColor: colors.surface2 }]}>
            <Text style={b.btnText}>{t.msg.decline}</Text>
          </Pressable>
        </View>
      )}
      {r.status === 'pending' && mine && (
        <View style={[b.btns, { alignItems: 'center' }]}>
          <Text style={[b.ok, { color: colors.warn, flex: 1, marginTop: 0 }]}>{t.msg.waiting(m.time)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.msg.remind} onPress={() => toast(t.msg.reminderSent)} style={[b.btn, { backgroundColor: colors.surface2, flex: 0, paddingHorizontal: 16 }]}>
            <Text style={b.btnText}>{t.msg.remind}</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const b = StyleSheet.create({
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  failedBubble: { backgroundColor: colors.danger },
  system: { alignSelf: 'center', textAlign: 'center', maxWidth: '86%', fontSize: 12.5, color: colors.muted, backgroundColor: colors.surface2, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, overflow: 'hidden' },
  me: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  them: { alignSelf: 'flex-start', backgroundColor: colors.bubbleThem, borderBottomLeftRadius: 6 },
  text: { fontSize: 15, color: colors.text, lineHeight: 21 },
  time: { fontSize: 11, color: colors.muted, alignSelf: 'flex-end', marginTop: 2 },
  who: { fontSize: 12, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  card: { maxWidth: '82%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, ...shadow, shadowOpacity: 0.05 },
  left: { alignSelf: 'flex-start' },
  right: { alignSelf: 'flex-end' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLabel: { fontSize: 12.5, fontWeight: '600', color: colors.muted, flexShrink: 1 },
  amt: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 8 },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  ok: { fontSize: 12.5, fontWeight: '600', color: colors.success, marginTop: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden', marginTop: 10 },
  fill: { height: '100%', backgroundColor: colors.success },
  btns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 14, fontWeight: '700', color: colors.text },
  shares: { marginTop: 10, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shareStatus: { fontSize: 11.5, color: colors.muted },
  shareName: { flex: 1, fontSize: 13.5, color: colors.text },
  shareAmt: { fontSize: 13.5, fontWeight: '600', color: colors.text },
})
