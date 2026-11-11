// Typed client for the EcoCash Super App admin API (/admin/v1) plus the public /v1/app-config.
// Contract: ../../shared/api.ts (types only).
import type { BillCategory, BillCategoryBody,
  UssdSettings,
  Analytics,
  Performance,
  RiskAlert,
  RiskAlertStatus,
  RiskReviewBody,
  RiskRule,
  SupportStats,
  SupportTicket,
  SupportTicketDetail,
  TicketStatus,
  Broadcast,
  BroadcastBody,
  HomeLayout,
  Offer,
  OfferBody,
  AtmRedeemBody,
  AtmWithdrawal,
  KycLimits,
  Asset,
  AssetUploadBody,
  Branding,
  BrandingBody,
  MiniAppIconBody,
  MiniAppIconId,
  AdminLoginBody,
  AdminServiceRequest,
  ServiceBody,
  ServiceDef,
  ServiceRequestDecisionBody,
  ServiceRequestStatus,
  AdminNotification,
  AdminLoginResponse,
  Admin,
  AdminStats,
  AdminTransaction,
  AdminUser,
  ApiError,
  AppConfig,
  AppConfigBody,
  AuditEntry,
  BoundDevice,
  CreateUserBody,
  ErrorCode,
  EsClaim,
  EsClaimDecisionBody,
  EsClaimStatus,
  EsPolicy,
  EsPolicyStatus,
  EsQuote,
  FloatBody,
  Maintenance,
  MaintenanceBody,
  MaintenanceWindow,
  NewsBody,
  NotificationProviders,
  NotifyCategory,
  NotifyChannel,
  Page,
  PublicUser,
  ResetPinBody,
  Role,
  Tariff,
  RemitSettings,
  SplitSettings,
  AdminSociety,
  CreateSocietyBody,
  SocietyDetail,
  SocietyApplication,
  AdminCause,
  DonateSettings,
  SocietyApplySettings,
  SocietySimBody,
  AdminRemittance,
  Transaction,
  UpdateUserBody,
  UserStatus,
  Place,
  PlaceBody,
  Feedback,
  ContactSettings,
} from '../../shared/api'

/** Empty string = same origin as the portal (served behind the same proxy as the API). */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')

const TOKEN_KEY = 'moqoqo.admin.token'

export const NETWORK_MESSAGE = "Can't reach the EcoCash Super App server. Check your connection or VPN and try again."

export class ApiClientError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly maintenance?: Maintenance

  constructor(code: ErrorCode, message: string, status = 0, maintenance?: Maintenance) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
    this.maintenance = maintenance
  }
}

export function isApiError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError
}

/** A human-readable message for anything thrown by the client (or elsewhere). */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

// ---------- token ----------

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable (private mode); the session simply won't survive a reload
  }
}

// ---------- 401 handling ----------

type UnauthorizedHandler = () => void

const defaultUnauthorized: UnauthorizedHandler = () => {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

let onUnauthorized: UnauthorizedHandler = defaultUnauthorized

/** The app installs a router-aware handler; returns a function that restores the previous one. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  const prev = onUnauthorized
  onUnauthorized = handler
  return () => {
    onUnauthorized = prev
  }
}

// ---------- core request ----------

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION',
  503: 'MAINTENANCE',
}

function isApiErrorBody(v: unknown): v is ApiError {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false
  const err = (v as { error: unknown }).error
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
}

type Query = Record<string, string | number | undefined | null>

function buildUrl(path: string, query?: Query): string {
  let url = API_URL + path
  if (query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
    const s = qs.toString()
    if (s) url += '?' + s
  }
  return url
}

export interface RequestOptions {
  body?: unknown
  query?: Query
  signal?: AbortSignal
  /** Skip the global 401 redirect (the login call itself). */
  skipAuthRedirect?: boolean
  /** Public endpoint: don't send the admin token. */
  anonymous?: boolean
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token && !opts.anonymous) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiClientError('NETWORK', NETWORK_MESSAGE)
  }

  if (res.status === 204) return undefined as T

  const text = await res.text().catch(() => '')
  let json: unknown = undefined
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
  }

  if (!res.ok) {
    let err: ApiClientError
    if (isApiErrorBody(json)) {
      const { code, message, maintenance } = json.error
      err = new ApiClientError(code, message || `Request failed (${res.status}).`, res.status, maintenance)
    } else {
      const code = STATUS_CODES[res.status] ?? 'UNKNOWN'
      err = new ApiClientError(code, `The server answered ${res.status}${res.statusText ? ' ' + res.statusText : ''}.`, res.status)
    }
    if (res.status === 401 && !opts.skipAuthRedirect) {
      setToken(null)
      onUnauthorized()
    }
    throw err
  }

  if (json === undefined && text) {
    throw new ApiClientError('UNKNOWN', 'The server sent a response the portal could not read.', res.status)
  }
  return json as T
}

