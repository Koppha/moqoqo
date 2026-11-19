import { Linking, StyleSheet, Text, View } from 'react-native'
import { CONTACT_DEFAULTS, TERMS_VERSION } from '../../shared/api'
import { Button, Card, Header, Screen } from '../components/ui'
import { useT } from '../i18n'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { colors } from '../theme'

/**
 * Legal and safety (CBL/LCA DFS guidelines 3.2.9): terms of use, privacy notice, the customer's responsibilities,
 * staying safe from scams and SIM swaps, and how to report a problem. Open signed in (Me) and signed out (setup).
 * The legal wording is a draft until ETL's legal team provides the final text.
 */
export default function Legal() {
  const t = useT()
  const L = t.legal
  const contact = useAppState().state.config?.contact ?? CONTACT_DEFAULTS
  const section = (title: string, lines: readonly string[]) => (
    <>
      <Text style={s.section}>{title}</Text>
      <Card style={s.card}>
        {lines.map((line) => (
          <View key={line} style={s.item}>
            <Text style={s.bullet}>•</Text>
            <Text style={s.text}>{line}</Text>
          </View>
        ))}
      </Card>
    </>
  )
  return (
    <Screen>
      <Header title={L.title} />
      <View style={s.body}>
        <Text style={s.draft}>{L.draft(TERMS_VERSION)}</Text>
        {section(L.termsTitle, L.terms)}
        {section(L.privacyTitle, L.privacy)}
        {section(L.yoursTitle, L.yours)}
        {section(L.safeTitle, L.safe)}
        <Text style={s.section}>{L.reportTitle}</Text>
        <Card style={s.card}>
          <Text style={s.text}>{L.report}</Text>
          <Button label={`${L.contact} · ${contact.phone}`} icon="call" variant="ghost" onPress={() => Linking.openURL(`tel:${contact.phone}`).catch(() => {})} style={{ marginTop: 12 }} />
          {!!contact.email && <Button label={contact.email} icon="mail" variant="ghost" onPress={() => Linking.openURL(`mailto:${contact.email}`).catch(() => {})} style={{ marginTop: 8 }} />}
        </Card>
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  draft: { fontSize: 12.5, color: colors.muted, marginBottom: 4 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  card: { gap: 10 },
  item: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, color: colors.primary, lineHeight: 21 },
  text: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 21 },
})
