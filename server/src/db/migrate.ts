import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from './index'

/** Finds server/migrations (dev: src/db/../../migrations, build: dist/migrations). */
export function migrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'migrations')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  throw new Error('migrations directory not found')
}

/** Applies migrations/NNN_name.sql in order, each in its own transaction, tracked in schema_migrations. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const dir = migrationsDir()
  const files = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name))
  const applied: string[] = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(join(dir, file), 'utf8')
    // exec() is atomic: the migration and its bookkeeping row commit together or not at all.
    await db.exec(`${sql}\n;\nINSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');`)
    log(`applied migration ${file}`)
    applied.push(file)
  }
  return applied
}