/** Downloads a file (e.g. a claim document) with the admin token. Errors are thrown like request(). */
export async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(buildUrl(path), { headers })
  } catch {
    throw new ApiClientError('NETWORK', NETWORK_MESSAGE)
  }
  if (!res.ok) {
    let json: unknown
    try {
      json = await res.json()
    } catch {
      json = undefined
    }
    if (res.status === 401) {
      setToken(null)
      onUnauthorized()
    }
    if (isApiErrorBody(json)) throw new ApiClientError(json.error.code, json.error.message, res.status)
    throw new ApiClientError(STATUS_CODES[res.status] ?? 'UNKNOWN', `The server answered ${res.status}.`, res.status)
  }
  return res.blob()
}

// ---------- endpoints ----------

export type AdminEsClaim = EsClaim & { holder: PublicUser }
export type AdminEsQuote = EsQuote & { contactName?: string; msisdn?: string; answers: Record<string, string> }
export type EsQuoteStatus = EsQuote['status']

export interface UserQuery {
  query?: string
  role?: Role | ''
  status?: UserStatus | ''
  page?: number
  pageSize?: number
}

export interface TransactionQuery {
  query?: string
  kind?: Transaction['kind'] | ''
  /** Not in shared/api.ts yet; the server accepts it (transactions where the user is sender or receiver). */
  userId?: string
  /** Only the last N days. */
  days?: number | ''
  page?: number
  pageSize?: number
}

const A = '/admin/v1'

