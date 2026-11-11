// Downloads the home-screen icons uploaded in the portal (Branding), so the next app builds use them:
//   EcoCash Super App's icon            → assets/brand/icon.png          (else the built-in assets/icon.png)
//   EcoSure's mini app icon  → assets/brand/ecosure-icon.png  (the standalone EcoSure app; else assets/ecosure)
//   Society's mini app icon  → assets/brand/society-icon.png  (the standalone Mekhatlo app; else assets/mekhatlo)
// Phones only change an app's icon with an update, so run this before building:
//   MOQOQO_API=https://api… MOQOQO_ADMIN_EMAIL=… MOQOQO_ADMIN_PASSWORD=… npm run fetch-branding
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const api = (process.env.MOQOQO_API ?? 'http://localhost:4100').replace(/\/+$/, '')
const email = process.env.MOQOQO_ADMIN_EMAIL
const password = process.env.MOQOQO_ADMIN_PASSWORD
if (!email || !password) {
  console.error('Set MOQOQO_ADMIN_EMAIL and MOQOQO_ADMIN_PASSWORD (a portal admin or support account).')
  process.exit(1)
}

const login = await fetch(`${api}/admin/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
if (!login.ok) throw new Error(`Portal login failed: HTTP ${login.status}`)
const { token } = await login.json()
const branding = await (await fetch(`${api}/admin/v1/branding`, { headers: { authorization: `Bearer ${token}` } })).json()

/** Saves an uploaded icon to `out`, or removes `out` so the build falls back to the built-in one. */
async function save(asset, out, what) {
  if (!asset) {
    rmSync(out, { force: true })
    console.log(`No ${what} uploaded: the build uses the built-in icon.`)
    return
  }
  const res = await fetch(`${api}${asset.path}`)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  mkdirSync('assets/brand', { recursive: true })
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  console.log(`Saved ${out} (${asset.width} × ${asset.height}): ${what}.`)
}

await save(branding.appIcon, 'assets/brand/icon.png', 'EcoCash Super App home-screen icon')
await save(branding.miniAppIcons?.ecosure, 'assets/brand/ecosure-icon.png', 'EcoSure icon (standalone app)')
await save(branding.miniAppIcons?.society, 'assets/brand/society-icon.png', 'Mekhatlo icon (standalone app)')
console.log('Build the apps now to use them.')
await fetch(`${api}/admin/v1/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {})
