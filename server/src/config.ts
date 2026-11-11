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
  }
}
