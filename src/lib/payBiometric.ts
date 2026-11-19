import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import type { PayBiometricToken } from '../../shared/api'
import { api, setPayTokenRejectedHandler } from './api'

/**
 * Fingerprint or face to approve payments (CBL/LCA DFS guidelines 3.2.5b-iii). The wallet PIN once gets a token from the
 * server; the phone keeps it in its keystore behind the biometric prompt (requireAuthentication), and sends it in
 * place of the PIN. New fingerprints on the phone make the token unreadable: then this turns itself off and the PIN
 * is asked again. A plain flag says it's on, so screens don't have to prompt to find out.
 */
const KEY_TOKEN = 'moqoqo.payToken'
const KEY_ON = 'moqoqo.payBiometric'

let on = false
try {
  on = Platform.OS !== 'web' && SecureStore.getItem(KEY_ON) === '1'
} catch {
  on = false
}
const listeners = new Set<() => void>()
const setOn = (v: boolean) => {
  on = v
  listeners.forEach((l) => l())
}

export const usePayBiometric = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => on)
export const payBiometricOn = () => on

/** The phone can keep a secret behind its fingerprint or face (and has one enrolled). */
export function canUsePayBiometric(): boolean {
  if (Platform.OS === 'web') return false
  try {
    return SecureStore.canUseBiometricAuthentication()
  } catch {
    return false
  }
}

async function clearLocal() {
  await Promise.all([SecureStore.deleteItemAsync(KEY_TOKEN).catch(() => {}), SecureStore.deleteItemAsync(KEY_ON).catch(() => {})])
  setOn(false)
}

/** Turn it on with the wallet PIN. Throws the server's error (wrong PIN) or a keystore error. */
export async function enablePayBiometric(pin: string, prompt: string): Promise<void> {
  const { token } = await api<PayBiometricToken>('/v1/me/pay-biometric', { body: { pin } })
  try {
    await SecureStore.setItemAsync(KEY_TOKEN, token, { requireAuthentication: true, authenticationPrompt: prompt })
    await SecureStore.setItemAsync(KEY_ON, '1')
    setOn(true)
  } catch (e) {
    await api('/v1/me/pay-biometric', { method: 'DELETE' }).catch(() => {})
    await clearLocal()
    throw e
  }
}

export async function disablePayBiometric(): Promise<void> {
  await api('/v1/me/pay-biometric', { method: 'DELETE' }).catch(() => {})
  await clearLocal()
}

/** Signing out: forget it on this phone (the server revokes it with the phone's sessions). */
export const forgetPayBiometric = clearLocal

// Refused by the server (90 days old, or the phone was unbound): stop offering it; Me › Fingerprint turns it on again.
setPayTokenRejectedHandler(() => { void clearLocal() })

/** The token after the fingerprint or face check, or null (cancelled, or the key is gone: then it turns itself off). */
export async function payBiometricToken(prompt: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_TOKEN, { requireAuthentication: true, authenticationPrompt: prompt })
  } catch (e) {
    // A cancelled prompt keeps it on; an unreadable key (new fingerprints enrolled) turns it off.
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel/i.test(msg)) await clearLocal()
    return null
  }
}
