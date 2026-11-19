import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

// Tap to pay (Android): the phone answers a merchant's NFC reader with a one-time pay code. See
// android/…/EcoCashHceService.kt for the exchange. Not in the build (web, iPhone, an old dev build): unsupported.
type Native = {
  isSupported(): boolean
  isEnabled(): boolean
  setPayCode(code: string, expiresAtMs: number): void
  clear(): void
  addListener(event: 'onRead', listener: () => void): { remove(): void }
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('EcoCashHce') : null

/** The application ID merchants' readers select (also in res/xml/ecocash_apdu_service.xml). */
export const ECOCASH_AID = 'F045434F43415348'
/** What the phone answers before the code: "EC1:" + 18 digits. */
export const TAP_PREFIX = 'EC1:'

export const tapSupported = (): boolean => {
  try {
    return !!native?.isSupported()
  } catch {
    return false
  }
}

export const nfcEnabled = (): boolean => {
  try {
    return !!native?.isEnabled()
  } catch {
    return false
  }
}

/** The code the next tap hands over, until `expiresAt` (ISO) or until cleared. */
export function armTap(code: string, expiresAt: string) {
  native?.setPayCode(code, Date.parse(expiresAt))
}

export function disarmTap() {
  native?.clear()
}

/** A reader just took the code (the payment is on its way). */
export function onTapRead(listener: () => void): () => void {
  const sub = native?.addListener('onRead', listener)
  return () => sub?.remove()
}
