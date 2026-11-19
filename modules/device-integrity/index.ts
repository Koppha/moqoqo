import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

/** What the Android phone says about developer options, USB debugging, signs of root and being an emulator. */
export interface NativeIntegrity {
  developerOptions: boolean
  usbDebugging: boolean
  rootSigns: boolean
  emulator: boolean
}

const native = requireOptionalNativeModule<{ check(): Promise<NativeIntegrity>; wifiSecurity?(): 'open' | 'secured' | null }>('DeviceIntegrity')

/** Android only; on iPhone (developer mode can't be read there) and when the module isn't in the build, null. */
export async function checkNative(): Promise<NativeIntegrity | null> {
  if (Platform.OS !== 'android' || !native) return null
  try {
    return await native.check()
  } catch {
    return null
  }
}

/**
 * On Wi-Fi (Android 12+): 'open' when the network has no password, 'secured' otherwise; null when not on Wi-Fi,
 * on iPhone, on older Android, unknown, or when the build predates this function.
 */
export function wifiSecurity(): 'open' | 'secured' | null {
  if (Platform.OS !== 'android' || !native?.wifiSecurity) return null
  try {
    return native.wifiSecurity()
  } catch {
    return null
  }
}
