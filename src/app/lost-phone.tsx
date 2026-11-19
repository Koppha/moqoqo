import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { ReportLostBody } from '../../shared/api'
import { Button, Card, Header, Icon, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { colors, radius } from '../theme'

/**
 * Login › Lost your phone? (CBL/LCA DFS guidelines 3.2.8d): the EcoCash number and wallet PIN sign the wallet out of
 * every phone at once. Setting up again needs a phone with the wallet's SIM, the ID check and an SMS code.
 */
export default function LostPhone() {
  const t = useT()
  const [number, setNumber] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const valid = /^[56]\d{7}$/.test(number) && /^\d{4}$/.test(pin)

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const body: ReportLostBody = { msisdn: number, pin }
      await api('/v1/auth/report-lost', { body })
      setDone(true)
    } catch (e) {
      setError(t.errors[e instanceof ApiFailure ? e.code : 'UNKNOWN'])
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Header title={t.lost.title} />
      <View style={s.body}>
        {done ? (
          <Card style={s.done}>
            <View style={s.badge}><Icon name="checkmark" size={40} color="#fff" /></View>
            <Text style={s.doneTitle} accessibilityLiveRegion="polite">{t.lost.done}</Text>
            <Text style={s.muted}>{t.lost.doneSub}</Text>
            <Button label={t.lost.back} onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: 16 }} />
          </Card>
        ) : (
          <>
            <Text style={s.intro}>{t.lost.intro}</Text>
            <Text style={s.label}>{t.lost.number}</Text>
            <TextInput style={s.input} value={number} onChangeText={(v) => setNumber(v.replace(/\D/g, '').replace(/^266/, '').slice(0, 8))}
              keyboardType="number-pad" placeholder="62 000 000" placeholderTextColor={colors.muted} accessibilityLabel={t.lost.number} autoFocus />
            <Text style={s.label}>{t.lost.pin}</Text>
            <TextInput style={s.input} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad"
              secureTextEntry placeholder="••••" placeholderTextColor={colors.muted} accessibilityLabel={t.lost.pin} onSubmitEditing={submit} />
            {error && <Text style={s.error} accessibilityLiveRegion="assertive">{error}</Text>}
            <Button label={t.lost.submit} variant="dark" disabled={!valid || busy} onPress={submit} style={{ marginTop: 20 }} />
          </>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 16, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  intro: { fontSize: 14.5, color: colors.text, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, height: 54, paddingHorizontal: 14, fontSize: 18, fontWeight: '600', color: colors.text },
  error: { color: colors.danger, marginTop: 12, fontSize: 13.5 },
  done: { alignItems: 'center', paddingVertical: 24 },
  badge: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  doneTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  muted: { fontSize: 13.5, color: colors.muted, textAlign: 'center', marginTop: 8 },
})
