import * as Location from 'expo-location'
import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import type { BusinessListingBody, BusinessProfile } from '../../shared/api'
import { Button, Card, Header, Icon, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { dayLabel } from '../lib/mappers'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

/**
 * Business profile (agents and merchants): the account as EcoCash registered it (read-only: name, code and owner
 * change only at an EcoCash shop), and the business's listing on the map, which it keeps current itself.
 */
export default function BusinessProfileScreen() {
  const t = useT()
  const p = t.bizProfile
  const { fail, toast } = useMoqoqo()
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [address, setAddress] = useState('')
  const [hours, setHours] = useState('')
  const [phone, setPhone] = useState('')
  const [listed, setListed] = useState(true)
  const [spot, setSpot] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)

  const show = (x: BusinessProfile) => {
    setProfile(x)
    setAddress(x.listing?.address ?? '')
    setHours(x.listing?.hours ?? '')
    setPhone(x.listing?.phone ?? '')
    setListed(x.listing?.enabled ?? true)
    setSpot(null)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  useEffect(() => { api<BusinessProfile>('/v1/business/profile').then(show).catch(fail) }, [])

  const locate = async () => {
    setLocating(true)
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') return toast(p.locationDenied)
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setSpot({ lat: here.coords.latitude, lng: here.coords.longitude })
    } catch {
      toast(p.locationDenied)
    } finally {
      setLocating(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const body: BusinessListingBody = { address, hours: hours || undefined, phone: phone || undefined, listed, ...spot }
      show(await api<BusinessProfile>('/v1/business/profile', { method: 'PUT', body }))
      toast(p.saved)
    } catch (e) {
      // Say what to fix (e.g. a location outside Lesotho), not just "check the details".
      if (e instanceof ApiFailure && e.code === 'VALIDATION') toast(e.message)
      else fail(e)
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return <Screen><Header title={p.title} /><ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /></Screen>
  const needsSpot = !profile.listing && !spot
  const rows: [string, string][] = [
    [p.name, profile.name],
    [p.holder, profile.holder],
    [p.code, profile.code ?? '—'],
    [p.number, profile.msisdn],
    [p.tier, profile.kycTier === 2 ? p.tierFull : p.tierBasic],
    [p.status, profile.status === 'active' ? p.active : p.suspended],
    [p.opened, dayLabel(profile.openedAt, t.common.weekdays)],
  ]

  return (
    <Screen>
      <Header title={p.title} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.section}>{p.account}</Text>
          <Card style={{ paddingVertical: 4 }}>
            {rows.map(([k, v], i) => (
              <View key={k} style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
                <Text style={s.key}>{k}</Text>
                <Text style={[s.value, k === p.status && profile.status !== 'active' && { color: colors.danger }]}>{v}</Text>
              </View>
            ))}
          </Card>
          {profile.linkedPeople > 0 && <Text style={s.note}>{p.linked(profile.linkedPeople)}</Text>}
          <Text style={s.note}>{p.staffOnly}</Text>

          <Text style={s.section}>{p.listing}</Text>
          <Text style={s.intro}>{profile.listing ? p.listingIntro : p.notListed}</Text>
          <Card style={s.form}>
            <Text style={s.label}>{p.address}</Text>
            <TextInput style={s.input} value={address} onChangeText={setAddress} placeholder={p.addressHint} placeholderTextColor={colors.muted} accessibilityLabel={p.address} maxLength={120} />
            <Text style={s.label}>{p.hours}</Text>
            <TextInput style={s.input} value={hours} onChangeText={setHours} placeholder={p.hoursHint} placeholderTextColor={colors.muted} accessibilityLabel={p.hours} maxLength={80} />
            <Text style={s.label}>{p.phone}</Text>
            <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="62 000 000" placeholderTextColor={colors.muted} accessibilityLabel={p.phone} maxLength={16} />

            <Text style={s.label}>{p.location}</Text>
            <View style={s.locRow}>
              <Icon name={spot || profile.listing ? 'location' : 'location-outline'} size={20} color={spot || profile.listing ? colors.success : colors.muted} />
              <Text style={s.locText}>{spot ? p.locationNew : profile.listing ? p.locationSet : p.locationNone}</Text>
            </View>
            <Button variant="ghost" icon="navigate-outline" label={locating ? p.locating : p.useHere} onPress={locate} disabled={locating} />
            <Text style={s.hint}>{p.locationHint}</Text>

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>{p.show}</Text>
              <Switch value={listed} onValueChange={setListed} accessibilityLabel={p.show} />
            </View>
          </Card>
          <Button label={busy ? p.saving : p.save} onPress={save} disabled={busy || address.trim().length < 5 || needsSpot} style={{ marginTop: 16 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  key: { fontSize: 14, color: colors.muted },
  value: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'right' },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
  intro: { fontSize: 13.5, color: colors.muted, marginBottom: 10 },
  form: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 8 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, height: 50, paddingHorizontal: 14, fontSize: 16, color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  locText: { flex: 1, fontSize: 14, color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
})
