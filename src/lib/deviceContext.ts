import * as Device from 'expo-device'
import * as Location from 'expo-location'
import * as Network from 'expo-network'
import { AppState, Dimensions, PixelRatio, Platform } from 'react-native'
import { wifiSecurity } from '../../modules/device-integrity'
import type { DeviceContext } from '../../shared/api'

/**
 * The phone's context, sent with every request (header x-device-context) so the server can tell the bound phone
 * from a copy, or the right phone in an unusual place (CBL/LCA DFS guidelines 3.2.3a/b). Location only when the
 * person already allowed it (Places asks), rounded to about 10 km; this never asks for any permission itself.
 */
let header: string | null = null
let builtAt = 0
let building: Promise<void> | null = null
const MAX_AGE_MS = 2 * 60_000

function toBase64Url(text: string): string {
  const bytes = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function build() {
  const [net, loc] = await Promise.all([
    Network.getNetworkStateAsync().catch(() => null),
    (async () => {
      try {
        if (Platform.OS === 'web') return null
        const perm = await Location.getForegroundPermissionsAsync()
        if (!perm.granted) return null
        const p = await Location.getLastKnownPositionAsync({ maxAge: 60 * 60_000 })
        return p ? ([Math.round(p.coords.latitude * 10) / 10, Math.round(p.coords.longitude * 10) / 10] as [number, number]) : null
      } catch {
        return null
      }
    })(),
  ])
  const s = Dimensions.get('screen')
  const scale = PixelRatio.get()
  const [w, h] = [Math.round(s.width * scale), Math.round(s.height * scale)].sort((a, b) => a - b)
  const kind: DeviceContext['net'] =
    net?.type === Network.NetworkStateType.CELLULAR ? 'cellular' : net?.type === Network.NetworkStateType.WIFI ? 'wifi' : net?.isConnected === false ? 'none' : 'other'
  const c: DeviceContext = {
    net: kind,
    wifi: kind === 'wifi' ? wifiSecurity() : null,
    screen: `${w}x${h}`,
    os: `${Platform.OS} ${Device.osVersion ?? ''}`.trim(),
    model: Device.modelName ?? Device.brand ?? 'Phone',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    loc,
  }
  header = toBase64Url(JSON.stringify(c))
  builtAt = Date.now()
}

function refresh() {
  if (building) return
  building = build().catch(() => {}).finally(() => { building = null })
}

/** The header value for the next request (null until first built; refreshed in the background every 2 minutes). */
export function deviceContextHeader(): string | null {
  if (Date.now() - builtAt > MAX_AGE_MS) refresh()
  return header
}

// Built at start and whenever the app comes back to the front (the network or place may have changed).
refresh()
AppState.addEventListener('change', (s) => { if (s === 'active') refresh() })
Network.addNetworkStateListener(() => {
  builtAt = 0
  refresh()
})
