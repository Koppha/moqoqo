import { useCallback, useEffect, useRef } from 'react'
import { Platform, AppState as RNAppState } from 'react-native'
import type { AppConfig, ChatSummary, Me, Message, ServerEvent, Transaction } from '../../shared/api'
import { api, setMaintenanceHandler } from '../lib/api'
import { getPushToken, showPush } from '../lib/notifications'
import { announce } from '../lib/soundbox'
import { useLanguage, useT } from '../i18n'
import { toMessage } from '../lib/mappers'
import { preview } from '../lib/preview'
import { APP } from '../lib/variant'
import { Realtime } from '../lib/realtime'
import { useAppState } from './AppState'
import { useAuth } from './Auth'

const CONFIG_POLL_MS = 5 * 60_000

/**
 * Keeps AppState in step with the server: a full load after sign-in and after every reconnect
 * (so nothing is missed while offline), then live updates over the WebSocket.
 * App config (maintenance, announcements) is polled even when signed out.
 */
export function Sync() {
  const { state, dispatch } = useAppState()
  // The soundbox speaks in the app's language (Sesotho when the phone has a Sesotho voice).
  const { lang } = useLanguage()
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  const { session, updateUser } = useAuth()
  const token = session?.token ?? null
  const rt = useRef<Realtime | null>(null)
  const openChat = useRef<string | null>(null)
  useEffect(() => { openChat.current = state.openChatId }, [state.openChatId])
  // For a message banner while the app is open: the chat's name and members, who I am, and the words to use.
  const t = useT()
  const banner = useRef({ chats: state.chats, me: state.me?.id, t })
  useEffect(() => { banner.current = { chats: state.chats, me: state.me?.id, t } }, [state.chats, state.me?.id, t])

  // ---- app config: on launch, every 5 minutes, on foreground ----
  const loadConfig = useCallback(async () => {
    try {
      dispatch({ type: 'config', config: await api<AppConfig>('/v1/app-config') })
    } catch {
      // Offline or server down: keep the last known config.
    }
  }, [dispatch])

  useEffect(() => {
    loadConfig()
    const timer = setInterval(loadConfig, CONFIG_POLL_MS)
    const sub = RNAppState.addEventListener('change', (s) => {
      rt.current?.setActive(s === 'active')
      if (s !== 'active') return
      loadConfig()
      rt.current?.poke()
    })
    setMaintenanceHandler((m) => dispatch({ type: 'maintenanceHit', maintenance: m ?? null }))
    return () => {
      clearInterval(timer)
      sub.remove()
      setMaintenanceHandler(null)
    }
  }, [loadConfig, dispatch])

  // ---- signed-in data ----
  const loadAll = useCallback(async () => {
    try {
      const [me, chats, transactions] = await Promise.all([
        api<Me>('/v1/me'),
        api<ChatSummary[]>('/v1/chats'),
        api<Transaction[]>('/v1/transactions?limit=50'),
      ])
      dispatch({ type: 'me', me })
      updateUser(me)
      dispatch({ type: 'chats', chats })
      dispatch({ type: 'transactions', transactions })
      // Let the server push to this phone when the app isn't open (needs an EAS project ID for a token).
      const pushToken = getPushToken()
      if (pushToken && Platform.OS !== 'web') {
        api('/v1/devices', { body: { expoPushToken: pushToken, platform: Platform.OS, app: APP === 'customer' && me.role !== 'customer' ? 'business' : APP } }).catch(() => {})
      }
      // Recent messages of every chat, so pending requests show on Home without opening each chat.
      await Promise.all(chats.map(async (c) => {
        const messages = await api<Message[]>(`/v1/chats/${c.id}/messages?limit=50`)
        dispatch({ type: 'messages', chatId: c.id, messages })
      }))
    } catch {
      // Offline: the realtime reconnect calls loadAll again.
    }
  }, [dispatch, updateUser])

  useEffect(() => {
    // A new account (sign-in, or a business opened from EcoCash Super App and back): nothing of the last one stays.
    dispatch({ type: 'reset' })
    if (!token) return
    const onEvent = (e: ServerEvent) => {
      switch (e.type) {
        case 'message.created':
        case 'message.updated':
          dispatch({ type: 'message', message: e.message })
          if (e.type === 'message.created' && openChat.current === e.message.chatId) {
            api(`/v1/chats/${e.message.chatId}/read`, { method: 'POST' }).catch(() => {})
          } else if (e.type === 'message.created' && RNAppState.currentState === 'active') {
            // On screen but elsewhere in the app (the server pushes only to apps in the background): show it like a push.
            const { chats, me, t: words } = banner.current
            const chat = chats[e.message.chatId]
            if (me && chat && e.message.senderId !== me && !chat.request && e.message.kind !== 'system') {
              const body = preview(toMessage(e.message, me, chat.members, chat.kind === 'group'), words)
              showPush(chat.title, body, { url: `/chat/${chat.id}` })
            }
          }
          break
        case 'chat.created':
          dispatch({ type: 'chat', chat: e.chat })
          break
        case 'chat.removed':
          dispatch({ type: 'chatRemoved', chatId: e.chatId })
          break
        case 'balance':
          dispatch({ type: 'balance', balance: e.balance })
          // A balance change means a new ledger entry; refresh the list, and say money in out loud (soundbox).
          api<Transaction[]>('/v1/transactions?limit=50').then((transactions) => {
            dispatch({ type: 'transactions', transactions })
            if (transactions[0]) announce(transactions[0], langRef.current)
          }).catch(() => {})
          break
        case 'config':
          dispatch({ type: 'config', config: e.config })
          break
        case 'intent.updated':
          dispatch({ type: 'intent', intent: e.intent })
          break
        case 'notification':
          // Sent only while this app is in the background: show it like a push.
          if (RNAppState.currentState !== 'active') showPush(e.title, e.body, e.data)
          break
        case 'chat.typing':
          dispatch({ type: 'typing', chatId: e.chatId, typing: e.typing })
          break
      }
    }
    const r = new Realtime(token, onEvent, (online) => dispatch({ type: 'online', online }), loadAll)
    rt.current = r
    r.start()
    return () => {
      r.stop()
      rt.current = null
    }
  }, [token, dispatch, loadAll])

  return null
}
