// Leaflet maps for Places: the overview of every agent, merchant and ATM, and the small picker in the edit dialog.
// Plain Leaflet (no react-leaflet). Markers are divIcons, so Leaflet's default marker images (which break under
// Vite) are never used.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import type { Place, PlaceKind } from '../../../shared/api'

/** Maseru, where most places are. */
export const MASERU = { lat: -29.315, lng: 27.485 }
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/** One letter on a coloured round pin: E Econet shop, A agent, M merchant, ATM. */
const PIN_LETTER: Record<PlaceKind, string> = { shop: 'E', agent: 'A', merchant: 'M', atm: 'ATM' }

const pin = (kind: PlaceKind | 'pick', off = false) =>
  L.divIcon({
    className: `place-pin place-pin-${kind}${off ? ' place-pin-off' : ''}`,
    html: kind === 'pick' ? '' : PIN_LETTER[kind],
    iconSize: kind === 'atm' ? [34, 24] : [26, 26],
    iconAnchor: kind === 'atm' ? [17, 12] : [13, 13],
  })

function baseMap(node: HTMLElement, center: { lat: number; lng: number }, zoom: number): L.Map {
  const map = L.map(node, { center: [center.lat, center.lng], zoom })
  L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map)
  // The container may still be sizing (dialogs, view switches) when the map is made.
  setTimeout(() => map.invalidateSize(), 0)
  return map
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Every place as a pin; clicking one calls onSelect. */
export function PlacesMap({ places, onSelect }: { places: Place[]; onSelect: (p: Place) => void }) {
  const node = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!node.current) return
    map.current = baseMap(node.current, MASERU, 12)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const group = layer.current
    if (!group) return
    group.clearLayers()
    for (const p of places) {
      L.marker([p.lat, p.lng], { icon: pin(p.kind, !p.enabled), title: p.name, keyboard: true })
        .bindTooltip(`${escapeHtml(p.name)}${p.enabled ? '' : ' (off)'}`)
        .on('click', () => onSelectRef.current(p))
        .addTo(group)
    }
  }, [places])

  return <div ref={node} className="place-map" role="region" aria-label="Map of places" />
}

/**
 * The location field in the edit dialog: click the map to drop the pin there, or drag the pin. Typing a latitude and
 * longitude moves the pin (`value` is null while the typed numbers aren't valid).
 */
export function LocationPicker({ value, onPick }: { value: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void }) {
  const node = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const round = (n: number) => Math.round(n * 1e6) / 1e6

  useEffect(() => {
    if (!node.current) return
    const m = baseMap(node.current, value ?? MASERU, value ? 15 : 12)
    const mk = L.marker([(value ?? MASERU).lat, (value ?? MASERU).lng], { icon: pin('pick'), draggable: true, title: 'Location' })
    if (value) mk.addTo(m)
    mk.on('dragend', () => {
      const ll = mk.getLatLng()
      onPickRef.current(round(ll.lat), round(ll.lng))
    })
    m.on('click', (e: L.LeafletMouseEvent) => onPickRef.current(round(e.latlng.lat), round(e.latlng.lng)))
    map.current = m
    marker.current = mk
    return () => {
      m.remove()
      map.current = null
    }
    // Made once; the effect below follows `value`.
  }, [])

  const lat = value?.lat
  const lng = value?.lng
  useEffect(() => {
    const m = map.current
    const mk = marker.current
    if (!m || !mk) return
    if (lat === undefined || lng === undefined) {
      mk.remove()
      return
    }
    mk.setLatLng([lat, lng])
    if (!m.hasLayer(mk)) mk.addTo(m)
    if (!m.getBounds().contains([lat, lng])) m.panTo([lat, lng])
  }, [lat, lng])

  return <div ref={node} className="place-map place-map-sm" role="region" aria-label="Pick the location on the map" />
}