export const api = {
  login: (body: AdminLoginBody) =>
    request<AdminLoginResponse>('POST', `${A}/login`, { body, skipAuthRedirect: true }),
  /** Revokes the session server-side (not in shared/api.ts yet; the server implements it). 204. */
  logout: () => request<void>('POST', `${A}/logout`, { skipAuthRedirect: true }),
  me: () => request<Admin>('GET', `${A}/me`),
  stats: () => request<AdminStats>('GET', `${A}/stats`),

  maintenance: {
    list: () => request<MaintenanceWindow[]>('GET', `${A}/maintenance`),
    create: (body: MaintenanceBody) => request<MaintenanceWindow>('POST', `${A}/maintenance`, { body }),
    update: (id: string, body: Partial<MaintenanceBody>) =>
      request<MaintenanceWindow>('PATCH', `${A}/maintenance/${encodeURIComponent(id)}`, { body }),
    end: (id: string) => request<MaintenanceWindow>('POST', `${A}/maintenance/${encodeURIComponent(id)}/end`),
    cancel: (id: string) => request<MaintenanceWindow>('POST', `${A}/maintenance/${encodeURIComponent(id)}/cancel`),
  },

  users: {
    list: (q: UserQuery) => request<Page<AdminUser>>('GET', `${A}/users`, { query: { ...q } }),
    get: (id: string) => request<AdminUser>('GET', `${A}/users/${encodeURIComponent(id)}`),
    create: (body: CreateUserBody) => request<AdminUser>('POST', `${A}/users`, { body }),
    update: (id: string, body: UpdateUserBody) =>
      request<AdminUser>('PATCH', `${A}/users/${encodeURIComponent(id)}`, { body }),
    resetPin: (id: string, body: ResetPinBody) =>
      request<void>('POST', `${A}/users/${encodeURIComponent(id)}/reset-pin`, { body }),
    float: (id: string, body: FloatBody) =>
      request<AdminUser>('POST', `${A}/users/${encodeURIComponent(id)}/float`, { body }),
    /** Branded QR print-out (HTML) for a merchant or agent. */
    poster: async (id: string, size: 'a4' | 'a5' | 'a6') => (await requestBlob(`${A}/users/${encodeURIComponent(id)}/poster?size=${size}`)).text(),
    statement: async (id: string, from: string, to: string, lang: 'en' | 'st') =>
      (await requestBlob(`${A}/users/${encodeURIComponent(id)}/statement?from=${from}&to=${to}&lang=${lang}`)).text(),
    devices: (id: string) => request<BoundDevice[]>('GET', `${A}/users/${encodeURIComponent(id)}/devices`),
    unbind: (id: string, deviceId: string) =>
      request<BoundDevice[]>('POST', `${A}/users/${encodeURIComponent(id)}/devices/${encodeURIComponent(deviceId)}/unbind`),
  },

  transactions: (q: TransactionQuery) =>
    request<Page<AdminTransaction>>('GET', `${A}/transactions`, { query: { ...q } }),
  audit: (page: number) => request<Page<AuditEntry>>('GET', `${A}/audit`, { query: { page } }),

  ecosure: {
    policies: (q: { query?: string; status?: EsPolicyStatus | ''; page?: number }) =>
      request<Page<EsPolicy>>('GET', `${A}/ecosure/policies`, { query: { ...q } }),
    claims: (q: { status?: EsClaimStatus | ''; page?: number }) =>
      request<Page<AdminEsClaim>>('GET', `${A}/ecosure/claims`, { query: { ...q } }),
    decide: (id: string, body: EsClaimDecisionBody) =>
      request<EsClaim>('POST', `${A}/ecosure/claims/${encodeURIComponent(id)}/decision`, { body }),
    claimDocument: (id: string, index: number) => requestBlob(`${A}/ecosure/claims/${encodeURIComponent(id)}/documents/${index}`),
    quotes: (q: { status?: EsQuoteStatus | ''; page?: number }) =>
      request<Page<AdminEsQuote>>('GET', `${A}/ecosure/quotes`, { query: { ...q } }),
    price: (reference: string, monthlyPremium: number) =>
      request<EsQuote>('POST', `${A}/ecosure/quotes/${encodeURIComponent(reference)}/price`, { body: { monthlyPremium } }),
    /** Not in shared/api.ts: the server also serves a quote's documents. */
    quoteDocument: (reference: string, index: number) =>
      requestBlob(`${A}/ecosure/quotes/${encodeURIComponent(reference)}/documents/${index}`),
  },

  appConfig: {
    get: () => request<AppConfig>('GET', '/v1/app-config', { anonymous: true }),
    put: (body: AppConfigBody) => request<AppConfig>('PUT', `${A}/app-config`, { body }),
  },

  tariff: {
    get: () => request<Tariff>('GET', `${A}/tariff`),
    put: (body: Tariff) => request<Tariff>('PUT', `${A}/tariff`, { body }),
  },

  societies: {
    list: () => request<AdminSociety[]>('GET', `${A}/societies`),
    get: (id: string) => request<SocietyDetail>('GET', `${A}/societies/${encodeURIComponent(id)}`),
    create: (body: CreateSocietyBody) => request<AdminSociety>('POST', `${A}/societies`, { body }),
  },
  donate: {
    list: () => request<AdminCause[]>('GET', `${A}/causes`),
    suspend: (id: string, reason: string) => request<AdminCause>('POST', `${A}/causes/${encodeURIComponent(id)}/suspend`, { body: { reason } }),
    reopen: (id: string) => request<AdminCause>('POST', `${A}/causes/${encodeURIComponent(id)}/reopen`, { body: {} }),
    settings: () => request<DonateSettings>('GET', `${A}/donate-settings`),
    saveSettings: (body: DonateSettings) => request<DonateSettings>('PUT', `${A}/donate-settings`, { body }),
  },
  ussd: {
    get: () => request<UssdSettings>('GET', `${A}/ussd-settings`),
    save: (body: UssdSettings) => request<UssdSettings>('PUT', `${A}/ussd-settings`, { body }),
  },
  societyApplications: {
    list: () => request<SocietyApplication[]>('GET', `${A}/society-applications`),
    approve: (id: string) => request<SocietyApplication>('POST', `${A}/society-applications/${encodeURIComponent(id)}/approve`, { body: {} }),
    reject: (id: string, reason: string) => request<SocietyApplication>('POST', `${A}/society-applications/${encodeURIComponent(id)}/reject`, { body: { reason } }),
    activate: (id: string, body: SocietySimBody) => request<SocietyApplication>('POST', `${A}/society-applications/${encodeURIComponent(id)}/activate`, { body }),
    settings: () => request<SocietyApplySettings>('GET', `${A}/society-apply-settings`),
    saveSettings: (body: SocietyApplySettings) => request<SocietyApplySettings>('PUT', `${A}/society-apply-settings`, { body }),
  },
  split: {
    get: () => request<SplitSettings>('GET', `${A}/split-settings`),
    put: (body: SplitSettings) => request<SplitSettings>('PUT', `${A}/split-settings`, { body }),
  },
  remit: {
    get: () => request<RemitSettings>('GET', `${A}/remit`),
    put: (body: RemitSettings) => request<RemitSettings>('PUT', `${A}/remit`, { body }),
    recent: () => request<AdminRemittance[]>('GET', `${A}/remittances`),
  },

  analytics: (days: number) => request<Analytics>('GET', `${A}/analytics`, { query: { days } }),
  performance: (days: number) => request<Performance>('GET', `${A}/performance`, { query: { days } }),
  risk: {
    alerts: (q: { status?: RiskAlertStatus | ''; severity?: RiskAlert['severity'] | ''; action?: RiskAlert['action'] | ''; page?: number; pageSize?: number }) => request<Page<RiskAlert>>('GET', `${A}/risk/alerts`, { query: { ...q } }),
    review: (id: string, body: RiskReviewBody) => request<RiskAlert>('POST', `${A}/risk/alerts/${encodeURIComponent(id)}/review`, { body }),
    rules: () => request<RiskRule[]>('GET', `${A}/risk/rules`),
    setRules: (body: RiskRule[]) => request<RiskRule[]>('PUT', `${A}/risk/rules`, { body }),
  },

  support: {
    tickets: (q: { status?: TicketStatus | ''; page?: number }) => request<Page<SupportTicket>>('GET', `${A}/support/tickets`, { query: { ...q } }),
    ticket: (id: string) => request<SupportTicketDetail>('GET', `${A}/support/tickets/${encodeURIComponent(id)}`),
    reply: (id: string, text: string) => request<SupportTicketDetail>('POST', `${A}/support/tickets/${encodeURIComponent(id)}/reply`, { body: { text } }),
    close: (id: string) => request<SupportTicketDetail>('POST', `${A}/support/tickets/${encodeURIComponent(id)}/close`),
    stats: (days: number) => request<SupportStats>('GET', `${A}/support/stats`, { query: { days } }),
  },

  home: {
    offers: () => request<Offer[]>('GET', `${A}/offers`),
    createOffer: (body: OfferBody) => request<Offer>('POST', `${A}/offers`, { body }),
    updateOffer: (id: string, body: OfferBody) => request<Offer>('PUT', `${A}/offers/${encodeURIComponent(id)}`, { body }),
    deleteOffer: (id: string) => request<void>('DELETE', `${A}/offers/${encodeURIComponent(id)}`),
    layout: () => request<HomeLayout>('GET', `${A}/home-layout`),
    setLayout: (body: HomeLayout) => request<HomeLayout>('PUT', `${A}/home-layout`, { body }),
    broadcasts: () => request<Broadcast[]>('GET', `${A}/broadcasts`),
    broadcast: (body: BroadcastBody) => request<Broadcast>('POST', `${A}/broadcasts`, { body }),
  },

  kycLimits: {
    get: () => request<KycLimits>('GET', `${A}/kyc-limits`),
    put: (body: KycLimits) => request<KycLimits>('PUT', `${A}/kyc-limits`, { body }),
  },
  atm: {
    redeem: (body: AtmRedeemBody) => request<AtmWithdrawal>('POST', `${A}/atm/redeem`, { body }),
  },

  billCategories: {
    list: () => request<BillCategory[]>('GET', `${A}/bill-categories`),
    create: (body: BillCategoryBody) => request<BillCategory>('POST', `${A}/bill-categories`, { body }),
    update: (id: string, body: Omit<BillCategoryBody, 'id'>) => request<BillCategory>('PUT', `${A}/bill-categories/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) => request<void>('DELETE', `${A}/bill-categories/${encodeURIComponent(id)}`),
  },
  places: {
    list: () => request<Place[]>('GET', `${A}/places`),
    create: (body: PlaceBody) => request<Place>('POST', `${A}/places`, { body }),
    update: (id: string, body: PlaceBody) => request<Place>('PUT', `${A}/places/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) => request<void>('DELETE', `${A}/places/${encodeURIComponent(id)}`),
  },
  feedback: () => request<Feedback[]>('GET', `${A}/feedback`),
  contact: {
    get: () => request<ContactSettings>('GET', `${A}/contact-settings`),
    put: (body: ContactSettings) => request<ContactSettings>('PUT', `${A}/contact-settings`, { body }),
  },

  branding: {
    get: () => request<Branding>('GET', `${A}/branding`),
    put: (body: BrandingBody) => request<Branding>('PUT', `${A}/branding`, { body }),
    upload: (body: AssetUploadBody) => request<Asset>('POST', `${A}/assets`, { body }),
    miniAppIcon: (id: MiniAppIconId, body: MiniAppIconBody) => request<Branding>('PUT', `${A}/branding/mini-apps/${id}`, { body }),
  },

  services: {
    list: () => request<ServiceDef[]>('GET', `${A}/services`),
    create: (body: ServiceBody) => request<ServiceDef>('POST', `${A}/services`, { body }),
    update: (id: string, body: ServiceBody) => request<ServiceDef>('PUT', `${A}/services/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) => request<void>('DELETE', `${A}/services/${encodeURIComponent(id)}`),
    requests: (q: { status?: ServiceRequestStatus | ''; page?: number }) =>
      request<Page<AdminServiceRequest>>('GET', `${A}/service-requests`, { query: { ...q } }),
    decide: (id: string, body: ServiceRequestDecisionBody) =>
      request<AdminServiceRequest>('POST', `${A}/service-requests/${encodeURIComponent(id)}/decision`, { body }),
    file: (id: string, key: string) => requestBlob(`${A}/service-requests/${encodeURIComponent(id)}/files/${encodeURIComponent(key)}`),
  },

  notifications: {
    list: (q: { channel?: NotifyChannel | ''; category?: NotifyCategory | ''; query?: string; page?: number }) =>
      request<Page<AdminNotification>>('GET', `${A}/notifications`, { query: { ...q } }),
    providers: () => request<NotificationProviders>('GET', `${A}/notifications/providers`),
    news: (body: NewsBody) => request<{ recipients: number }>('POST', `${A}/notifications/news`, { body }),
  },
}
