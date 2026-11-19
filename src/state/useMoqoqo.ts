import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import type {
  BillKey, BillResult, ChatSummary, Message as ApiMessage, MoneyResult, PayRequestResult, PublicUser, SplitShare,
} from '../../shared/api'
import { BILL_ICON, chatIcon } from '../components/icons'
import { BILLS } from '../data/bills'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { fmt, maskMsisdn, uid } from '../lib/format'
import { enableNotifications } from '../lib/notifications'
import { useAppState } from './AppState'
import { useDialogs, type Recipient } from './Dialogs'

export const TAXI_MERCHANT = '1042'
export const TAXI_FARE = 12

// All user-facing money and chat operations. Each one: ask for amount/PIN → call the EcoCash Super App API → update state.
export function useMoqoqo() {
  const { state, dispatch } = useAppState()
  const { askAmount, askPin } = useDialogs()
  const t = useT()
  const me = state.me

  const toast = (text: string) => dispatch({ type: 'toast', text })

  const fail = (e: unknown) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    const code = e instanceof ApiFailure ? e.code : 'UNKNOWN'
    toast(t.errors[code])
  }

  /** Shared success handling for every call that moved money. */
  const settled = (res: MoneyResult) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    dispatch({ type: 'balance', balance: res.balance })
    dispatch({ type: 'transaction', transaction: res.transaction })
    if (res.message) dispatch({ type: 'message', message: res.message })
  }

  const others = (chatId: string): PublicUser[] => (state.chats[chatId]?.members ?? []).filter((u) => u.id !== me?.id)

  const recipientOf = (u: PublicUser): Recipient => ({
    name: u.businessName ?? u.name,
    subtitle: maskMsisdn(u.msisdn),
    icon: chatIcon(u),
  })

  /**
   * Send money or an Mpho envelope. In a group, `toUserId` says which member (picked in the chat).
   * `preset`: amount and note prepared by the EcoCash Assistant; the amount screen opens pre-filled.
   */
  async function sendMoney(chatId: string, kind: 'money' | 'mpho', toUserId?: string, preset?: { amount: number; note?: string }) {
    const to = others(chatId).find((u) => (toUserId ? u.id === toUserId : true))
    if (!to) return
    const amount = await askAmount({ title: kind === 'mpho' ? t.flows.mphoTitle : t.flows.sendTitle, balance: state.balance, recipient: recipientOf(to), confirmLabel: kind === 'mpho' ? t.flows.sendMpho : t.flows.sendMoney, initial: preset?.amount })
    if (!amount) return
    const pin = await askPin({ amount, label: kind === 'mpho' ? t.flows.mphoTo(to.name) : t.flows.sendTo(to.name) })
    if (!pin) return
    try {
      const res = await api<MoneyResult>('/v1/payments/send', {
        body: { chatId, toUserId: to.id, amount, pin, kind, clientId: uid(), note: kind === 'mpho' ? 'Mahlohonolo! 🎉' : preset?.note },
      })
      settled(res)
      toast(t.flows.sent(fmt(amount)))
    } catch (e) {
      fail(e)
    }
  }

  /**
   * Kopa (money) or Ntefelle (pay a bill for me). No money moves until someone in the chat pays.
   * `billFor`: the bill's own account and detail (a learner's school fees), instead of the demo account.
   * Resolves true when the request was sent.
   */
  async function createRequest(chatId: string, bill?: BillKey, presetAmount?: number, billFor?: { account: string; detail: string }): Promise<boolean> {
    const chat = state.chats[chatId]
    if (!chat) return false
    const billAccount = bill ? billFor?.account ?? BILLS[bill].account : undefined
    const billDetail = bill ? billFor?.detail ?? BILLS[bill].detail : undefined
    const recipient: Recipient = bill
      ? { name: t.bills[bill].name, subtitle: t.flows.billPays(billDetail ?? '', chat.title), icon: BILL_ICON[bill].icon, color: BILL_ICON[bill].color }
      : { name: chat.title, subtitle: chat.kind === 'group' ? t.common.group : maskMsisdn(others(chatId)[0]?.msisdn ?? ''), icon: chat.kind === 'group' ? 'people' : undefined }
    const amount = await askAmount({ title: bill ? t.flows.payForMe : t.flows.requestMoney, balance: state.balance, recipient, confirmLabel: t.flows.sendRequest, initial: presetAmount })
    if (!amount) return false
    try {
      const message = await api<ApiMessage>('/v1/requests', {
        body: bill
          ? { chatId, clientId: uid(), amount, kind: 'bill', bill, account: billAccount, detail: billDetail }
          : { chatId, clientId: uid(), amount, kind: 'money' },
      })
      dispatch({ type: 'message', message })
      toast(t.flows.requestSent)
      // Good moment to ask: the user is now waiting to hear back.
      enableNotifications()
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  /** School fees for a learner, paid straight to the school fees biller with the learner's reference. */
  async function paySchool(amount: number, account: string, label: string): Promise<boolean> {
    const pin = await askPin({ amount, label })
    if (!pin) return false
    try {
      settled(await api<BillResult>('/v1/bills/pay', { body: { bill: 'school', account, amount, pin } }))
      toast(t.flows.paidDirect(t.bills.school.payee))
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  /** Pay a request someone sent us. Bills go straight to the biller, never via the requester. */
  async function payRequest(chatId: string, messageId: string) {
    const msg = state.messages[chatId]?.find((m) => m.id === messageId)
    const r = msg?.request
    if (!msg || !r) return
    const due = r.amount - r.paid
    const requester = state.chats[chatId]?.members.find((u) => u.id === msg.senderId)
    const requesterName = requester?.businessName ?? requester?.name ?? ''
    if (r.split) return payShare(messageId, r.split.shares.find((s) => s.userId === me?.id), requesterName, r.note)
    const names = r.bill ? t.bills[r.bill] : null
    const label = names ? t.flows.billFor(names.name, requesterName, names.payee)
      : r.kind === 'cashout' ? t.flows.cashOutAt(requesterName)
        : t.flows.pay(requesterName)
    const pin = await askPin({ amount: due, label })
    if (!pin) return
    try {
      const res = await api<PayRequestResult>(`/v1/requests/${messageId}/pay`, { body: { pin } })
      settled(res)
      toast(names ? t.flows.paidDirect(names.payee) : r.kind === 'cashout' ? t.flows.collectCash(fmt(due)) : t.common.paid)
    } catch (e) {
      fail(e)
    }
  }

  /**
   * Split bill: pay everything I still owe on my share now, with my PIN (members type it themselves when the
   * organiser chose "members enter amount" and they haven't approved an amount yet).
   */
  async function payShare(messageId: string, mine: SplitShare | undefined, organiser: string, note: string | undefined) {
    if (!mine || (mine.status !== 'awaiting' && mine.status !== 'collecting')) return
    let amount = mine.amount === undefined ? undefined : Math.round((mine.amount - mine.paid) * 100) / 100
    if (amount === undefined) {
      const typed = await askAmount({ title: t.split.enterTitle, balance: state.balance, recipient: { name: organiser, subtitle: note ?? t.split.defaultNote, icon: 'document-text' }, confirmLabel: t.dialogs.continue })
      if (!typed) return
      amount = typed
    }
    const pin = await askPin({ amount, label: t.flows.pay(organiser) })
    if (!pin) return
    try {
      settled(await api<PayRequestResult>(`/v1/requests/${messageId}/pay`, { body: { pin, amount: mine.amount === undefined ? amount : undefined } }))
      toast(t.common.paid)
    } catch (e) {
      fail(e)
    }
  }

  async function declineRequest(_chatId: string, messageId: string) {
    try {
      dispatch({ type: 'message', message: await api<ApiMessage>(`/v1/requests/${messageId}/decline`, { method: 'POST' }) })
      toast(t.flows.requestDeclined)
    } catch (e) {
      fail(e)
    }
  }

  /** The official chat with a biller or merchant, by name fragment or merchant code. */
  const findChat = (match: (u: PublicUser) => boolean) =>
    Object.values(state.chats).find((c) => c.kind !== 'group' && c.members.some((u) => u.id !== me?.id && match(u)))?.id

  /** LEC prepaid token for a meter (the demo meter when none is given), delivered in the LEC chat. */
  async function buyLec(amount: number, meter: string = BILLS.lec.account) {
    const pin = await askPin({ amount, label: `${t.bills.lec.name} · ${meter}` })
    if (!pin) return
    try {
      const res = await api<BillResult>('/v1/bills/pay', { body: { bill: 'lec', account: meter, amount, pin } })
      settled(res)
      // The token arrives in the LEC chat; that chat may be new, so refresh the list before opening it.
      const chats = await api<ChatSummary[]>('/v1/chats')
      dispatch({ type: 'chats', chats })
      const lec = chats.find((c) => c.kind === 'official' && c.members.some((u) => u.official && /LEC/i.test(u.name)))
      if (lec) {
        dispatch({ type: 'messages', chatId: lec.id, messages: await api<ApiMessage[]>(`/v1/chats/${lec.id}/messages?limit=50`) })
        router.replace(`/chat/${lec.id}`)
      }
      toast(t.flows.tokenDelivered)
    } catch (e) {
      fail(e)
    }
  }

  /** Customer side of tap to pay (closed loop, under the no-PIN limit). */
  async function tapToPay() {
    try {
      settled(await api<MoneyResult>('/v1/payments/tap', { body: { merchantCode: TAXI_MERCHANT, amount: TAXI_FARE } }))
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  const taxiChatId = () => findChat((u) => u.businessName?.includes('Mokoena') || u.name.includes('Mokoena'))

  /** Text message with an optimistic bubble; marked failed (tap to retry) if the server refuses it. */
  async function sendText(chatId: string, text: string) {
    if (!me) return
    const clientId = uid()
    dispatch({ type: 'message', message: { id: `local:${clientId}`, chatId, senderId: me.id, clientId, kind: 'text', text, createdAt: new Date().toISOString() } })
    try {
      dispatch({ type: 'message', message: await api<ApiMessage>(`/v1/chats/${chatId}/messages`, { body: { clientId, text } }) })
    } catch (e) {
      dispatch({ type: 'sendFailed', chatId, clientId })
      if (e instanceof ApiFailure && e.code !== 'NETWORK') fail(e)
    }
  }

  async function retryText(chatId: string, localId: string) {
    const m = state.messages[chatId]?.find((x) => x.id === localId)
    if (!m?.text || !m.clientId || !me) return
    dispatch({ type: 'message', message: { ...m } })
    try {
      dispatch({ type: 'message', message: await api<ApiMessage>(`/v1/chats/${chatId}/messages`, { body: { clientId: m.clientId, text: m.text } }) })
    } catch {
      dispatch({ type: 'sendFailed', chatId, clientId: m.clientId })
    }
  }

  /** Open (or create) a direct chat with a wallet number. Returns the chat id. */
  async function startChat(msisdn: string) {
    try {
      const chat = await api<ChatSummary>('/v1/chats', { body: { msisdn } })
      dispatch({ type: 'chat', chat })
      dispatch({ type: 'messages', chatId: chat.id, messages: await api<ApiMessage[]>(`/v1/chats/${chat.id}/messages?limit=50`) })
      return chat.id
    } catch (e) {
      fail(e)
      return null
    }
  }

  return {
    state, dispatch, toast, fail, settled, others,
    sendMoney, createRequest, payRequest, declineRequest, buyLec, paySchool, tapToPay, taxiChatId,
    sendText, retryText, startChat,
  }
}
