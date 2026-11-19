import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'

// Load server/.env when present (Node 20.12+). Real environment variables win.
if (existsSync('.env')) process.loadEnvFile('.env')

const { loadConfig } = await import('./config')
const { createServer } = await import('./server')

const config = loadConfig()
const server = await createServer(config)
const { app, configWatcher, intentSweeper, atmSweeper, stopOrderSweeper, insightSweeper, churnSweeper, splitSweeper, loanSweeper, surveillance, push, apiMetrics } = server

await app.listen({ port: config.port, host: config.host })
claimLoopback(config.host, config.port)
app.log.info({ db: server.db.driver, dataDir: config.databaseUrl ? undefined : config.dataDir, push: config.pushEnabled }, 'moqoqo server ready')
configWatcher.start()
intentSweeper.start()
atmSweeper.start()
stopOrderSweeper.start()
insightSweeper.start()
churnSweeper.start()
splitSweeper.start()
loanSweeper.start()
surveillance.start()
if (config.pushEnabled) push.start()
apiMetrics.start()

/**
 * Listening on all addresses (:: or 0.0.0.0) doesn't stop another program on Windows from binding 127.0.0.1 on the
 * same port, and connections to 127.0.0.1 then go to it. The emulator (10.0.2.2) and `adb reverse` both arrive at
 * 127.0.0.1, and VS Code's port forwarding has taken it more than once, so the apps couldn't reach the server.
 * Holding 127.0.0.1 too (handing its connections to the same HTTP server, WebSockets included) prevents that; if
 * something already holds it, say so and keep trying until it's free.
 */
function claimLoopback(host: string, port: number) {
  if (host !== '::' && host !== '0.0.0.0') return
  let warned = false
  const attempt = () => {
    const loopback = createNetServer((socket) => app.server.emit('connection', socket))
    loopback.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') return app.log.error({ err }, `could not listen on 127.0.0.1:${port}`)
      if (!warned) {
        app.log.warn(`127.0.0.1:${port} is held by another program (VS Code port forwarding?): the emulator and adb reverse can't reach this server until it's released. Retrying every 10 s.`)
        warned = true
      }
      setTimeout(attempt, 10_000).unref()
    })
    // Closes with the process (shutdown ends in process.exit).
    loopback.listen(port, '127.0.0.1', () => {
      if (warned) app.log.info(`127.0.0.1:${port} is free again: the emulator and adb reverse reach this server`)
    })
  }
  attempt()
}

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    app.log.info({ signal }, 'shutting down')
    await server.close().catch((err) => app.log.error({ err }, 'shutdown failed'))
    process.exit(0)
  })
}
