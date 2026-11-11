import type { PushTestResult } from '../../../shared/api'
import type { FastifyBaseLogger } from 'fastify'
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFY_CHANNELS,
  NOTIFY_MATRIX,
  type ChoosableCategory,
  type NotificationStatus,
  type NotifyChannel,
} from '../../../shared/api'
import type { Db } from '../db/index'
import type { TransactionRow } from '../ecocash/index'
import { newId } from '../lib/crypto'
import { formatM } from '../lib/money'
import type { Hub } from '../realtime/hub'
import { toTransaction } from '../services/transactions'
import { getUsers } from '../services/users'
import type { Notice } from '../realtime/outbox'
import type { ExpoPush } from './expoPush'
import type { EmailGateway, SmsGateway } from './gateways'

interface Recipient {
  id: string
  msisdn: string | null
  email: string | null
  email_verified: boolean
  kind: 'person' | 'system'
}

interface Delivery {
  userId: string
  channel: NotifyChannel
  recipient: string
  status: NotificationStatus
  error?: string
}

export interface Notifier {
  /** Sends a notice on every channel each user allows. Never throws; failures are recorded and logged. */
  send(notice: Notice): Promise<void>
  /** Money in & out alerts for the wallets a ledger transfer touched. */
  transfer(tx: TransactionRow, balances: Map<string, number>): Promise<void>
  /** Resolves once everything queued so far has been sent (tests, shutdown). */
  idle(): Promise<void>
  /** Me › Notifications › Send a test: a push to this user's phones now, with how it went (prefs don't apply). */
  testPush(userId: string, title: string, body: string): Promise<PushTestResult>
  sms: SmsGateway
  email: EmailGateway
}

/** Is `category` on for this user and channel? Security alerts always are. */
export function allowed(prefs: Map<string, boolean>, channel: NotifyChannel, category: Notice['category']): boolean {
  if (category === 'security') return true
  if (!NOTIFY_MATRIX[channel].includes(category)) return false
  return prefs.get(`${channel}:${category}`) ?? DEFAULT_NOTIFICATION_PREFS[channel][category as ChoosableCategory] ?? false
}

