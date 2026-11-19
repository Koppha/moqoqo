// Re-seals every encrypted field with the current data key (the first in DATA_KEYS), and seals fields stored before
// encryption was on: npm run rotate-data-key. Key rotation (CBL/LCA DFS guidelines 3.2.6h): put the new key FIRST in
// DATA_KEYS with the old one after it, restart, run this, then remove the old key. Safe to run again: rows already on
// the current key are skipped. Prints how many values moved per field.
import { existsSync } from 'node:fs'
import { loadConfig } from '../config'
import { createDb } from '../db/index'
import { migrate } from '../db/migrate'
import { configureVault, currentKeyId, keyIdOf, openBytes, openJson, openText, sealBytes, sealJson, sealText, vaultOn } from '../lib/vault'

if (existsSync('.env')) process.loadEnvFile('.env')
const config = loadConfig()
configureVault(config.dataKeys)
if (!vaultOn()) {
  console.error('DATA_KEYS is not set: nothing to encrypt with. Set it (see .env.example) and run again.')
  process.exit(1)
}
const current = currentKeyId()!
const db = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
await migrate(db)

/** The sealed fields: table, key column, value column, and how the value is stored. */
const FIELDS: { table: string; id: string; col: string; kind: 'bytes' | 'text' | 'json' }[] = [
  { table: 'ecosure_uploads', id: 'id', col: 'content', kind: 'bytes' },
  { table: 'assets', id: 'id', col: 'content', kind: 'bytes' },
  { table: 'cards', id: 'id', col: 'gateway_token', kind: 'text' },
  { table: 'service_requests', id: 'id', col: 'lines', kind: 'json' },
  { table: 'assistant_turns', id: 'seq', col: 'content', kind: 'text' },
]

try {
  for (const f of FIELDS) {
    let moved = 0
    let after: string | null = null
    for (;;) {
      const rows: { k: string; v: unknown }[] = await db.query(
        `SELECT ${f.id}::text AS k, ${f.col} AS v FROM ${f.table} WHERE ($1::text IS NULL OR ${f.id}::text > $1) ORDER BY ${f.id}::text LIMIT 200`,
        [after],
      )
      if (!rows.length) break
      for (const r of rows) {
        after = r.k
        let next: unknown
        if (f.kind === 'bytes') {
          const b = r.v as Uint8Array
          if (keyIdOf(b) === current) continue
          next = sealBytes(openBytes(b))
        } else if (f.kind === 'text') {
          const s = r.v as string
          if (keyIdOf(s) === current) continue
          next = sealText(openText(s))
        } else {
          if (typeof r.v === 'string' && keyIdOf(r.v) === current) continue
          next = JSON.stringify(sealJson(openJson(r.v)))
        }
        await db.query(`UPDATE ${f.table} SET ${f.col} = $2 WHERE ${f.id}::text = $1`, [r.k, next])
        moved++
      }
    }
    console.log(`${f.table}.${f.col}: ${moved} re-sealed with key ${current}`)
  }
} finally {
  await db.close()
}
