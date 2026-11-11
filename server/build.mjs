// Bundles src/ (and the shared API contract it imports) into dist/index.js.
// npm dependencies stay external and are loaded from node_modules at runtime.
import { build } from 'esbuild'
import { cp, rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
}
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' })
await build({ ...common, entryPoints: ['src/scripts/create-admin.ts'], outfile: 'dist/create-admin.js' })
// SQL migrations ship next to the bundle so dist/ is self-contained.
await cp('migrations', 'dist/migrations', { recursive: true })