export function createNotifier(opts: { db: Db; hub: Hub; log: FastifyBaseLogger; pushEnabled: boolean; push: ExpoPush; sms: SmsGateway; email: EmailGateway }): Notifier {
  const { db, log } = opts
  const pending = new Set<Promise<void>>()

  const track = (p: Promise<void>) => {
    const tracked = p.catch((err) => log.warn({ err: (err as Error).message }, 'notification failed')).finally(() => pending.delete(tracked))
    pending.add(tracked)
    return tracked
  }

  async function deliver(notice: Notice) {
    const users = await db.query<Recipient>(
      `SELECT id, msisdn, email, email_verified_at IS NOT NULL AS email_verified, kind FROM users WHERE id = ANY($1) AND status = 'active'`,
      [[...new Set(notice.userIds)]],
    )
    const people = users.filter((u) => u.kind === 'person')
    if (!people.length) return
    const prefRows = await db.query<{ user_id: string; channel: string; category: string; enabled: boolean }>(
      'SELECT user_id, channel, category, enabled FROM notification_prefs WHERE user_id = ANY($1)',
      [people.map((u) => u.id)],
    )
    const prefs = new Map<string, Map<string, boolean>>()
    for (const r of prefRows) {
      const m = prefs.get(r.user_id) ?? new Map<string, boolean>()
      m.set(`${r.channel}:${r.category}`, r.enabled)
      prefs.set(r.user_id, m)
    }
    const channels = notice.channels ?? NOTIFY_CHANNELS
    const wants = (u: Recipient, channel: NotifyChannel) => channels.includes(channel) && allowed(prefs.get(u.id) ?? new Map(), channel, notice.category)

    const deliveries: Delivery[] = []
    // An app open on screen shows chat messages itself; push only when it isn't.
    const pushTo = people.filter((u) => wants(u, 'push') && !(notice.pushOnlyOffline && opts.hub.isActive(u.id)))
    if (pushTo.length) deliveries.push(...(await sendPush(pushTo.map((u) => u.id), notice)))

    for (const u of people) {
      if (u.msisdn && wants(u, 'sms')) {
        deliveries.push(await attempt(u.id, 'sms', u.msisdn, opts.sms.real, () => opts.sms.send(u.msisdn!, `EcoCash Super App: ${notice.body}`)))
      }
      if (u.email && u.email_verified && wants(u, 'email')) {
        deliveries.push(await attempt(u.id, 'email', u.email, opts.email.real, () => opts.email.send(u.email!, notice.title, emailText(notice.body))))
      }
    }
    if (!deliveries.length) return
    const values: unknown[] = []
    const rows = deliveries.map((d, i) => {
      values.push(newId(), d.userId, d.channel, notice.category, d.recipient, notice.title, notice.body, d.status, d.error ?? null)
      const o = i * 9
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9})`
    })
    await db.query(`INSERT INTO notifications (id, user_id, channel, category, recipient, title, body, status, error) VALUES ${rows.join(', ')}`, values)
  }

  async function attempt(userId: string, channel: NotifyChannel, recipient: string, real: boolean, send: () => Promise<void>): Promise<Delivery> {
    try {
      await send()
      return { userId, channel, recipient, status: real ? 'sent' : 'mock' }
    } catch (err) {
      log.warn({ channel, err: (err as Error).message }, 'notification provider refused')
      return { userId, channel, recipient, status: 'failed', error: (err as Error).message.slice(0, 300) }
    }
  }

  /**
   * Push to each user: through Expo to registered devices when PUSH_ENABLED, otherwise (or for users with no device
   * registered) over the live connection to an app in the background. Anything left is recorded as a mock.
   */
  async function sendPush(userIds: string[], notice: Notice): Promise<Delivery[]> {
    const devices = await db.query<{ user_id: string; expo_push_token: string }>('SELECT user_id, expo_push_token FROM devices WHERE user_id = ANY($1)', [userIds])
    const count = (id: string) => devices.filter((d) => d.user_id === id).length
    const recipient = (id: string) => (count(id) === 1 ? '1 device' : `${count(id)} devices`)
    const viaExpo = opts.pushEnabled ? userIds.filter((id) => count(id) > 0) : []
    const out: Delivery[] = []
    for (const userId of userIds.filter((id) => !viaExpo.includes(id))) {
      const n = opts.hub.sendToBackground(userId, { type: 'notification', title: notice.title, body: notice.body, data: notice.data ?? {} })
      out.push(n ? { userId, channel: 'push', recipient: 'app (live connection)', status: 'sent' } : { userId, channel: 'push', recipient: count(userId) ? recipient(userId) : 'no device yet', status: 'mock' })
    }
    if (!viaExpo.length) return out
    const sent = await opts.push.send(devices.filter((d) => viaExpo.includes(d.user_id)), { title: notice.title, body: notice.body, data: notice.data ?? {} })
    return [
      ...out,
      ...viaExpo.map((userId): Delivery => {
        const r = sent.get(userId)
        const status: NotificationStatus = r?.ok ? 'sent' : 'failed'
        return { userId, channel: 'push', recipient: recipient(userId), status, error: r?.ok ? undefined : r?.error ?? 'not sent' }
      }),
    ]
  }

  async function transfer(tx: TransactionRow, balances: Map<string, number>) {
    if (tx.amount_cents <= 0 || SILENT.has(tx.kind)) return
    const users = await getUsers(db, [tx.from_user_id, tx.to_user_id].filter((x): x is string => !!x))
    for (const userId of [tx.from_user_id, tx.to_user_id]) {
      if (!userId || users.get(userId)?.kind !== 'person') continue
      const t = toTransaction(tx, userId, users)
      const balance = balances.get(userId)
      const body = `${t.description}: ${t.amount < 0 ? '-' : '+'}${formatM(tx.amount_cents)}. Ref ${tx.reference}.${balance !== undefined ? ` Balance ${formatM(balance)}.` : ''}`
      // Payments that post a chat message already push through the chat; push here only for the rest.
      const channels: NotifyChannel[] = tx.message_id ? ['sms', 'email'] : ['push', 'sms', 'email']
      await deliver({ userIds: [userId], category: 'money', title: t.amount < 0 ? 'Money out' : 'Money in', body, channels, data: { screen: 'transactions' } })
    }
  }

  return {
    send: (notice) => track(deliver(notice)),
    async testPush(userId, title, body) {
      const [d] = await sendPush([userId], { userIds: [userId], category: 'security', title, body, data: { screen: 'notifications' } })
      // 'mock': push isn't switched on for this server (PUSH_ENABLED) or the phone has no push token yet.
      return { status: d.status === 'sent' ? (opts.pushEnabled ? 'sent' : 'live') : d.status === 'failed' ? 'failed' : 'off', error: d.error ?? null, devices: d.recipient }
    },
    transfer: (tx, balances) => track(transfer(tx, balances)),
    async idle() {
      while (pending.size) await Promise.all([...pending])
    },
    sms: opts.sms,
    email: opts.email,
  }
}

/** Ledger kinds that don't alert: fees go with the payment they belong to, registration moves no money. */
const SILENT = new Set<TransactionRow['kind']>(['fee', 'register'])

const emailText = (body: string) => `${body}\n\n— EcoCash Super App, Econet Telecom Lesotho\nChoose which emails you get in EcoCash Super App: Me › Notifications.`
