import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, API_URL, ApiClientError, getToken, NETWORK_MESSAGE, setToken, setUnauthorizedHandler } from './api'
import { mockFetch } from './test/utils'

describe('API client', () => {
  let restore: () => void
  let unauthorized: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    unauthorized = vi.fn<() => void>()
    restore = setUnauthorizedHandler(unauthorized)
  })
  afterEach(() => {
    restore()
    vi.unstubAllGlobals()
  })

  it('sends the bearer token and parses JSON', async () => {
    setToken('tok-123')
    const { calls } = mockFetch({ 'GET /admin/v1/me': () => ({ body: { id: 'a1', email: 'x@etl.co.ls', name: 'X', role: 'admin' } }) })
    const me = await api.me()
    expect(me.email).toBe('x@etl.co.ls')
    expect(calls[0].headers.Authorization).toBe('Bearer tok-123')
    expect(calls[0].url).toBe(`${API_URL}/admin/v1/me`)
  })

  it('does not send the admin token to the public app-config endpoint', async () => {
    setToken('tok-123')
    const { calls } = mockFetch({
      'GET /v1/app-config': () => ({ body: { maintenance: null, announcement: null, minVersion: { customer: null, business: null, ecosure: null }, deviceSecurity: { blockRooted: false, blockDeveloperMode: false }, serverTime: '' } }),
    })
    await api.appConfig.get()
    expect(calls[0].headers.Authorization).toBeUndefined()
  })

  it('builds query strings and skips empty filters', async () => {
    const { calls } = mockFetch({ 'GET /admin/v1/users': () => ({ body: { items: [], total: 0, page: 2, pageSize: 25 } }) })
    await api.users.list({ query: 'Lerato', role: '', status: 'suspended', page: 2 })
    expect(calls[0].url).toBe(`${API_URL}/admin/v1/users?query=Lerato&status=suspended&page=2`)
  })

  it('parses an ApiError body into a typed error with its code', async () => {
    mockFetch({
      'POST /admin/v1/maintenance': () => ({ status: 422, body: { error: { code: 'VALIDATION', message: 'endsAt must be after startsAt' } } }),
    })
    const err = await api.maintenance.create({ startsAt: 'a', endsAt: 'b', message: { en: 'x', st: 'y' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiClientError)
    expect(err).toMatchObject({ code: 'VALIDATION', status: 422, message: 'endsAt must be after startsAt' })
  })

  it('maps a non-JSON error response by status code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Conflict</html>', { status: 409, statusText: 'Conflict' })))
    await expect(api.stats()).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })))
    await expect(api.stats()).rejects.toMatchObject({ code: 'UNKNOWN', status: 502 })
  })

  it('keeps the maintenance payload on 503 MAINTENANCE', async () => {
    const maintenance = { id: 'm1', startsAt: 's', endsAt: 'e', message: { en: 'a', st: 'b' }, active: true }
    mockFetch({ 'GET /admin/v1/stats': () => ({ status: 503, body: { error: { code: 'MAINTENANCE', message: 'Down', maintenance } } }) })
    await expect(api.stats()).rejects.toMatchObject({ code: 'MAINTENANCE', maintenance })
  })

  it('on 401 clears the token and calls the unauthorized handler', async () => {
    setToken('expired')
    mockFetch({ 'GET /admin/v1/stats': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Session expired' } } }) })
    await expect(api.stats()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
    expect(getToken()).toBeNull()
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('a failed login (401) does not trigger the global redirect', async () => {
    mockFetch({ 'POST /admin/v1/login': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Wrong email or password' } } }) })
    await expect(api.login({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('turns a network failure into a NETWORK error instead of crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const err = await api.stats().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiClientError)
    expect(err).toMatchObject({ code: 'NETWORK', status: 0, message: NETWORK_MESSAGE })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('returns undefined for 204 No Content', async () => {
    mockFetch({ 'POST /admin/v1/users/u1/reset-pin': () => ({ status: 204 }) })
    await expect(api.users.resetPin('u1', { pin: '4821' })).resolves.toBeUndefined()
  })
})
