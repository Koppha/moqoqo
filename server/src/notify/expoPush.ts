// Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/): up to 100 messages a request,
// one per device. Each push ticket says whether Expo accepted that message; DeviceNotRegistered means the phone's
// token is dead and its device row goes. Accepted tickets are kept so their receipts can be read ~15 minutes later,
// which say whether FCM/APNs took the message (and catch dead tokens and bad credentials Expo only finds then).
// Network errors, 429 and 5xx are retried with backoff; other errors are not (the request itself is wrong).
import type { FastifyBaseLogger } from 'fastify'
import type { Db } from '../db/index'

const SEND_URL = 'https://exp.host/--/api/v2/push/send'
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
const SEND_BATCH = 100
const RECEIPT_BATCH = 1000
const RECEIPT_AFTER_MS = 15 * 60_000
const ATTEMPTS = 3

export interface PushDevice { user_id: string; expo_push_token: string }
export interface PushMessage { title: string; body: string; data: Record<string, unknown> }
/** Per user: accepted by Expo for at least one device, or the first error. */
export type PushResult = Map<string, { ok: boolean; error?: string }>

interface Ticket { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }
interface Receipt { status: 'ok' | 'error'; message?: string; details?: { error?: string } }

export interface ExpoPush {
  send(devices: PushDevice[], message: PushMessage): Promise<PushResult>
  /** Reads receipts for tickets older than 15 minutes; removes dead tokens. */
  checkReceipts(): Promise<{ checked: number; removed: number }>
  start(): void
  stop(): void
}

export function createExpoPush(opts: {
  db: Db
  log: FastifyBaseLogger
  /** Expo access token, when "enhanced security for push" is on for the project. */
  accessToken: string | null
  fetch?: typeof fetch
  /** Waits between retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
  receiptEveryMs?: number
}): ExpoPush {
  const { db, log } = opts
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  if (opts.accessToken) headers.authorization = `Bearer ${opts.accessToken}`

  /** POSTs JSON, retrying network errors, 429 and 5xx with exponential backoff and jitter. */
  async function post<T>(url: string, body: unknown): Promise<T> {
    let last = ''
    for (let i = 0; i < ATTEMPTS; i++) {
      if (i) await sleep(1000 * 2 ** (i - 1) + Math.floor(Math.random() * 500))
      try {
        const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
        const json = (await res.json().catch(() => null)) as { data?: T; errors?: { code?: string; message?: string }[] } | null
        if (res.ok && json?.data !== undefined) return json.data
        last = json?.errors?.[0]?.message ?? `HTTP ${res.status}`
        if (res.status !== 429 && res.status < 500) break
      } catch (err) {
        last = (err as Error).message
      }
    }
    throw new Error(last)
  }

  async function removeTokens(tokens: string[]) {
    if (!tokens.length) return
    await db.query('DELETE FROM devices WHERE expo_push_token = ANY($1)', [tokens])
    log.info({ count: tokens.length }, 'removed push tokens of phones that are no longer registered')
  }

  async function send(devices: PushDevice[], message: PushMessage): Promise<PushResult> {
    const result: PushResult = new Map()
    const mark = (userId: string, ok: boolean, error?: string) => {
      const prev = result.get(userId)
      if (!prev || (!prev.ok && ok)) result.set(userId, ok ? { ok } : { ok, error })
    }
    for (let i = 0; i < devices.length; i += SEND_BATCH) {
      const batch = devices.slice(i, i + SEND_BATCH)
      const messages = batch.map((d) => ({
        to: d.expo_push_token,
        title: message.title,
        body: message.body,
        data: message.data,
        sound: 'default',
        priority: 'high',
        // The app's notification channel (app.json expo-notifications defaultChannel and src/lib/notifications.ts).
        channelId: 'default',
      }))
      let tickets: Ticket[]
      try {
        tickets = await post<Ticket[]>(SEND_URL, messages)
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'expo push request failed')
        for (const d of batch) mark(d.user_id, false, (err as Error).message.slice(0, 300))
        continue
      }
      const dead: string[] = []
      const accepted: { id: string; d: PushDevice }[] = []
      batch.forEach((d, j) => {
        const t = tickets[j]
        if (t?.status === 'ok' && t.id) {
          accepted.push({ id: t.id, d })
          mark(d.user_id, true)
        } else {
          const code = t?.details?.error
          if (code === 'DeviceNotRegistered') dead.push(d.expo_push_token)
          mark(d.user_id, false, (code ?? t?.message ?? 'no ticket').slice(0, 300))
        }
      })
      await removeTokens(dead)
      if (accepted.length) {
        const values: unknown[] = []
        const rows = accepted.map(({ id, d }, k) => {
          values.push(id, d.expo_push_token, d.user_id)
          return `($${k * 3 + 1}, $${k * 3 + 2}, $${k * 3 + 3})`
        })
        await db.query(`INSERT INTO push_tickets (ticket_id, expo_push_token, user_id) VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING`, values)
      }
    }
    return result
  }

  async function checkReceipts() {
    // Receipts are gone after 24 hours: stop waiting for those.
    await db.query(`DELETE FROM push_tickets WHERE created_at < now() - interval '24 hours'`)
    const due = await db.query<{ ticket_id: string; expo_push_token: string }>(
      `SELECT ticket_id, expo_push_token FROM push_tickets WHERE created_at <= $1 ORDER BY created_at LIMIT 5000`,
      [new Date(Date.now() - RECEIPT_AFTER_MS)],
    )
    let checked = 0
    let removed = 0
    for (let i = 0; i < due.length; i += RECEIPT_BATCH) {
      const batch = due.slice(i, i + RECEIPT_BATCH)
      let receipts: Record<string, Receipt>
      try {
        receipts = await post<Record<string, Receipt>>(RECEIPTS_URL, { ids: batch.map((t) => t.ticket_id) })
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'expo push receipts request failed')
        continue
      }
      const dead: string[] = []
      const done: string[] = []
      for (const t of batch) {
        const r = receipts[t.ticket_id]
        if (!r) continue // not ready yet
        done.push(t.ticket_id)
        if (r.status === 'ok') continue
        const code = r.details?.error
        if (code === 'DeviceNotRegistered') dead.push(t.expo_push_token)
        // Bad or missing FCM/APNs credentials stop every push: say so loudly.
        else if (code === 'InvalidCredentials' || code === 'MismatchSenderId') log.error({ code, message: r.message }, 'push credentials problem: check the FCM V1 key in EAS')
        else log.warn({ code, message: r.message }, 'push not delivered')
      }
      await removeTokens([...new Set(dead)])
      if (done.length) await db.query('DELETE FROM push_tickets WHERE ticket_id = ANY($1)', [done])
      checked += done.length
      removed += new Set(dead).size
    }
    return { checked, removed }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  return {
    send,
    checkReceipts,
    start() {
      if (timer) return
      timer = setInterval(() => {
        checkReceipts().catch((err) => log.warn({ err: (err as Error).message }, 'push receipt check failed'))
      }, opts.receiptEveryMs ?? 5 * 60_000)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
