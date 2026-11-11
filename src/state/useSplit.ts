import { Alert } from 'react-native'
import type { Message as ApiMessage, SplitShare } from '../../shared/api'
import type { PaymentRequest } from '../types'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { fmt } from '../lib/format'
import { useAppState } from './AppState'
import { useDialogs } from './Dialogs'
import { useMoqoqo } from './useMoqoqo'

/** Split bill actions: approve, decline or pay my share; the organiser moves, covers or cancels. */
export function useSplit() {
  const { state, dispatch } = useAppState()
  const { askAmount, askPin } = useDialogs()
  const moqoqo = useMoqoqo()
  const { toast } = moqoqo
  // Split limits and state changes come back with a specific reason (e.g. "Pay your share now instead"): show it.
  const fail = (e: unknown) => (e instanceof ApiFailure && (e.code === 'VALIDATION' || e.code === 'CONFLICT') ? toast(e.message) : moqoqo.fail(e))
  const t = useT()
  const show = (message: ApiMessage) => dispatch({ type: 'message', message })

  async function approve(messageId: string, mine: SplitShare, organiser: string, note: string | undefined) {
    let amount = mine.amount
    if (amount === undefined) {
      const typed = await askAmount({ title: t.split.enterTitle, balance: state.balance, recipient: { name: organiser, subtitle: note ?? t.split.defaultNote, icon: 'document-text' }, confirmLabel: t.dialogs.continue })
      if (!typed) return
      amount = typed
    }
    const pin = await askPin({ amount, label: t.split.approveLabel(organiser) })
    if (!pin) return
    try {
      show(await api<ApiMessage>(`/v1/splits/${messageId}/approve`, { body: { pin, amount: mine.amount === undefined ? amount : undefined } }))
      toast(t.split.approved)
    } catch (e) {
      fail(e)
    }
  }

  async function decline(messageId: string) {
    try {
      show(await api<ApiMessage>(`/v1/requests/${messageId}/decline`, { method: 'POST' }))
      toast(t.split.declined)
    } catch (e) {
      fail(e)
    }
  }

  async function reassign(messageId: string, userId: string, toUserId: string) {
    try {
      show(await api<ApiMessage>(`/v1/splits/${messageId}/shares/${userId}/resolve`, { body: { action: 'reassign', userId: toUserId } }))
      toast(t.split.moved)
    } catch (e) {
      fail(e)
    }
  }

  /** needsPin: the money goes to someone else, so the organiser pays what is still owed. */
  async function cover(messageId: string, share: SplitShare, needsPin: boolean) {
    let pin: string | undefined
    if (needsPin) {
      const owed = Math.round(((share.amount ?? 0) - share.paid) * 100) / 100
      pin = (await askPin({ amount: owed, label: t.split.decideTitle(share.name) })) ?? undefined
      if (!pin) return
    }
    try {
      show(await api<ApiMessage>(`/v1/splits/${messageId}/shares/${share.userId}/resolve`, { body: { action: 'cover', pin } }))
      toast(t.split.covered)
    } catch (e) {
      fail(e)
    }
  }

  /** Refunds are offered only when the collected money came to the organiser. */
  function cancel(messageId: string, r: PaymentRequest) {
    const meId = state.me?.id
    const collected = (r.split?.shares ?? []).filter((s) => s.userId !== meId).reduce((a, s) => a + s.paid, 0)
    const canRefund = r.toUserId === meId && collected > 0
    const run = async (refund: boolean) => {
      const pin = await askPin({ label: t.split.cancelSplit })
      if (!pin) return
      try {
        show(await api<ApiMessage>(`/v1/splits/${messageId}/cancel`, { body: { pin, refund } }))
        toast(t.split.cancelled)
      } catch (e) {
        fail(e)
      }
    }
    Alert.alert(
      t.split.cancelTitle,
      canRefund ? `${t.split.cancelBody} ${t.split.refundAsk(fmt(collected))}` : t.split.cancelBody,
      canRefund
        ? [{ text: t.split.back, style: 'cancel' }, { text: t.split.keep, onPress: () => void run(false) }, { text: t.split.refund, onPress: () => void run(true) }]
        : [{ text: t.split.back, style: 'cancel' }, { text: t.split.cancelSplit, style: 'destructive', onPress: () => void run(false) }],
    )
  }

  return { approve, decline, reassign, cover, cancel }
}
