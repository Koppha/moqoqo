import { router, type Href } from 'expo-router'
import type { AppKind, AssistantAction, AssistantScreen } from '../../shared/api'
import { useT } from '../i18n'
import { useMoqoqo } from '../state/useMoqoqo'
import { appModeNow } from '../state/Auth'

/** Where an `open` action goes in each app; screens an app doesn't have are left out. */
const SCREENS: Record<AppKind, Partial<Record<AssistantScreen, Href>>> = {
  customer: {
    transactions: '/transactions',
    my_qr: '/receive-money',
    receive_money: '/receive-money',
    pay: '/pay',
    money: '/money',
    split: '/split',
    topup: '/topup',
    bank: '/bank',
    remit: '/remit',
    ecosure: '/ecosure',
  },
  business: { transactions: '/transactions', my_qr: '/my-qr', receive_money: '/my-qr' },
  ecosure: { transactions: '/transactions', ecosure: '/ecosure' },
  society: { transactions: '/transactions' },
}

/**
 * Runs what the EcoCash Assistant prepared. Nothing here moves money: each action opens EcoCash Super App's usual screen,
 * pre-filled, and the user confirms with their PIN there (or backs out).
 */
export function useAssistantAction() {
  const { state, startChat, buyLec, toast } = useMoqoqo()
  const t = useT()

  /** The direct chat with a wallet number, opened (or started) so the money flow runs in it. */
  const chatWith = async (msisdn: string) => {
    const existing = Object.values(state.chats).find((c) => c.kind === 'direct' && c.members.some((u) => u.msisdn === msisdn))
    return existing?.id ?? (await startChat(msisdn))
  }

  return async function run(a: AssistantAction) {
    switch (a.type) {
      case 'send_money': {
        const id = await chatWith(a.msisdn)
        if (id) router.push({ pathname: '/chat/[id]', params: { id, send: String(a.amount), note: a.note ?? '' } })
        return
      }
      case 'request_money': {
        const id = await chatWith(a.msisdn)
        if (id) router.push({ pathname: '/chat/[id]', params: { id, request: String(a.amount) } })
        return
      }
      case 'buy_electricity':
        if (appModeNow() !== 'customer') return toast(t.assistant.notInThisApp)
        return buyLec(a.amount)
      case 'top_up':
        if (appModeNow() !== 'customer') return toast(t.assistant.notInThisApp)
        return router.push({ pathname: '/topup', params: { amount: String(a.amount) } })
      case 'bank_transfer':
        if (appModeNow() !== 'customer') return toast(t.assistant.notInThisApp)
        return router.push({ pathname: '/bank', params: { amount: String(a.amount) } })
      case 'ecosure_quote':
        if (appModeNow() !== 'customer') return toast(t.assistant.notInThisApp)
        return router.push({ pathname: '/ecosure/quote/[product]', params: { product: a.product } })
      case 'open': {
        const to = SCREENS[appModeNow()][a.screen]
        return to ? router.push(to) : toast(t.assistant.notInThisApp)
      }
    }
  }
}
