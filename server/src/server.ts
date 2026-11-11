import { buildApp, type AppDeps, type BuiltApp } from './app'
import type { Config } from './config'
import { createDb, type Db } from './db/index'
import { migrate } from './db/migrate'
import { ensureBillers, ensureDemoBusinessOwners, ensureFirstAdmin, seedDemo } from './db/seed'

export interface Server extends BuiltApp {
  db: Db
  close(): Promise<void>
}

/** Opens the database, migrates, seeds an empty database and builds the Fastify app (not listening yet). */
export async function createServer(config: Config, opts: { logger?: boolean } & AppDeps = {}): Promise<Server> {
  const db = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
  const built = await buildApp({ ...opts, config, db })
  const log = built.app.log
  try {
    for (const name of await migrate(db)) log.info(`applied migration ${name}`)
    await db.tx(async (q) => {
      await ensureBillers(q)
      if (config.seed && (await seedDemo(q))) log.info('seeded demo data (all demo wallets use PIN 1234)')
      if (config.seed) await ensureDemoBusinessOwners(q)
      const admin = await ensureFirstAdmin(q, { email: config.adminEmail, password: config.adminPassword })
      if (admin?.generatedPassword) {
        // Printed once, straight to the console (not the structured log), and never stored in clear.
        console.log(
          `\n==================== FIRST ADMIN ====================\n` +
            `  email:    ${admin.email}\n  password: ${admin.generatedPassword}\n` +
            `  Save it now: it is not shown again. Set ADMIN_EMAIL/ADMIN_PASSWORD to choose your own.\n` +
            `=====================================================\n`,
        )
      } else if (admin) {
        log.info({ email: admin.email }, 'created first admin from ADMIN_EMAIL/ADMIN_PASSWORD')
      }
    })
  } catch (err) {
    await db.close().catch(() => {})
    throw err
  }
  return {
    ...built,
    db,
    async close() {
      await built.app.close()
      await db.close()
    },
  }
}
