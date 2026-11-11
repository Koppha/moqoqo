import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

/** What the Android phone says about developer options, USB debugging, signs of root and being an emulator. */
export interface NativeIntegrity {
  developerOptions: boolean
  usbDebugging: boolean
  rootSigns: boolean
  emulator: boolean
}

const native = requireOptionalNativeModule<{ check(): Promise<NativeIntegrity> }>('DeviceIntegrity')

/** Android only; on iPhone (developer mode can't be read there) and when the module isn't in the build, null. */
export async function checkNative(): Promise<NativeIntegrity | null> {
  if (Platform.OS !== 'android' || !native) return null
  try {
    return await native.check()
  } catch {
    return null
  }
}
