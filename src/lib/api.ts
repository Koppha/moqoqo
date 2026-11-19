import { NETWORK_NEW_HEADER, type ApiError, type ErrorCode, type Maintenance } from '../../shared/api'
import { API_URL } from './variant'
import { deviceContextHeader } from './deviceContext'

/** A failed API call, carrying the contract's error code (NETWORK when the server couldn't be reached). */
export class ApiFailure extends Error {
  constructor(public code: ErrorCode, message: string, public maintenance?: Maintenance) {
    super(message)
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null
let onMaintenance: ((m: Maintenance | undefined) => void) | null = null
let onNetworkNew: (() => void) | null = null
let onTokenRotated: ((t: string) => void) | null = null
let onPayTokenRejected: (() => void) | null = null

export const setApiToken = (t: string | null) => { token = t }
export const getApiToken = () => token
/** The session ended server-side (expired, revoked, suspended): sign out locally. */
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn }
/** Any call answered 503 MAINTENANCE: show the maintenance page without waiting for the next config poll. */
export const setMaintenanceHandler = (fn: ((m: Maintenance | undefined) => void) | null) => { onMaintenance = fn }
/** The server saw this phone on a network it hasn't used before (x-network-new): NetworkGuard asks before continuing. */
export const setNetworkNewHandler = (fn: (() => void) | null) => { onNetworkNew = fn }
/** The server replaced the session token (x-session-token, daily): Auth stores the new one. */
export const setTokenRotatedHandler = (fn: ((t: string) => void) | null) => { onTokenRotated = fn }
/** A payment-fingerprint token was refused (expired after 90 days, or revoked): forget it on this phone. */
export const setPayTokenRejectedHandler = (fn: (() => void) | null) => { onPayTokenRejected = fn }

const TIMEOUT_MS = 15_000


/**
 * `onBehalfOf: true` when the call acts for someone else (a merchant terminal charging a customer's card):
 * their SUSPENDED or UNAUTHORIZED must not sign out the person holding this device.
 */
export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; onBehalfOf?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const context = deviceContextHeader()
  if (context) headers['x-device-context'] = context
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(API_URL + path, {
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
  if (res.headers.get(NETWORK_NEW_HEADER) === '1') onNetworkNew?.()
  // Daily session-token rotation (DFS guidelines 3.2.6h): switch at once; the old token works 5 more minutes.
  const rotated = res.headers.get('x-session-token')
  if (rotated && token) {
    token = rotated
    onTokenRotated?.(rotated)
  }
  if (res.status === 204) return undefined as T
  const json = await res.json().catch(() => null)
  if (res.ok) return json as T
  const err = (json as ApiError | null)?.error
  const code: ErrorCode = err?.code ?? 'UNKNOWN'
  if ((code === 'UNAUTHORIZED' || code === 'SUSPENDED') && token && !init.onBehalfOf) onUnauthorized?.()
  if (code === 'MAINTENANCE') onMaintenance?.(err?.maintenance)
  const sentPin = (init.body as { pin?: unknown } | undefined)?.pin
  if (code === 'WRONG_PIN' && typeof sentPin === 'string' && sentPin.startsWith('B.')) onPayTokenRejected?.()
  throw new ApiFailure(code, err?.message ?? res.statusText)
}

export const errorCode = (e: unknown): ErrorCode => (e instanceof ApiFailure ? e.code : 'UNKNOWN')
