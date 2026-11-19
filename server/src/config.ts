import { resolve } from 'node:path'

export interface Config {
  port: number
  host: string
  databaseUrl: string | null
  /** PGlite data dir; null = in-memory (tests). */
  dataDir: string | null
  corsOrigins: string[] | '*'
  adminEmail: string | null
  adminPassword: string | null
  pushEnabled: boolean
  /** Expo access token, needed once "enhanced security for push" is on for the Expo project. */
  expoAccessToken: string | null
  logLevel: string
  /** How often the maintenance watcher checks for windows starting/ending. */
  maintenanceTickMs: number
  /** Seed demo data into an empty database. */
  seed: boolean
  /** Claude API key for the EcoCash Assistant; null = assistant off (it says so in the chat). */
  anthropicApiKey: string | null
  assistantModel: string
  assistantEffort: 'low' | 'medium' | 'high'
  /** Wallets are bound to one phone per app; a new phone goes through sign-up (ID check + OTP). Off only for old tests. */
  deviceBinding: boolean
  /** Test builds may say "pretend I'm on Econet" (emulators have test SIMs). Must be false in production. */
  allowSimulatedNetwork: boolean
  /** Shared secret Econet sends as x-webhook-secret to POST /v1/hooks/sim-swap; null = webhook off. */
  simSwapWebhookSecret: string | null
  /** Econet's SIM swap API (ECONET_SIMSWAP_URL + ECONET_SIMSWAP_KEY); null = MockSimSwap (swaps simulated in the portal). */
  econetSimSwap: { url: string; key: string; header: string; cacheSeconds: number; timeoutMs: number } | null
  /** EcoSure policy manager package list (funeral prices and cover terms); null = keep the catalogue in the database. */
  ecosurePackages: { url: string; syncMinutes: number; timeoutMs: number } | null
  /** Per-connection limit on sign-in, PIN and sign-up attempts (on unless RATE_LIMIT=false). */
  rateLimit: boolean
  /** Android SMS Retriever app hashes per app, from SMS_APP_HASHES="customer:AbC123xyZ_1,business:…". */
  smsAppHashes: Partial<Record<string, string>>
  /** Field encryption keys, "kid:base64-32-bytes,…" (first = current); unset = stored as is (development). */
  dataKeys: string | null
  /** Serve https directly with these PEM files (otherwise TLS ends at the proxy). */
  tlsCertFile: string | null
  tlsKeyFile: string | null
  /** Refuse any request that didn't arrive over https (directly or as X-Forwarded-Proto from the proxy). */
  requireTls: boolean
}

const DEFAULT_ORIGINS = [
  'http://localhost:5173', // portal (Vite dev)
  'http://127.0.0.1:5173',
  'http://localhost:8081', // Expo dev server / web
  'http://localhost:19006', // Expo web (legacy port)
]

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const origins = env.CORS_ORIGINS?.trim()
  return {
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    dataDir: resolve(env.DATA_DIR?.trim() || './.data'),
    corsOrigins: origins === '*' ? '*' : origins ? origins.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_ORIGINS,
    adminEmail: env.ADMIN_EMAIL?.trim() || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    pushEnabled: env.PUSH_ENABLED === 'true',
    expoAccessToken: env.EXPO_ACCESS_TOKEN?.trim() || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    maintenanceTickMs: 15_000,
    seed: env.SEED !== 'false',
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    assistantModel: env.ASSISTANT_MODEL?.trim() || 'claude-opus-5-5',
    assistantEffort: env.ASSISTANT_EFFORT === 'low' || env.ASSISTANT_EFFORT === 'high' ? env.ASSISTANT_EFFORT : 'medium',
    deviceBinding: env.DEVICE_BINDING !== 'false',
    allowSimulatedNetwork: env.ALLOW_SIMULATED_NETWORK !== 'false',
    simSwapWebhookSecret: env.SIM_SWAP_WEBHOOK_SECRET?.trim() || null,
    econetSimSwap: env.ECONET_SIMSWAP_URL?.trim() && env.ECONET_SIMSWAP_KEY?.trim()
      ? {
          url: env.ECONET_SIMSWAP_URL.trim(),
          key: env.ECONET_SIMSWAP_KEY.trim(),
          header: env.ECONET_SIMSWAP_HEADER?.trim() || 'Authorization',
          cacheSeconds: Number(env.ECONET_SIMSWAP_CACHE_SECONDS) > 0 ? Number(env.ECONET_SIMSWAP_CACHE_SECONDS) : 300,
          timeoutMs: 4000,
        }
      : null,
    ecosurePackages: env.ECOSURE_PACKAGES_URL?.trim()
      ? {
          url: env.ECOSURE_PACKAGES_URL.trim(),
          syncMinutes: Number(env.ECOSURE_PACKAGES_SYNC_MINUTES) > 0 ? Number(env.ECOSURE_PACKAGES_SYNC_MINUTES) : 60,
          timeoutMs: 8000,
        }
      : null,
    rateLimit: env.RATE_LIMIT !== 'false',
    dataKeys: env.DATA_KEYS?.trim() || null,
    tlsCertFile: env.TLS_CERT_FILE?.trim() || null,
    tlsKeyFile: env.TLS_KEY_FILE?.trim() || null,
    requireTls: env.REQUIRE_TLS === 'true',
    smsAppHashes: Object.fromEntries((env.SMS_APP_HASHES ?? '').split(',').map((p) => p.trim().split(':')).filter((x) => x.length === 2 && /^[A-Za-z0-9+/_-]{11}$/.test(x[1]))),
  }
}
