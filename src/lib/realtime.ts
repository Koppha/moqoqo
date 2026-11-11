import type { ServerEvent } from '../../shared/api'
import { apiUrl, serverReady } from './server'

/**
 * One WebSocket per signed-in session. Reconnects with backoff (1 s → 30 s) and calls `onOpen`
 * after every (re)connect so the app can fetch whatever it missed while offline.
 */
export class Realtime {
  private ws: WebSocket | null = null
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private stopped = false
  /** Foreground or background, told to the server so it knows when to push. */
  private active = true

  constructor(
    private token: string,
    private onEvent: (e: ServerEvent) => void,
    private onStatus: (online: boolean) => void,
    private onOpen: () => void,
  ) {}

  start() {
    this.stopped = false
    // A server address saved on the device (test builds) must be loaded before the first connect.
    serverReady.then(() => { if (!this.stopped) this.connect() })
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.ping) clearInterval(this.ping)
    this.ws?.close()
    this.ws = null
  }

  /** The app moved to the foreground or background. */
  setActive(active: boolean) {
    this.active = active
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'state', active }))
  }

  /** Reconnect now (e.g. the app came back to the foreground). */
  poke() {
    if (this.stopped || this.ws?.readyState === WebSocket.OPEN) return
    if (this.timer) clearTimeout(this.timer)
    this.retry = 0
    this.connect()
  }

  private connect() {
    const url = apiUrl().replace(/^http/, 'ws') + '/v1/ws?token=' + encodeURIComponent(this.token)
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      if (!this.active) ws.send(JSON.stringify({ type: 'state', active: false }))
      this.onStatus(true)
      this.onOpen()
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 25_000)
    }
    ws.onmessage = (ev) => {
      try {
        this.onEvent(JSON.parse(String(ev.data)) as ServerEvent)
      } catch {
        // Ignore malformed frames.
      }
    }
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping)
      if (this.ws !== ws) return
      this.onStatus(false)
      if (this.stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => ws.close()
  }
}
