// Creates an extra portal account: npm run admin:create -- <email> <name> [admin|support]
// The password comes from ADMIN_NEW_PASSWORD, or a random one is printed once.
import { existsSync } from 'node:fs'
import { loadConfig } from '../config'
import { createDb } from '../db/index'
import { migrate } from '../db/migrate'
import { hashSecret, newId, randomPassword } from '../lib/crypto'

if (existsSync('.env')) process.loadEnvFile('.env')
const [email, name, role = 'support'] = process.argv.slice(2)
if (!email || !name || !['admin', 'support'].includes(role)) {
  console.error('usage: npm run admin:create -- <email> <name> [admin|support]')
  process.exit(1)
}
const config = loadConfig()
const db = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir })
await migrate(db)
const password = process.env.ADMIN_NEW_PASSWORD || randomPassword()
const { hash, salt } = await hashSecret(password)
try {
  await db.query('INSERT INTO admins (id, email, name, role, password_hash, password_salt) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId(),
    email.toLowerCase(),
    name,
    role,
    hash,
    salt,
  ])
  console.log(`created ${role} ${email.toLowerCase()}${process.env.ADMIN_NEW_PASSWORD ? '' : ` with password ${password} (shown once)`}`)
} catch (err) {
  console.error(`could not create admin: ${(err as Error).message}`)
  process.exitCode = 1
} finally {
  await db.close()
}
