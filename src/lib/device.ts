import * as Application from 'expo-application'
import * as Device from 'expo-device'
import * as Network from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { getSims, type Sim } from '../../modules/sim-info'
import { ECONET_SIM, type DeviceInfo, type NetworkCheck } from '../../shared/api'
import { checkIntegrity } from './integrity'
import { CAN_CHANGE_SERVER } from './server'

// This phone, as the server sees it for device binding, and what it can tell about its SIM and connection
// (setting up EcoCash Super App needs an Econet SIM on Econet mobile data).

const KEY_FALLBACK_ID = 'moqoqo.deviceId'
const KEY_SIMULATE = 'moqoqo.simulateEconet'

async function deviceId(): Promise<string> {
  if (Platform.OS === 'android') {
    const id = Application.getAndroidId()
    if (id) return id
  } else if (Platform.OS === 'ios') {
    const id = await Application.getIosIdForVendorAsync()
    if (id) return id
  }
  let id = await SecureStore.getItemAsync(KEY_FALLBACK_ID)
  if (!id) {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    await SecureStore.setItemAsync(KEY_FALLBACK_ID, id)
  }
  return id
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  return {
    deviceId: await deviceId(),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    model: Device.modelName ?? Device.brand ?? 'Phone',
    osVersion: Device.osVersion ?? '',
    appVersion: Application.nativeApplicationVersion ?? '',
    integrity: await checkIntegrity(),
  }
}

/** Test builds only: pretend to be on Econet (emulators have test SIMs). The server refuses it in production. */
export async function getSimulateEconet(): Promise<boolean> {
  return CAN_CHANGE_SERVER && (await SecureStore.getItemAsync(KEY_SIMULATE)) === '1'
}
export async function setSimulateEconet(on: boolean) {
  if (on) await SecureStore.setItemAsync(KEY_SIMULATE, '1')
  else await SecureStore.deleteItemAsync(KEY_SIMULATE)
}

export const isEconetSim = (s: Pick<Sim, 'mcc' | 'mnc'>) => s.mcc === ECONET_SIM.mcc && s.mnc === ECONET_SIM.mnc

export interface PhoneCheck {
  network: NetworkCheck
  sims: Sim[]
  /** The Econet SIM's number when the SIM stores it, without +266. */
  econetNumber: string | null
  /** Why setting up would be refused, for a hint before the user even types (null = looks fine). */
  problem: 'wifi' | 'offline' | 'not_econet' | null
}

export async function checkPhone(): Promise<PhoneCheck> {
  const [state, sims, simulated] = await Promise.all([Network.getNetworkStateAsync(), getSims(), getSimulateEconet()])
  const type: NetworkCheck['type'] =
    state.type === Network.NetworkStateType.CELLULAR ? 'cellular'
      : state.type === Network.NetworkStateType.WIFI ? 'wifi'
        : state.type === Network.NetworkStateType.NONE || state.isConnected === false ? 'none'
          : 'other'
  // Each SIM's number too, where the SIM stores it: on a first sign-in the server checks the wallet's SIM is in this phone.
  const network: NetworkCheck = { type, sims: sims.map((s) => ({ mcc: s.mcc, mnc: s.mnc, carrier: s.carrier, number: s.number })) }
  if (simulated) network.simulated = true
  const econet = sims.find(isEconetSim)
  const econetNumber = econet?.number ? econet.number.replace(/\D/g, '').replace(/^266/, '').slice(-8) : null
  const problem = simulated ? null : type === 'none' ? 'offline' : type !== 'cellular' ? 'wifi' : sims.length && !econet ? 'not_econet' : null
  return { network, sims, econetNumber, problem }
}
