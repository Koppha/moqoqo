import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import type { AppKind, EcoSureProfileStart, LoginResponse, LoginResult, Me, OnboardingStart } from '../../shared/api'
import { checkPhone, getDeviceInfo } from '../lib/device'
import { useT } from '../i18n'
import { api, ApiFailure, setApiToken, setTokenRotatedHandler, setUnauthorizedHandler } from '../lib/api'
import { unregisterPush } from '../lib/notifications'
import { forgetPayBiometric } from '../lib/payBiometric'
import { clearAppShortcuts } from '../lib/shortcuts'
import { APP } from '../lib/variant'
import { displayHandoff } from '../theme'

// signedOut → login route. locked → app routes stay mounted under the lock overlay, so
// unlocking returns to the exact screen the user left. unlocked → normal use.
export type AuthStatus = 'loading' | 'signedOut' | 'locked' | 'unlocked'

/** Lock again after this long in the background. */
const LOCK_AFTER_MS = 60_000

const KEY_SESSION = 'moqoqo.session'
const KEY_BIOMETRICS = 'moqoqo.biometrics'
/** While a business is open from EcoCash Business (the mini app): the person's own session, to return to. */
const KEY_OWNER = 'moqoqo.ownerSession'

export interface Session {
  token: string
  user: Me
}

/** Ok, or the contract's error code. */
export type AuthResult = { ok: true } | { ok: false; code: ApiFailure['code']; message?: string }
/** signIn on a phone that isn't bound to the wallet yet: continue with sign-up (ID check + OTP). */
export type SignInResult = AuthResult | { ok: 'setup'; onboarding: OnboardingStart }
/** The EcoSure app: creating an EcoSure profile (own PIN) starts with an SMS code. */
export type ProfileStartResult = { ok: true; start: EcoSureProfileStart } | { ok: false; code: ApiFailure['code']; message?: string }
const fail = (e: unknown): AuthResult => ({ ok: false, code: e instanceof ApiFailure ? e.code : 'UNKNOWN', message: e instanceof ApiFailure ? e.message : undefined })

export interface Biometrics {
  /** Device has a sensor and the user has enrolled a fingerprint/face. Many Famoco terminals have neither. */
  available: boolean
  face: boolean
  enabled: boolean
}

interface Auth {
  status: AuthStatus
  session: Session | null
  /** When the user last signed in or unlocked (ms). Screens opened from a shortcut count that as fresh confirmation. */
  unlockedAt: number | null
  /** The payment code was confirmed with the PIN/biometrics in this unlock session (asked once per session). */
  payCodeVerified: boolean
  verifyPayCode(): void
  biometrics: Biometrics
  /** After the first login on a device with biometrics, ask once whether to use them. */
  offerBiometrics: boolean
  /** `role`: the business app's Merchant / Agent choice. */
  signIn(msisdn: string, pin: string, role?: 'agent' | 'merchant'): Promise<SignInResult>
  /** The last sign-up step (OTP) signed in: keep the session. */
  completeSignIn(res: LoginResponse): Promise<void>
  /** The EcoSure app: create an EcoSure profile with the person's own PIN, or reset a forgotten one. */
  startEcoSureProfile(msisdn: string): Promise<ProfileStartResult>
  unlockWithPin(pin: string): Promise<AuthResult>
  /** Keep the stored profile current (name, balance, role) after /v1/me. */
  updateUser(user: Me): void
  /** Shows the system biometric prompt; resolves true when it passed. */
  unlockWithBiometrics(): Promise<boolean>
  /** Biometric check without changing lock state, e.g. to confirm a payment. False when not enabled. */
  verifyBiometrics(): Promise<boolean>
  setBiometricsEnabled(on: boolean): Promise<boolean>
  dismissOffer(): void
  lock(): void
  signOut(remote?: boolean): Promise<void>
  /** A linked agent or merchant account is open (EcoCash Business mini app); the person's own session waits. */
  inBusiness: boolean
  /** While a business is open: the person it was opened by (their own name, for "Back to EcoCash Super App"). */
  ownerName: string | null
  /** Opens a linked business: its session replaces the person's until closeBusiness. */
  openBusiness(businessId: string): Promise<AuthResult>
  /** Back to EcoCash Super App: ends the business session and restores the person's own. */
  closeBusiness(): Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [owner, setOwner] = useState<Session | null>(null)
  const ownerRef = useRef<Session | null>(null)
  useEffect(() => { ownerRef.current = owner }, [owner])
  const [biometrics, setBiometrics] = useState<Biometrics>({ available: false, face: false, enabled: false })
  const [offerBiometrics, setOfferBiometrics] = useState(false)
  const [unlockedAt, setUnlockedAt] = useState<number | null>(null)
  // The unlock session (its unlockedAt) in which the payment code was confirmed. A new unlock starts a new
  // session, so the next lock (background > LOCK_AFTER_MS, Lock now, sign-out) asks again.
  const [payCodeFor, setPayCodeFor] = useState<number | null>(null)
  const verifyPayCode = useCallback(() => setPayCodeFor(unlockedAt), [unlockedAt])

