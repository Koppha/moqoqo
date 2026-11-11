import type { FastifyInstance } from 'fastify'
import type { ServerEvent } from '../../../shared/api'
import type { Ctx } from '../context'
import { AppError } from '../errors'
import { userForToken } from '../http'
import { appConfig, configSignature } from '../services/maintenance'

/** Close codes sent to clients when a socket is refused. */
export const WS_CLOSE = { UNAUTHORIZED: 4401, SUSPENDED: 4403 } as const

export async function wsRoutes(app: FastifyInstance, ctx: Ctx) {
  // GET /v1/ws?token=… — works during maintenance so clients still receive `config` events.
  app.get('/v1/ws', { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string }).token ?? null
    let userId: string | null = null
    let closed = false
    socket.on('close', () => {
      closed = true
      if (userId) ctx.hub.remove(userId, socket)
    })
    socket.on('error', () => {})
    socket.on('message', (raw) => {
      if (!userId) return
      let msg: unknown
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const m = msg as { type?: unknown; active?: unknown }
      if (m?.type === 'ping') socket.send(JSON.stringify({ type: 'pong' } satisfies ServerEvent))
      else if (m?.type === 'state' && typeof m.active === 'boolean') ctx.hub.setActive(socket, m.active)
      // Anything else is ignored.
    })

    userForToken(ctx, token).then(
      ({ user }) => {
        if (closed) return
        userId = user.id
        ctx.hub.add(user.id, socket)
        socket.send(JSON.stringify({ type: 'hello', userId: user.id } satisfies ServerEvent))
      },
      (err) => {
        const suspended = err instanceof AppError && err.code === 'SUSPENDED'
        if (!(err instanceof AppError)) req.log.error({ err }, 'ws auth failed')
        socket.close(suspended ? WS_CLOSE.SUSPENDED : WS_CLOSE.UNAUTHORIZED, suspended ? 'SUSPENDED' : 'UNAUTHORIZED')
      },
    )
  })
}

/**
 * Detects maintenance windows starting/ending (and any other app-config change) and broadcasts a
 * `config` event to every connected socket. Also called directly after admin changes.
 */
export function createConfigWatcher(ctx: Ctx) {
  let last: string | null = null
  let timer: NodeJS.Timeout | null = null

  async function check(force = false) {
    try {
      const config = await appConfig(ctx.db)
      const sig = configSignature(config)
      if (force || (last !== null && sig !== last)) ctx.hub.broadcast({ type: 'config', config })
      last = sig
    } catch (err) {
      ctx.log.error({ err }, 'config watcher failed')
    }
  }

  return {
    check,
    start() {
      void check()
      timer = setInterval(() => void check(), ctx.config.maintenanceTickMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
