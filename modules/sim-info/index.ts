import { requireOptionalNativeModule } from 'expo'
import { PermissionsAndroid, Platform } from 'react-native'

/** One SIM card in the phone. `number` only when the SIM stores it (many don't). */
export interface Sim {
  slot: number
  mcc: string | null
  mnc: string | null
  carrier: string | null
  number: string | null
  /** Android's id for this SIM card: a different card gets a different id, even for the same number. Null on older builds. */
  subId?: number | null
  /** Registered on a mobile network right now (null = unknown, e.g. an older build of this module). */
  inService?: boolean | null
}

const native = requireOptionalNativeModule<{ getSims(): Promise<Sim[]>; airplaneMode?(): boolean }>('SimInfo')

/**
 * The phone's SIM cards (Android). Asks for the phone permissions the first time; on iPhone (where apps can't read
 * the SIM) and when the module isn't in the build, an empty list.
 */
export async function getSims(): Promise<Sim[]> {
  if (Platform.OS !== 'android' || !native) return []
  try {
    await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE, PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS])
  } catch {
    // Denied or unavailable: the module still returns what it can.
  }
  try {
    return await native.getSims()
  } catch {
    return []
  }
}

/** True when the phone is in airplane mode (Android; false elsewhere or when unknown). */
export function airplaneMode(): boolean {
  try {
    return Platform.OS === 'android' && !!native?.airplaneMode?.()
  } catch {
    return false
  }
}

/** Whether this build can read the SIM at all (Android with the module). */
export const canReadSims = Platform.OS === 'android' && !!native
