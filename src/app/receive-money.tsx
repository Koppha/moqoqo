import * as Haptics from 'expo-haptics'
import { Asset, requestPermissionsAsync } from 'expo-media-library'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import { QrCode } from '../components/QrCode'
import { Avatar, Icon } from '../components/ui'
import { useLightStatusBar } from '../components/useLightStatusBar'
import { useT } from '../i18n'
import { fmt, maskMsisdn } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, gradients, radius } from '../theme'

const ORANGE = gradients.card[0]
/** EcoCash brand blue and red, from the logo. */
const ECOCASH_BLUE = '#233C96'
const POSTER_WIDTH = 360

/** "Kamohelo M." so a saved or shared poster doesn't carry the full name. */
const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/)
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first
}

/**
 * The customer's own "Receive money" QR: anyone with EcoCash Super App scans it and pays, no chat needed.
 * It can only receive, so unlike the payment code it may be screenshotted, shared, and saved as an image.
 */
export default function ReceiveMoney() {
  const t = useT()
  const { state } = useAppState()
  const { askAmount } = useDialogs()
  const { toast } = useMoqoqo()
  const [amount, setAmount] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const poster = useRef<View>(null)
  useLightStatusBar()
  const me = state.me
  if (!me) return null

  const value = `moqoqo://pay?u=${encodeURIComponent(me.id)}${amount ? `&a=${amount}` : ''}`
  const center = <View style={s.avatarFrame}><Avatar name={me.name} size={44} /></View>

  const setAmountFor = async () => {
    const a = await askAmount({ title: t.receiveQr.amountTitle, balance: state.balance, recipient: { name: me.name, subtitle: maskMsisdn(me.msisdn) }, confirmLabel: t.receiveQr.setAmount })
    if (a) setAmount(a)
  }

  const save = async () => {
    setSaving(true)
    try {
      const permission = await requestPermissionsAsync(true, ['photo'])
      if (!permission.granted) return toast(t.receiveQr.photosNeeded)
      const uri = await captureRef(poster, { format: 'png', quality: 1, result: 'tmpfile' })
      await Asset.create(uri)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      toast(t.receiveQr.saved)
    } catch {
      toast(t.receiveQr.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Pressable accessibilityLabel={t.common.back} onPress={() => router.back()} style={s.back}>
          <Icon name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={s.title}>{t.receiveQr.title}</Text>
        <View style={s.back} />
      </View>
      <ScrollView contentContainerStyle={s.column}>
        <View style={s.card}>
          <View style={s.cardHead}>
            <Icon name="wallet-outline" size={22} color={ORANGE} />
            <Text style={s.cardTitle}>{t.receiveQr.title}</Text>
          </View>
          <View style={s.body}>
            <Text style={s.hint}>{t.receiveQr.hint}</Text>
            {amount ? <Text style={s.amount}>{fmt(amount)}</Text> : null}
            <View style={{ marginTop: 16 }}>
              <QrCode value={value} size={240} level="H" label={t.receiveQr.qrLabel} center={center} />
            </View>
            <View style={s.actions}>
              <Pressable accessibilityRole="button" onPress={amount ? () => setAmount(null) : setAmountFor} style={s.action}>
                <Text style={s.actionText}>{amount ? t.receiveQr.clearAmount : t.receiveQr.setAmount}</Text>
              </Pressable>
              <View style={s.divider} />
              <Pressable accessibilityRole="button" disabled={saving} onPress={save} style={s.action}>
                {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={s.actionText}>{t.receiveQr.saveImage}</Text>}
              </Pressable>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.push('/transactions')} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
            <Icon name="receipt-outline" size={24} color={colors.muted} />
            <Text style={s.rowText}>{t.receiveQr.history}</Text>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>
      </ScrollView>

      {/* The image "Save image" writes to the gallery: drawn off-screen, captured, never shown in the app. */}
      <View style={s.offscreen} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View ref={poster} collapsable={false} style={s.poster}>
          <View style={s.posterTop}>
            <Text style={s.posterTitle}>{t.receiveQr.posterTitle}</Text>
            <View style={s.posterQr}>
              <QrCode value={value} size={232} level="H" label={t.receiveQr.qrLabel} center={center} />
            </View>
            <Text style={s.posterName}>{shortName(me.name)} (***{me.msisdn.slice(-2)})</Text>
            {amount ? <Text style={s.posterAmount}>{fmt(amount)}</Text> : null}
          </View>
          <View style={s.posterBottom}>
            <Image source={require('../../assets/ecocash-logo.webp')} style={s.logo} resizeMode="contain" />
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ORANGE },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '700' },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: 8, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, paddingHorizontal: 20, paddingVertical: 18 },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: ORANGE },
  body: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20 },
  hint: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  amount: { fontSize: 30, fontWeight: '800', color: colors.text, marginTop: 10 },
  avatarFrame: { backgroundColor: '#fff', padding: 3, borderRadius: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 24 },
  action: { paddingHorizontal: 20, paddingVertical: 8, minWidth: 120, alignItems: 'center' },
  actionText: { color: colors.primary, fontSize: 16, fontWeight: '500' },
  divider: { width: 1, height: 20, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, borderTopColor: colors.border, marginHorizontal: 20, paddingVertical: 18 },
  rowText: { flex: 1, fontSize: 16, color: colors.text },
  offscreen: { position: 'absolute', left: -10_000, top: 0 },
  poster: { width: POSTER_WIDTH, backgroundColor: '#fff' },
  posterTop: { backgroundColor: ECOCASH_BLUE, alignItems: 'center', paddingTop: 36, paddingBottom: 30 },
  posterTitle: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: 0.3 },
  posterQr: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginTop: 26 },
  posterName: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 22 },
  posterAmount: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 6 },
  posterBottom: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  logo: { width: 210, height: 145 },
})