  // Restore the session on launch. A stored session always starts locked.
  useEffect(() => {
    ;(async () => {
      const [raw, bio, hasHardware, enrolled, types, ownerRaw] = await Promise.all([
        SecureStore.getItemAsync(KEY_SESSION),
        SecureStore.getItemAsync(KEY_BIOMETRICS),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
        SecureStore.getItemAsync(KEY_OWNER),
      ])
      const available = hasHardware && enrolled
      const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
        && !types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      setBiometrics({ available, face, enabled: available && bio === '1' })
      const parsed = raw ? (JSON.parse(raw) as Partial<Session>) : null
      // Sessions saved by the pre-server build have no user: start over at login.
      let stored = parsed?.token && parsed.user ? (parsed as Session) : null
      // The app closed while a business was open: start again in the person's own EcoCash Super App. Unless it only
      // reloaded for a display change: then the business stays open.
      const ownerStored = ownerRaw ? (JSON.parse(ownerRaw) as Session) : null
      if (ownerStored?.token && displayHandoff && stored) {
        ownerRef.current = ownerStored
        setOwner(ownerStored)
      } else if (ownerStored?.token) {
        if (stored) {
          setApiToken(stored.token)
          await api('/v1/auth/logout', { method: 'POST' }).catch(() => {})
        }
        stored = ownerStored
        await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(stored))
        await SecureStore.deleteItemAsync(KEY_OWNER)
      }
      setApiToken(stored?.token ?? null)
      setSession(stored)
      // Back from a display change made a moment ago, unlocked: stay unlocked. Any other start asks for the PIN.
      if (stored && displayHandoff) {
        setStatus('unlocked')
        setUnlockedAt(Date.now())
      } else setStatus(stored ? 'locked' : 'signedOut')
    })().catch(() => setStatus('signedOut'))
  }, [])

  // Re-lock after LOCK_AFTER_MS in the background. Only 'background' counts:
  // the biometric prompt itself makes iOS report 'inactive'.
  const backgroundedAt = useRef<number | null>(null)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') backgroundedAt.current = Date.now()
      else if (next === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current
        backgroundedAt.current = null
        if (away >= LOCK_AFTER_MS) setStatus((s) => (s === 'unlocked' ? 'locked' : s))
      }
    })
    return () => sub.remove()
  }, [])

  const completeSignIn = useCallback(async (res: LoginResponse) => {
    const next: Session = { token: res.token, user: res.user }
    await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(next))
    setApiToken(next.token)
    setSession(next)
    setOfferBiometrics(biometrics.available && !biometrics.enabled)
    setStatus('unlocked')
    setUnlockedAt(Date.now())
  }, [biometrics])

  const signIn = useCallback(async (msisdn: string, pin: string, role?: 'agent' | 'merchant'): Promise<SignInResult> => {
    try {
      const [device, phone] = await Promise.all([getDeviceInfo(), checkPhone()])
      const res = await api<LoginResult>('/v1/auth/login', { body: { msisdn, pin, app: APP, role, device, network: phone.network } })
      if ('onboarding' in res) return { ok: 'setup', onboarding: res.onboarding }
      const next: Session = { token: res.token, user: res.user }
      await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(next))
      setApiToken(next.token)
      setSession(next)
      setOfferBiometrics(biometrics.available && !biometrics.enabled)
      setStatus('unlocked')
      setUnlockedAt(Date.now())
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }, [biometrics])

  // The PIN is checked by the server, so unlocking needs a connection; biometrics work offline.
  const unlockWithPin = useCallback(async (pin: string): Promise<AuthResult> => {
    if (!session) return { ok: false, code: 'UNAUTHORIZED' }
    try {
      await api('/v1/auth/unlock', { body: { pin } })
      setStatus('unlocked')
      setUnlockedAt(Date.now())
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }, [session])

  const updateUser = useCallback((user: Me) => {
    setSession((s) => {
      if (!s) return s
      const next = { ...s, user }
      SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const prompt = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: t.auth.bioPrompt,
      cancelLabel: t.auth.usePin,
      // The PIN fallback is our own keypad, not the device screen lock.
      disableDeviceFallback: true,
    })
    return res.success
  }, [t])

  const unlockWithBiometrics = useCallback(async () => {
    if (!biometrics.enabled) return false
    const ok = await prompt()
    if (ok) {
      setStatus('unlocked')
      setUnlockedAt(Date.now())
    }
    return ok
  }, [biometrics.enabled, prompt])

  const setBiometricsEnabled = useCallback(async (on: boolean) => {
    setOfferBiometrics(false)
    if (on) {
      // Confirm the person holding the phone can actually pass the prompt before relying on it.
      if (!biometrics.available || !(await prompt())) return false
      await SecureStore.setItemAsync(KEY_BIOMETRICS, '1')
    } else {
      await SecureStore.deleteItemAsync(KEY_BIOMETRICS)
    }
    setBiometrics((b) => ({ ...b, enabled: on }))
    return true
  }, [biometrics.available, prompt])

  const openBusiness = useCallback(async (businessId: string): Promise<AuthResult> => {
    if (!session || ownerRef.current) return { ok: false, code: 'FORBIDDEN' }
    try {
      const res = await api<LoginResponse>(`/v1/businesses/${businessId}/open`, { body: {} })
      const next: Session = { token: res.token, user: res.user }
      await SecureStore.setItemAsync(KEY_OWNER, JSON.stringify(session))
      await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(next))
      setOwner(session)
      setApiToken(next.token)
      setSession(next)
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }, [session])

  /** `remote: false` when the server already ended the business session (unlinked, suspended). */
  const closeBusiness = useCallback(async (remote = true) => {
    const back = ownerRef.current
    if (!back) return
    if (remote) {
      await unregisterPush()
      await api('/v1/auth/logout', { method: 'POST' }).catch(() => {})
    }
    await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(back))
    await SecureStore.deleteItemAsync(KEY_OWNER)
    ownerRef.current = null
    setOwner(null)
    setApiToken(back.token)
    setSession(back)
  }, [])

  /** `remote: false` when the server already ended the session (401), so there's nothing to revoke. */
  const signOut = useCallback(async (remote = true) => {
    // Signing out from inside a business signs the person out, not just the business.
    if (ownerRef.current) await closeBusiness(remote)
    if (remote) {
      await unregisterPush()
      await api('/v1/auth/logout', { method: 'POST' }).catch(() => {})
    }
    setApiToken(null)
    await Promise.all([SecureStore.deleteItemAsync(KEY_SESSION), SecureStore.deleteItemAsync(KEY_BIOMETRICS), forgetPayBiometric()])
    setSession(null)
    setBiometrics((b) => ({ ...b, enabled: false }))
    setStatus('signedOut')
    clearAppShortcuts()
  }, [closeBusiness])

  // Revoked, expired or suspended on the server: drop the local session too.
  useEffect(() => {
    // In a business that was unlinked or suspended: back to the person's own app, still signed in.
    setUnauthorizedHandler(() => { if (ownerRef.current) closeBusiness(false); else signOut(false) })
    return () => setUnauthorizedHandler(null)
  }, [signOut, closeBusiness])

  // The server rotates the session token daily: keep the stored session on the new one (business session included).
  useEffect(() => {
    setTokenRotatedHandler((t) => setSession((s) => {
      if (!s) return s
      const next = { ...s, token: t }
      SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(next)).catch(() => {})
      return next
    }))
    return () => setTokenRotatedHandler(null)
  }, [])

  const startEcoSureProfile = useCallback(async (msisdn: string): Promise<ProfileStartResult> => {
    try {
      const [device, phone] = await Promise.all([getDeviceInfo(), checkPhone()])
      return { ok: true, start: await api<EcoSureProfileStart>('/v1/ecosure/profile', { body: { msisdn, device, network: phone.network } }) }
    } catch (e) {
      return { ok: false, code: e instanceof ApiFailure ? e.code : 'UNKNOWN', message: e instanceof ApiFailure ? e.message : undefined }
    }
  }, [])

  useEffect(() => { currentMode = modeFor(session?.user.role) }, [session])
  const value: Auth = {
    status, session, unlockedAt, biometrics, offerBiometrics,
    payCodeVerified: status === 'unlocked' && unlockedAt !== null && payCodeFor === unlockedAt, verifyPayCode,
    inBusiness: owner !== null, ownerName: owner?.user.name ?? null, openBusiness, closeBusiness: () => closeBusiness(),
    signIn, completeSignIn, startEcoSureProfile, unlockWithPin, unlockWithBiometrics, setBiometricsEnabled, signOut, updateUser,
    verifyBiometrics: async () => biometrics.enabled && prompt(),
    dismissOffer: () => setOfferBiometrics(false),
    lock: () => setStatus((s) => (s === 'unlocked' ? 'locked' : s)),
  }
  return <Ctx value={value}>{children}</Ctx>
}

/**
 * Which app this is for the person now: EcoCash Super App shows EcoCash Business (the business screens) while a linked
 * agent or merchant account is open from the mini app.
 */
export function useAppMode(): AppKind {
  return modeFor(useAuth().session?.user.role)
}
const modeFor = (role: Me['role'] | undefined): AppKind => (APP === 'customer' && role && role !== 'customer' ? 'business' : APP)
/** useAppMode outside React (assistant actions, banner taps). */
export const appModeNow = () => currentMode
let currentMode: AppKind = APP

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
