#!/usr/bin/env node
// No secrets in the code (CBL/LCA DFS guidelines 3.2.6c): scans every file git tracks for keys, tokens, private keys
// and passwords, and exits 1 when it finds one. Run before every commit and in CI: node scripts/check-secrets.mjs
// Secrets live in server/.env (git-ignored) or the deployment's secret store, never in the repository or the app.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RULES = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Expo access token', /\bexpo_[A-Za-z0-9]{30,}\b/],
  ['Data key in code', /DATA_KEYS\s*=\s*[A-Za-z0-9_-]+:[A-Za-z0-9+/]{40,}={0,2}/],
  ['Password assignment', /\b(password|passwd|secret|api_key|apikey)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
]
// Placeholders and test fixtures that look like secrets but aren't.
const ALLOW = [/change-me/i, /test.local/, /example/i, /test-pass|support-pass|right-password|hook-secret|wrong/i, /\$\{/, /process\.env/]
const SKIP = [/(^|\/)node_modules\//, /\.lock$/, /package-lock\.json$/, /\.(png|jpe?g|webp|gif|ico|pdf|ttf|otf|woff2?|apk|aab|jar|keystore)$/i]

// Tracked files and new ones not yet added (git-ignored files such as server/.env are left out on purpose).
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.some((r) => r.test(f)))
const hits = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) {
      if (re.test(line) && !ALLOW.some((a) => a.test(line))) hits.push(`${file}:${i + 1}  ${name}`)
    }
  })
}
if (hits.length) {
  console.error(`Possible secrets in tracked files:\n${hits.join('\n')}`)
  process.exit(1)
}
console.log(`No secrets found in ${files.length} tracked files.`)
