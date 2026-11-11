import type { ApiError, ErrorCode, Maintenance } from '../../shared/api'
import { apiUrl, serverReady } from './server'

/** A failed API call, carrying the contract's error code (NETWORK when the server couldn't be reached). */
export class ApiFailure extends Error {
  constructor(public code: ErrorCode, message: string, public maintenance?: Maintenance) {
    super(message)
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null
let onMaintenance: ((m: Maintenance | undefined) => void) | null = null

export const setApiToken = (t: string | null) => { token = t }
export const getApiToken = () => token
/** The session ended server-side (expired, revoked, suspended): sign out locally. */
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn }
/** Any call answered 503 MAINTENANCE: show the maintenance page without waiting for the next config poll. */
export const setMaintenanceHandler = (fn: ((m: Maintenance | undefined) => void) | null) => { onMaintenance = fn }

const TIMEOUT_MS = 15_000

/**
 * `onBehalfOf: true` when the call acts for someone else (a merchant terminal charging a customer's card):
 * their SUSPENDED or UNAUTHORIZED must not sign out the person holding this device.
 */
export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; onBehalfOf?: boolean; /** The response is text (e.g. HTML), not JSON. */ text?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    await serverReady
    res = await fetch(apiUrl() + path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    })
  } catch {
    throw new ApiFailure('NETWORK', 'Network request failed')
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 204) return undefined as T
  if (init.text && res.ok) return (await res.text()) as T
  const json = await res.json().catch(() => null)
  if (res.ok) return json as T
  const err = (json as ApiError | null)?.error
  const code: ErrorCode = err?.code ?? 'UNKNOWN'
  if ((code === 'UNAUTHORIZED' || code === 'SUSPENDED') && token && !init.onBehalfOf) onUnauthorized?.()
  if (code === 'MAINTENANCE') onMaintenance?.(err?.maintenance)
  throw new ApiFailure(code, err?.message ?? res.statusText)
}

export const errorCode = (e: unknown): ErrorCode => (e instanceof ApiFailure ? e.code : 'UNKNOWN')
