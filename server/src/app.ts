import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { ApiError } from '../../shared/api'
import type { Config } from './config'
import { createCtx, type Ctx } from './context'
import type { Db } from './db/index'
import { MockLedger, type Ledger } from './ecocash/index'
import { AppError } from './errors'
import { anthropicModel, createAssistant, type AssistantModel } from './assistant/index'
import { MockBanks, type BankGateway } from './gateways/banks'
import { MockPinless, type PinlessGateway } from './gateways/pinless'
import { MockRemit, type RemitGateway } from './gateways/remit'
import { MockCardGateway, type CardGateway } from './gateways/cards'
import { MockEcoCashServices, type EcoCashServices } from './gateways/ecocash'
import { MockHomeAffairs, type HomeAffairs } from './gateways/homeaffairs'
import { EconetSimSwap, MockSimSwap, type SimSwapSource } from './gateways/simswap'
import { MockNumberVerify, type NumberVerify } from './gateways/numberverify'
import { MockEmail, MockSms, type EmailGateway, type SmsGateway } from './notify/gateways'
import { createExpoPush, type ExpoPush } from './notify/expoPush'
import { createNotifier } from './notify/index'
import { Hub } from './realtime/hub'
import { adminRoutes } from './routes/admin'
import { atmRoutes } from './routes/atm'
import { homeRoutes } from './routes/home'
import { supportAdminRoutes } from './routes/support'
import { createAtmSweeper } from './services/atm'
import { createStopOrderSweeper } from './services/stopOrders'
import { createInsightSweeper } from './services/insights'
import { createChurnSweeper } from './services/churn'
import { retentionRoutes } from './routes/retention'
import { stopOrderRoutes } from './routes/stopOrders'
import { createLoanSweeper } from './services/societyLoans'
import { createSplitSweeper } from './services/splits'
import { recordBlocked, RiskBlocked } from './services/risk'
import { createSurveillanceSweeper } from './services/surveillance'
import { aiRiskRoutes } from './routes/aiRisk'
import { simSwapRoutes } from './routes/simSwap'
import { securityRoutes } from './routes/security'
import { protect } from './lib/protect'
import { analyticsRoutes } from './routes/analytics'
import { brandingRoutes } from './routes/branding'
import { notificationAdminRoutes, notificationRoutes } from './routes/notifications'
import { onboardingAdminRoutes, onboardingRoutes } from './routes/onboarding'
import { serviceAdminRoutes, serviceRoutes } from './routes/services'
import { cardBankAdminRoutes, cardBankRoutes } from './routes/cardbank'
import { remittanceAdminRoutes, remittanceRoutes } from './routes/remittance'
import { businessRoutes } from './routes/businesses'
import { ussdRoutes } from './routes/ussd'
import { placesRoutes } from './routes/places'
import { billRoutes } from './routes/bills'
import { friendRoutes } from './routes/friends'
import { donateAdminRoutes, donateRoutes } from './routes/donate'
import { societyAdminRoutes, societyRoutes } from './routes/societies'
import { splitAdminRoutes, splitRoutes } from './routes/splits'
import { ecosureAdminRoutes, ecosureRoutes } from './routes/ecosure'
import { v1Routes } from './routes/v1'
import { createConfigWatcher, wsRoutes } from './routes/ws'
import { createIntentSweeper } from './services/intents'
import { activeMaintenance } from './services/maintenance'
import { createApiMetrics } from './services/metrics'
import { performanceRoutes } from './routes/performance'
import { readFileSync } from 'node:fs'
import { configureVault } from './lib/vault'

export interface BuiltApp {
  app: FastifyInstance
  ctx: Ctx
  configWatcher: ReturnType<typeof createConfigWatcher>
  intentSweeper: ReturnType<typeof createIntentSweeper>
  atmSweeper: ReturnType<typeof createAtmSweeper>
  stopOrderSweeper: ReturnType<typeof createStopOrderSweeper>
  /** The assistant's monthly spending summaries, hourly once started. */
  insightSweeper: ReturnType<typeof createInsightSweeper>
  /** Agent & merchant churn scores, once a Lesotho day (checked hourly) once started. */
  churnSweeper: ReturnType<typeof createChurnSweeper>
  splitSweeper: ReturnType<typeof createSplitSweeper>
  /** Society loan reminders and expiry, hourly once started. */
  loanSweeper: ReturnType<typeof createLoanSweeper>
  /** Transaction surveillance (AML scenarios) every 15 minutes once started. */
  surveillance: ReturnType<typeof createSurveillanceSweeper>
  /** Reads Expo push receipts every few minutes once started. */
  push: ExpoPush
  apiMetrics: ReturnType<typeof createApiMetrics>
}

