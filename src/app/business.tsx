import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { LinkedBusiness } from '../../shared/api'
import { Sheet } from '../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen, SectionTitle } from '../components/ui'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { useAuth } from '../state/Auth'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const PURPLE = '#5B2C9F'
/** +26663550042 → +266 6355 0042 */
const formatMsisdn = (m: string) => m.replace(/^\+266(\d{4})(\d{4})$/, '+266 $1 $2')

/**
 * EcoCash Business as a mini app: the agent and merchant accounts this person runs. Each is linked once with its own
 * number and PIN; tapping one opens the business screens here, without signing in again (Me › Back to EcoCash Super App).
 */
export default function Business() {
  const t = useT()
  const moqoqo = useMoqoqo()
  const { openBusiness } = useAuth()
  const [list, setList] = useState<LinkedBusiness[] | null>(null)
  const [linking, setLinking] = useState(false)
  const [number, setNumber] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // The server says exactly what to fix ("Wrong PIN. 2 tries left", "is a personal wallet").
  const fail = (e: unknown) => (e instanceof ApiFailure && e.code !== 'UNKNOWN' && e.code !== 'NETWORK' ? moqoqo.toast(e.message) : moqoqo.fail(e))

  const load = useCallback(() => {
    api<LinkedBusiness[]>('/v1/businesses').then(setList).catch(() => setList([]))
  }, [])
  useFocusEffect(load)

  const link = async () => {
    setBusy('link')
    try {
      const b = await api<LinkedBusiness>('/v1/businesses/link', { body: { msisdn: '+266' + number, pin } })
      setLinking(false)
      setNumber('')
      setPin('')
      moqoqo.toast(t.business.linked(b.name))
      load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const open = async (b: LinkedBusiness) => {
    setBusy(b.id)
    const r = await openBusiness(b.id)
    // On success the app switches to the business screens by itself.
    if (!r.ok) {
      setBusy(null)
      moqoqo.toast(r.message ?? t.errors.UNKNOWN)
    }
  }

  const unlink = (b: LinkedBusiness) =>
    Alert.alert(t.business.unlinkTitle(b.name), t.business.unlinkBody, [
      { text: t.business.cancel, style: 'cancel' },
      {
        text: t.business.unlink,
        style: 'destructive',
        onPress: () => api(`/v1/businesses/${b.id}`, { method: 'DELETE' }).then(load, fail),
      },
    ])

  return (
    <Screen>
      <Header title={t.business.title} />
      <Text style={s.intro}>{t.business.intro}</Text>
      <SectionTitle title={t.business.mine} />
      {!list ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} /> : (
        <Card style={{ paddingVertical: 4 }}>
          {list.length === 0 && <Text style={s.none}>{t.business.none}</Text>}
          {list.map((b, i) => (
            <ListRow key={b.id} last={i === list.length - 1} onPress={() => open(b)}
              left={<Avatar name={b.name} icon={b.role === 'agent' ? 'cash' : 'storefront'} color={PURPLE} size={42} />}
              title={b.name} subtitle={`${b.code ? (b.role === 'agent' ? t.business.agent(b.code) : t.business.merchant(b.code)) : ''} · ${formatMsisdn(b.msisdn)}`}
              right={busy === b.id ? <ActivityIndicator color={colors.primary} /> : (
                <View style={s.rowEnd}>
                  <Pressable accessibilityRole="button" accessibilityLabel={t.business.unlink} hitSlop={10} onPress={() => unlink(b)}>
                    <Icon name="trash-outline" size={18} color={colors.muted} />
                  </Pressable>
                  <Icon name="chevron-forward" size={18} color={colors.muted} />
                </View>
              )} />
          ))}
        </Card>
      )}
      <Button label={t.business.link} icon="link" variant="ghost" onPress={() => setLinking(true)} style={{ marginTop: 14 }} />
      <Text style={s.hint}>{t.business.noBusiness}</Text>

      <Sheet typing visible={linking} title={t.business.linkTitle} onClose={() => setLinking(false)}>
        <Text style={s.sheetHint}>{t.business.linkHint}</Text>
        <Text style={s.label}>{t.business.number}</Text>
        <View style={s.numberRow}>
          <Text style={s.prefix}>+266</Text>
          <TextInput style={s.numberInput} value={number} onChangeText={(v) => setNumber(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad"
            placeholder="63550042" placeholderTextColor={colors.muted} accessibilityLabel={t.business.number} />
        </View>
        <Text style={s.label}>{t.business.pinLabel}</Text>
        <TextInput style={s.input} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry
          placeholder="••••" placeholderTextColor={colors.muted} accessibilityLabel={t.business.pinLabel} />
        <Button label={t.business.linkGo} disabled={busy === 'link' || number.length !== 8 || pin.length !== 4} onPress={link} style={{ marginTop: 18 }} />
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  intro: { fontSize: 14.5, color: colors.muted, lineHeight: 21, marginBottom: 4 },
  none: { color: colors.muted, padding: 16 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 14, textAlign: 'center' },
  sheetHint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 6 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 14, marginBottom: 8 },
  numberRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14 },
  prefix: { fontSize: 17, fontWeight: '700', color: colors.text, marginRight: 10 },
  numberInput: { flex: 1, paddingVertical: 14, fontSize: 17, color: colors.text, letterSpacing: 1 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 17, color: colors.text, letterSpacing: 4 },
})
