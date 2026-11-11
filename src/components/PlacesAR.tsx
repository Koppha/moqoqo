import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { bearingDegrees, distanceMetres, type Place } from '../../shared/api'
import { useT } from '../i18n'
import { formatDistance, PLACE_LOOK, type Here } from '../lib/places'
import { Button, Icon } from './ui'

/** The camera's horizontal view, roughly, for a phone held upright. */
const FOV = 60
/** Places further than this aren't drawn on the camera. */
const RANGE = 10_000

/**
 * Live camera view: point the phone around and the agents, merchants and ATMs in that direction float over the camera,
 * nearest lowest. Places off to the side show as "turn" hints at the edges. Uses the compass, so it's as good as the
 * phone's compass (it asks to calibrate when the reading is poor).
 */
export function PlacesAR({ places, here, onOpen }: { places: Place[]; here: Here | null; onOpen: (p: Place) => void }) {
  const t = useT()
  const { width, height } = useWindowDimensions()
  const [permission, requestPermission] = useCameraPermissions()
  const [heading, setHeading] = useState<number | null>(null)
  const [poor, setPoor] = useState(false)
  const smooth = useRef<number | null>(null)

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null
    let alive = true
    Location.watchHeadingAsync((h) => {
      const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
      // Smooth the compass (it jitters), going the short way round past north.
      const prev = smooth.current ?? raw
      const next = (prev + (((raw - prev + 540) % 360) - 180) * 0.2 + 360) % 360
      smooth.current = next
      if (alive) {
        setHeading(next)
        setPoor(h.accuracy !== undefined && h.accuracy > 0 && h.accuracy < 2)
      }
    }).then((s) => {
      sub = s
      if (!alive) s.remove()
    }, () => {})
    return () => {
      alive = false
      sub?.remove()
    }
  }, [])

  if (!permission) return <View style={s.fill} />
  if (!permission.granted) {
    return (
      <View style={[s.fill, s.center]}>
        <Icon name="camera-outline" size={40} color="#fff" />
        <Text style={s.note}>{t.places.cameraAsk}</Text>
        <Button label={t.places.cameraAllow} onPress={requestPermission} style={{ alignSelf: 'stretch', marginHorizontal: 32 }} />
      </View>
    )
  }

  const around = here
    ? places.map((p) => ({ p, d: distanceMetres(here, p), b: bearingDegrees(here, p) })).filter((x) => x.d <= RANGE).sort((a, b) => a.d - b.d).slice(0, 15)
    : []
  const rel = (b: number) => (heading === null ? 0 : ((b - heading + 540) % 360) - 180)
  const inView = around.filter((x) => Math.abs(rel(x.b)) <= FOV / 2)
  const left = around.filter((x) => rel(x.b) < -FOV / 2)
  const right = around.filter((x) => rel(x.b) > FOV / 2)

  return (
    <View style={s.fill}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />
      {!here || heading === null ? (
        <View style={[s.fill, s.center]}><Text style={s.note}>{t.places.finding}</Text></View>
      ) : (
        <>
          {inView.map(({ p, d, b }, i) => {
            const look = PLACE_LOOK[p.kind]
            // Across: where it is in the view. Up and down: nearer lower, staggered so close labels don't overlap.
            const x = width / 2 + (rel(b) / (FOV / 2)) * (width / 2)
            const y = height * (0.62 - Math.min(d, RANGE) / RANGE * 0.4) - (i % 3) * 28
            return (
              <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, ${formatDistance(d)}`} onPress={() => onOpen(p)}
                style={[s.label, { left: Math.max(8, Math.min(width - 188, x - 90)), top: y }]}>
                <View style={[s.dot, { backgroundColor: look.color }]}><Icon name={look.icon} size={14} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.labelName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.labelDist}>{formatDistance(d)}</Text>
                </View>
              </Pressable>
            )
          })}
          {left.length > 0 && <Text style={[s.edge, { left: 10 }]}>‹ {t.places.more(left.length)}</Text>}
          {right.length > 0 && <Text style={[s.edge, { right: 10 }]}>{t.places.more(right.length)} ›</Text>}
          {around.length === 0 && <View style={[s.fill, s.center]}><Text style={s.note}>{t.places.noneNear}</Text></View>}
          {poor && <Text style={s.calibrate}>{t.places.calibrate}</Text>}
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: 'transparent' },
  note: { color: '#fff', fontSize: 15, textAlign: 'center', marginHorizontal: 32, textShadowColor: '#000', textShadowRadius: 6 },
  label: { position: 'absolute', width: 180, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.94)' },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  labelName: { fontSize: 13, fontWeight: '700', color: '#14151A' },
  labelDist: { fontSize: 12, color: '#4B5563' },
  edge: { position: 'absolute', top: '50%', color: '#fff', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  calibrate: { position: 'absolute', bottom: 24, left: 24, right: 24, textAlign: 'center', color: '#fff', backgroundColor: 'rgba(0,0,0,0.55)', padding: 10, borderRadius: 12, overflow: 'hidden' },
})
