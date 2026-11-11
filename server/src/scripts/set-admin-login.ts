// Changes a portal account's sign-in: npm run admin:set-login -- <current email> <new email>
// The new password comes from ADMIN_NEW_PASSWORD (required). Signs the account out everywhere.
// Stop the server first when it runs on the built-in database (PGlite allows one process).
import { existsSync } from 'node:fs'
import { loadConfig } from '../config'
import { createDb } from '../db/index'
import { migrate } from '../db/migrate'
import { hashSecret } from '../lib/crypto'

if (existsSync('.env')) process.loadEnvFile('.env')
const [current, next] = process.argv.slice(2)
const password = process.env.ADMIN_NEW_PASSWORD
if (!current || !next || !password) {
  console.error('usage: ADMIN_NEW_PASSWORD=… npm run admin:set-login -- <current email> <new email>')
  process.exit(1)
}
const config = loadConfig()
const db = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
await migrate(db)
const { hash, salt } = await hashSecret(password)
try {
  const rows = await db.query<{ id: string }>(
    'UPDATE admins SET email = $2, password_hash = $3, password_salt = $4 WHERE email = $1 RETURNING id',
    [current.toLowerCase(), next.toLowerCase(), hash, salt],
  )
  if (!rows.length) throw new Error(`no portal account ${current.toLowerCase()}`)
  await db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [rows[0].id])
  console.log(`${current.toLowerCase()} now signs in as ${next.toLowerCase()} with the new password`)
} catch (err) {
  console.error(`could not change the sign-in: ${(err as Error).message}`)
  process.exitCode = 1
} finally {
  await db.close()
}
