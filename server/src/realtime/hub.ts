import type { WebSocket } from 'ws'
import type { ServerEvent } from '../../../shared/api'

/** userId → open sockets (one per device / tab). */
export class Hub {
  private sockets = new Map<string, Set<WebSocket>>()
  /** Sockets of apps that said they are in the background (others count as on screen). */
  private background = new WeakSet<WebSocket>()

  /** The app reported moving to the foreground or background. */
  setActive(ws: WebSocket, active: boolean) {
    if (active) this.background.delete(ws)
    else this.background.add(ws)
  }

  /** At least one app of this user is open on screen. */
  isActive(userId: string) {
    for (const ws of this.sockets.get(userId) ?? []) if (ws.readyState === ws.OPEN && !this.background.has(ws)) return true
    return false
  }

  /** Sends to the user's connected apps that are in the background. Returns how many got it. */
  sendToBackground(userId: string, event: ServerEvent): number {
    let n = 0
    const data = JSON.stringify(event)
    for (const ws of this.sockets.get(userId) ?? []) {
      if (ws.readyState === ws.OPEN && this.background.has(ws)) {
        ws.send(data)
        n++
      }
    }
    return n
  }

  add(userId: string, ws: WebSocket) {
    let set = this.sockets.get(userId)
    if (!set) this.sockets.set(userId, (set = new Set()))
    set.add(ws)
  }

  remove(userId: string, ws: WebSocket) {
    const set = this.sockets.get(userId)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) this.sockets.delete(userId)
  }

  isOnline(userId: string) {
    return (this.sockets.get(userId)?.size ?? 0) > 0
  }

  get connectionCount() {
    let n = 0
    for (const set of this.sockets.values()) n += set.size
    return n
  }

  send(userId: string, event: ServerEvent) {
    const set = this.sockets.get(userId)
    if (!set) return
    const data = JSON.stringify(event)
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data)
  }

  broadcast(event: ServerEvent) {
    const data = JSON.stringify(event)
    for (const set of this.sockets.values()) for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data)
  }

  /** Drops every socket of a user (suspension, PIN reset). */
  disconnectUser(userId: string, code: number, reason: string) {
    for (const ws of this.sockets.get(userId) ?? []) ws.close(code, reason)
    this.sockets.delete(userId)
  }

  closeAll() {
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1001, 'server shutting down')
    this.sockets.clear()
  }
}
