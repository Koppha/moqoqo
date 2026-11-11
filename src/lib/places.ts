import * as Location from 'expo-location'
import { useEffect, useState } from 'react'
import { Linking, Platform } from 'react-native'
import type { Place, PlaceKind } from '../../shared/api'
import type { IconName } from '../components/ui'
import { api } from './api'

// Econet shops, agents, merchants and ATMs near the person (Find us: list, map and camera). Places come from the portal.

export const PLACE_LOOK: Record<PlaceKind, { icon: IconName; color: string }> = {
  shop: { icon: 'business', color: '#2E3A8C' },
  agent: { icon: 'person', color: '#5B2C9F' },
  merchant: { icon: 'storefront', color: '#16A34A' },
  atm: { icon: 'cash', color: '#0EA5E9' },
}

/** The places the portal shows (null while loading; [] when it can't be reached). */
export function usePlaces(): Place[] | null {
  const [places, setPlaces] = useState<Place[] | null>(null)
  useEffect(() => {
    let alive = true
    api<Place[]>('/v1/places').then((p) => alive && setPlaces(p), () => alive && setPlaces([]))
    return () => { alive = false }
  }, [])
  return places
}

export type Here = { lat: number; lng: number }

/** Where the phone is, kept up to date while the screen is open (asks for location once). */
export function useHere(): { here: Here | null; status: 'asking' | 'on' | 'denied' } {
  const [here, setHere] = useState<Here | null>(null)
  const [status, setStatus] = useState<'asking' | 'on' | 'denied'>('asking')
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null
    let alive = true
    ;(async () => {
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => null)
      if (!alive) return
      if (!perm?.granted) return setStatus('denied')
      setStatus('on')
      const last = await Location.getLastKnownPositionAsync().catch(() => null)
      if (alive && last) setHere({ lat: last.coords.latitude, lng: last.coords.longitude })
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 }, (l) => {
        if (alive) setHere({ lat: l.coords.latitude, lng: l.coords.longitude })
      })
      if (!alive) sub.remove()
    })().catch(() => alive && setStatus('denied'))
    return () => {
      alive = false
      sub?.remove()
    }
  }, [])
  return { here, status }
}

/** "350 m", "1.2 km", "14 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

/** Opens the phone's maps app with directions to the place. */
export async function openDirections(p: Place) {
  const native = Platform.OS === 'ios'
    ? `maps:?daddr=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}`
    : `geo:0,0?q=${p.lat},${p.lng}(${encodeURIComponent(p.name)})`
  const web = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
  try {
    await Linking.openURL(native)
  } catch {
    await Linking.openURL(web)
  }
}
