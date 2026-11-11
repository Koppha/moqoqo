import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { distanceMetres, PLACE_KINDS, type Place, type PlaceKind } from '../../shared/api'
import { PlacesAR } from '../components/PlacesAR'
import { PlacesMap } from '../components/PlacesMap'
import { Sheet } from '../components/Sheet'
import { Avatar, Button, Card, CircleIconButton, Header, Icon, ListRow, Screen, type IconName } from '../components/ui'
import { useT } from '../i18n'
import { formatDistance, openDirections, PLACE_LOOK, useHere, usePlaces } from '../lib/places'
import { colors, radius } from '../theme'

type View3 = 'list' | 'map' | 'camera'
const VIEWS: { key: View3; icon: IconName }[] = [
  { key: 'list', icon: 'list' },
  { key: 'map', icon: 'map' },
  { key: 'camera', icon: 'camera' },
]

/**
 * Find agents, merchants and ATMs (the portal keeps the list): nearest first, on a map, or floating over the camera.
 * `?kind=atm` opens on one kind (e.g. from the ATM screen).
 */
export default function Places() {
  const t = useT()
  const params = useLocalSearchParams<{ kind?: PlaceKind }>()
  const places = usePlaces()
  const { here, status } = useHere()
  const [view, setView] = useState<View3>('list')
  const [kind, setKind] = useState<PlaceKind | 'all'>(params.kind && PLACE_KINDS.includes(params.kind) ? params.kind : 'all')
  const [open, setOpen] = useState<Place | null>(null)

  const shown = (places ?? [])
    .filter((p) => kind === 'all' || p.kind === kind)
    .map((p) => ({ p, d: here ? distanceMetres(here, p) : null }))
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || a.p.name.localeCompare(b.p.name))

  const tabs = (
    <View style={[s.tabs, view === 'camera' && { flex: 1 }]}>
      {VIEWS.map((v) => (
        <Pressable key={v.key} accessibilityRole="tab" accessibilityState={{ selected: view === v.key }} onPress={() => setView(v.key)}
          style={[s.tab, view === v.key && s.tabOn]}>
          <Icon name={v.icon} size={16} color={view === v.key ? '#fff' : colors.text} />
          <Text style={[s.tabText, view === v.key && { color: '#fff' }]}>{t.places.views[v.key]}</Text>
        </Pressable>
      ))}
    </View>
  )
  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.chips}>
      {(['all', ...PLACE_KINDS] as const).map((k) => (
        <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: kind === k }} onPress={() => setKind(k)} style={[s.chip, kind === k && s.chipOn]}>
          <Text style={[s.chipText, kind === k && { color: '#fff' }]}>{t.places.kinds[k]}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
  const details = <PlaceSheet place={open} distance={open && here ? distanceMetres(here, open) : null} onClose={() => setOpen(null)} />

  // The camera fills the screen; the back button and the view switch float over it.
  if (view === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <PlacesAR places={shown.map((x) => x.p)} here={here} onOpen={setOpen} />
        <SafeAreaView style={s.overlay} edges={['top']} pointerEvents="box-none">
          <View style={s.overlayRow}>
            <CircleIconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
            {tabs}
          </View>
          {chips}
        </SafeAreaView>
        {details}
      </View>
    )
  }

  return (
    <Screen scroll={view === 'list'}>
      <Header title={t.places.title} />
      {tabs}
      {chips}
      {status === 'denied' && <Text style={s.hint}>{t.places.noLocation}</Text>}
      {!places ? <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        : view === 'map' ? (
          <View style={{ flex: 1, marginTop: 12, marginBottom: 12 }}>
            <PlacesMap places={shown.map((x) => x.p)} here={here} onOpen={setOpen} />
          </View>
        ) : shown.length === 0 ? <Text style={s.hint}>{t.places.none}</Text> : (
          <Card style={{ paddingVertical: 4, marginTop: 12 }}>
            {shown.map(({ p, d }, i) => (
              <ListRow key={p.id} last={i === shown.length - 1} onPress={() => setOpen(p)}
                left={<Avatar name={p.name} icon={PLACE_LOOK[p.kind].icon} color={PLACE_LOOK[p.kind].color} size={42} />}
                title={p.name} subtitle={p.address}
                right={d !== null ? <Text style={s.dist}>{formatDistance(d)}</Text> : <Icon name="chevron-forward" size={18} color={colors.muted} />} />
            ))}
          </Card>
        )}
      {details}
    </Screen>
  )
}

/** One place: what it is, where, when it's open; directions, call, and its EcoCash code to cash out or pay. */
function PlaceSheet({ place: p, distance, onClose }: { place: Place | null; distance: number | null; onClose: () => void }) {
  const t = useT()
  return (
    <Sheet visible={!!p} title={p?.name} onClose={onClose}>
      {p && (
        <>
          <Text style={s.kind}>{t.places.kinds[p.kind]}{distance !== null ? ` · ${formatDistance(distance)}` : ''}</Text>
          <Line icon="location-outline" text={p.address} />
          {p.hours && <Line icon="time-outline" text={p.hours} />}
          {p.code && <Line icon="keypad-outline" text={t.places.code(p.code)} />}
          <View style={s.actions}>
            <Button label={t.places.directions} icon="navigate" onPress={() => openDirections(p)} style={{ flex: 1, marginTop: 0 }} />
            {p.phone && <Button label={t.places.call} icon="call" variant="ghost" onPress={() => Linking.openURL(`tel:${p.phone}`)} style={{ flex: 1, marginTop: 0 }} />}
          </View>
          {p.kind === 'agent' && p.code && (
            <Button label={t.places.cashOut} icon="cash-outline" variant="ghost" onPress={() => { onClose(); router.push('/cashout') }} />
          )}
          {p.kind === 'merchant' && p.code && (
            <Button label={t.places.pay} icon="storefront" variant="ghost" onPress={() => { onClose(); router.push('/pay') }} />
          )}
        </>
      )}
    </Sheet>
  )
}

function Line({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={s.line}>
      <Icon name={icon} size={18} color={colors.muted} />
      <Text style={s.lineText}>{text}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radius.sm },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.text },
  chips: { gap: 8, paddingVertical: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  hint: { color: colors.muted, textAlign: 'center', marginTop: 16, lineHeight: 20 },
  dist: { fontSize: 13, fontWeight: '700', color: colors.primary },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  overlayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  kind: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  lineText: { flex: 1, fontSize: 15, color: colors.text, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
})