/** Routes that keep working while a maintenance window is active (plus everything under /admin/v1). */
const MAINTENANCE_OPEN = new Set(['/v1/app-config', '/v1/ws'])

export interface AppDeps {
  ledger?: Ledger
  cards?: CardGateway
  banks?: BankGateway
  remit?: RemitGateway
  pinless?: PinlessGateway
  services?: EcoCashServices
  homeAffairs?: HomeAffairs
  simSwap?: SimSwapSource
  numberVerify?: NumberVerify
  sms?: SmsGateway
  email?: EmailGateway
  /** Expo push HTTP calls (tests pass a fake). */
  pushFetch?: typeof fetch
  /** The assistant's model (tests pass a fake). Default: Claude when ANTHROPIC_API_KEY is set, else none. */
  assistantModel?: AssistantModel | null
}

export async function buildApp(opts: { config: Config; db: Db; logger?: boolean } & AppDeps): Promise<BuiltApp> {
  const { config, db } = opts
  // Encryption at rest for sensitive fields (DFS guidelines 3.2.6g); a malformed key stops the start.
  configureVault(config.dataKeys)
  // TLS 1.2+ when the server terminates it itself (DFS guidelines 3.2.4a–b); usually the proxy does.
  const https = config.tlsCertFile && config.tlsKeyFile
    ? { https: { cert: readFileSync(config.tlsCertFile), key: readFileSync(config.tlsKeyFile), minVersion: 'TLSv1.2' as const } }
    : {}
  const app = Fastify({
    ...(https as object),
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            // Never log credentials. Bodies are not logged at all; these cover headers and query strings.
            redact: ['req.headers.authorization', 'req.query.token', 'req.headers["sec-websocket-protocol"]'],
            serializers: {
              req: (req) => ({ method: req.method, url: req.url.replace(/([?&]token=)[^&]+/, '$1[REDACTED]'), remoteAddress: req.ip }),
            },
          },
    trustProxy: true, // behind the etl.co.ls reverse proxy
    bodyLimit: 256 * 1024,
  })

  const hub = new Hub()
  const push = createExpoPush({ db, log: app.log, accessToken: config.expoAccessToken, fetch: opts.pushFetch })
  const ctx = createCtx({
    db,
    config,
    hub,
    ledger: opts.ledger ?? new MockLedger(),
    cards: opts.cards ?? new MockCardGateway(),
    banks: opts.banks ?? new MockBanks(),
    remit: opts.remit ?? new MockRemit(),
    pinless: opts.pinless ?? new MockPinless(),
    services: opts.services ?? new MockEcoCashServices(),
    homeAffairs: opts.homeAffairs ?? new MockHomeAffairs(),
    simSwap: opts.simSwap ?? (config.econetSimSwap ? new EconetSimSwap(config.econetSimSwap) : new MockSimSwap()),
    numberVerify: opts.numberVerify ?? new MockNumberVerify(),
    log: app.log,
    notifier: createNotifier({ db, hub, log: app.log, pushEnabled: config.pushEnabled, push, sms: opts.sms ?? new MockSms(), email: opts.email ?? new MockEmail() }),
  })
  const model = opts.assistantModel !== undefined ? opts.assistantModel : config.anthropicApiKey ? anthropicModel(config.anthropicApiKey) : null
  ctx.assistant = createAssistant(ctx, model, { model: config.assistantModel, effort: config.assistantEffort })
  ctx.llm = model
  const surveillance = createSurveillanceSweeper(ctx)
  const configWatcher = createConfigWatcher(ctx)
  const intentSweeper = createIntentSweeper(ctx, config.maintenanceTickMs)
  const atmSweeper = createAtmSweeper(ctx)
  const stopOrderSweeper = createStopOrderSweeper(ctx)
  const insightSweeper = createInsightSweeper(ctx)
  const churnSweeper = createChurnSweeper(ctx)
  const splitSweeper = createSplitSweeper(ctx)
  const loanSweeper = createLoanSweeper(ctx)
  ctx.onCredit = splitSweeper.onCredit
  const apiMetrics = createApiMetrics(db, app.log)

  // Empty JSON bodies (e.g. POST /logout with a JSON content type) parse as {}.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString()
    if (!text.trim()) return done(null, {})
    try {
      done(null, JSON.parse(text))
    } catch {
      done(new AppError('VALIDATION', 'Body is not valid JSON'), undefined)
    }
  })

  await app.register(cors, {
    origin: config.corsOrigins === '*' ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-device-context'],
    exposedHeaders: ['x-network-new', 'x-session-token'],
    maxAge: 600,
  })
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })
  protect(app, { rateLimit: config.rateLimit, requireTls: config.requireTls, onLimited: (ip, url) => app.log.warn({ ip, url }, 'rate limited') })

  app.setErrorHandler((err: FastifyError & { code?: string }, req, reply) => {
    let body: ApiError
    let status: number
    if (err instanceof AppError) {
      status = err.statusCode
      body = { error: { code: err.code, message: err.message } }
      if (err.maintenance) body.error.maintenance = err.maintenance
      if (err instanceof RiskBlocked) void recordBlocked(db, err)
      if (err.lockedUserId) {
        void ctx.notifier.send({
          userIds: [err.lockedUserId],
          category: 'security',
          title: 'PIN locked',
          body: 'Your EcoCash Super App PIN was entered wrongly 5 times, so it is locked for 15 minutes. If this was not you, call EcoCash customer care.',
        })
      }
    } else if (err.code === '23505') {
      // Unique violation, e.g. a reused clientId for a payment.
      status = 409
      body = { error: { code: 'CONFLICT', message: 'This was already done' } }
    } else if (err.code === '23514' && /balance/.test(err.message)) {
      status = 422
      body = { error: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money' } }
    } else if (err.validation || (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)) {
      status = err.statusCode === 413 ? 413 : 400
      body = { error: { code: 'VALIDATION', message: err.message } }
    } else {
      req.log.error({ err }, 'unhandled error')
      status = 500
      body = { error: { code: 'UNKNOWN', message: 'Something went wrong. Please try again' } }
    }
    reply.code(status).send(body)
  })

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.url.split('?')[0]}` } } satisfies ApiError)
  })

  // Maintenance gate: every /v1 route except app-config and ws answers 503 while a window is active.
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS') return
    const path = req.url.split('?')[0]
    if (!path.startsWith('/v1/') || MAINTENANCE_OPEN.has(path) || path.startsWith('/v1/assets/')) return
    const m = await activeMaintenance(db)
    if (m) throw new AppError('MAINTENANCE', m.message.en, m)
  })

  // Speed and errors per area for the portal's Performance page. Unmatched URLs (404s) and preflights are left out.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url
    if (route && req.method !== 'OPTIONS') apiMetrics.record(route, reply.statusCode, reply.elapsedTime)
  })

  app.get('/health', async () => ({ ok: true, db: db.driver, sockets: hub.connectionCount, time: new Date().toISOString() }))

  await v1Routes(app, ctx)
  await wsRoutes(app, ctx)
  await adminRoutes(app, ctx, () => configWatcher.check(true))
  await ecosureRoutes(app, ctx)
  await ecosureAdminRoutes(app, ctx)
  await cardBankRoutes(app, ctx)
  await cardBankAdminRoutes(app, ctx)
  await remittanceRoutes(app, ctx)
  await remittanceAdminRoutes(app, ctx)
  await splitRoutes(app, ctx)
  await splitAdminRoutes(app, ctx)
  await societyRoutes(app, ctx)
  await societyAdminRoutes(app, ctx)
  await donateRoutes(app, ctx)
  await donateAdminRoutes(app, ctx)
  await businessRoutes(app, ctx)
  await friendRoutes(app, ctx)
  await ussdRoutes(app, ctx, () => configWatcher.check(true))
  await placesRoutes(app, ctx, () => configWatcher.check(true))
  await billRoutes(app, ctx)
  await stopOrderRoutes(app, ctx)
  await notificationRoutes(app, ctx)
  await notificationAdminRoutes(app, ctx)
  await serviceRoutes(app, ctx)
  await serviceAdminRoutes(app, ctx)
  await onboardingRoutes(app, ctx)
  await onboardingAdminRoutes(app, ctx)
  await brandingRoutes(app, ctx, () => configWatcher.check(true))
  await atmRoutes(app, ctx)
  await homeRoutes(app, ctx)
  await supportAdminRoutes(app, ctx)
  await analyticsRoutes(app, ctx)
  await performanceRoutes(app, ctx)
  await aiRiskRoutes(app, ctx)
  await retentionRoutes(app, ctx)
  await simSwapRoutes(app, ctx)
  await securityRoutes(app, ctx)

  app.addHook('onClose', async () => {
    configWatcher.stop()
    intentSweeper.stop()
    atmSweeper.stop()
    stopOrderSweeper.stop()
    insightSweeper.stop()
    churnSweeper.stop()
    splitSweeper.stop()
    push.stop()
    loanSweeper.stop()
    surveillance.stop()
    apiMetrics.stop()
    await apiMetrics.flush()
    hub.closeAll()
    await ctx.notifier.idle()
  })

  return { app, ctx, configWatcher, intentSweeper, atmSweeper, stopOrderSweeper, insightSweeper, churnSweeper, splitSweeper, loanSweeper, surveillance, push, apiMetrics }
}
