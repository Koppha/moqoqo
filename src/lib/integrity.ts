import * as Device from 'expo-device'
import { checkNative } from '../../modules/device-integrity'
import type { DeviceIntegrity } from '../../shared/api'

/**
 * This phone's safety, for the portal's device security: rooted or jailbroken (expo-device's check plus Android's
 * own signs), developer mode (Android developer options or USB debugging; not detectable on iPhone) and emulator.
 * Sent with every sign-in, where the server enforces it; the app also shows why it won't run.
 */
export async function checkIntegrity(): Promise<DeviceIntegrity> {
  const [rooted, native] = await Promise.all([Device.isRootedExperimentalAsync().catch(() => false), checkNative()])
  return {
    rooted: rooted || !!native?.rootSigns,
    developerMode: !!native && (native.developerOptions || native.usbDebugging),
    emulator: !Device.isDevice || !!native?.emulator,
  }
}
