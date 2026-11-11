import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { QrCode } from '../components/QrCode'
import { Button, Card, Header, Screen } from '../components/ui'
import { api } from '../lib/api'
import { useMoqoqo } from '../state/useMoqoqo'
import { useT } from '../i18n'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { colors } from '../theme'

/** The merchant's fixed QR (no amount): printed at the till; customers scan it and type the amount. */
export default function MyQr() {
  const t = useT()
  const { state } = useAppState()
  const { fail } = useMoqoqo()
  const [printing, setPrinting] = useState<'a4' | 'a6' | null>(null)
  const me = state.me
  if (!me?.code) return null

  /** The branded print-out (same as the portal's), through the phone's print dialog (Wi-Fi printer or Save as PDF). */
  const print = async (size: 'a4' | 'a6') => {
    setPrinting(size)
    try {
      const html = await api<string>(`/v1/me/poster?size=${size}`, { text: true })
      // Loaded only when printing.
      const Print = await import('expo-print')
      await Print.printAsync({ html, width: size === 'a4' ? 595 : 298, height: size === 'a4' ? 842 : 420 })
    } catch (e) {
      fail(e)
    } finally {
      setPrinting(null)
    }
  }
  return (
    <Screen>
      <Header title={t.receive.myQr} />
      <Card style={s.card}>
        <Text style={s.name}>{me.businessName ?? me.name}</Text>
        <Text style={s.code}>{t.receive.merchantCode(me.code)}</Text>
        <QrCode value={`moqoqo://pay?m=${me.code}`} size={260} label={t.receive.myQr} />
        <Text style={s.hint}>{t.receive.myQrHint}</Text>
      </Card>
      <View style={s.print}>
        <Text style={s.printTitle}>{t.receive.printTitle}</Text>
        <Button label={printing === 'a4' ? t.receive.printing : t.receive.printPoster} icon="print-outline" disabled={!!printing} onPress={() => print('a4')} />
        <Button label={printing === 'a6' ? t.receive.printing : t.receive.printSticker} icon="pricetag-outline" variant="ghost" disabled={!!printing} onPress={() => print('a6')} />
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  card: { alignItems: 'center', gap: 12, paddingVertical: 28, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  code: { fontSize: 14, color: colors.muted, marginBottom: 8 },
  print: { gap: 10, marginTop: 18, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  printTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint: { fontSize: 13.5, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 16 },
})
