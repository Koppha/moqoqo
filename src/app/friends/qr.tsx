import * as Linking from 'expo-linking'
import { StyleSheet, Text, View } from 'react-native'
import { QrCode } from '../../components/QrCode'
import { Avatar, Card, Header, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { maskMsisdn } from '../../lib/format'
import { useAppState } from '../../state/AppState'
import { colors } from '../../theme'

/** My personal QR code: friends scan it (in the app, or with the phone's camera) to add me. */
export default function MyFriendQr() {
  const t = useT()
  const me = useAppState().state.me
  if (!me) return null
  const link = Linking.createURL('/add', { queryParams: { u: me.id } })
  return (
    <Screen>
      <Header title={t.friends.qrTitle} />
      <Card style={s.card}>
        <Avatar name={me.name} size={56} />
        <Text style={s.name}>{me.name}</Text>
        <Text style={s.sub}>{me.username ? `@${me.username}` : maskMsisdn(me.msisdn)}</Text>
        <View style={s.qr}><QrCode value={link} size={240} label={t.friends.qrTitle} /></View>
        <Text style={s.hint}>{t.friends.qrHint}</Text>
      </Card>
    </Screen>
  )
}

const s = StyleSheet.create({
  card: { alignItems: 'center', paddingVertical: 24, gap: 4 },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 8 },
  sub: { fontSize: 14, color: colors.muted },
  qr: { padding: 14, backgroundColor: '#fff', borderRadius: 18, marginTop: 18 },
  hint: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, marginTop: 16, paddingHorizontal: 12 },
})
