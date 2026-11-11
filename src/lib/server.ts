import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { API_URL as BUILT_URL } from './variant'

// The API server address. Production builds always use the address they were built with (HTTPS). Local test
// builds (plain http://) may point at another server at runtime, so a PC whose Wi-Fi address changes doesn't
// need a new build: long-press the logo on the login screen. The choice is kept on the device.

const KEY = 'moqoqo.server'

/**
 * Test builds use http://localhost:4100, which never changes when the PC changes network: a phone on USB reaches the
 * PC through `adb reverse tcp:4100 tcp:4100`. An Android emulator uses 10.0.2.2 (its fixed address for the PC), so it
 * works even without adb reverse.
 */
const API_URL = Platform.OS === 'android' && !Device.isDevice && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BUILT_URL)
  ? BUILT_URL.replace(/localhost|127\.0\.0\.1/, '10.0.2.2')
  : BUILT_URL

/** Only test builds talking to a local server over http may change it. */
export const CAN_CHANGE_SERVER = API_URL.startsWith('http://')

let current = API_URL

/** Resolves once a saved address (if any) is loaded; API calls and the WebSocket wait for it. */
export const serverReady: Promise<void> = CAN_CHANGE_SERVER
  ? SecureStore.getItemAsync(KEY).then((v) => { if (v) current = v }, () => {})
  : Promise.resolve()

export const apiUrl = () => current
export const isDefaultServer = () => current === API_URL

/** "192.168.1.5:4100" or "http://192.168.1.5:4100/" → "http://192.168.1.5:4100"; null if not an address. */
export function normaliseServer(input: string): string | null {
  let v = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`
  try {
    const u = new URL(v)
    return u.hostname ? `${u.protocol}//${u.host}` : null
  } catch {
    return null
  }
}

export async function setServer(url: string | null) {
  current = url ?? API_URL
  if (url) await SecureStore.setItemAsync(KEY, url)
  else await SecureStore.deleteItemAsync(KEY)
}
