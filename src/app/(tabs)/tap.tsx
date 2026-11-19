import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Animated, AppState, Easing, Linking, StyleSheet, Text, View } from 'react-native'
import { armTap, disarmTap, nfcEnabled, onTapRead, tapSupported } from '../../../modules/ecocash-hce'
import { NO_PIN_TAP_LIMIT, PAYCODE_REFRESH_SECONDS, type PayCode } from '../../../shared/api'
import { Button, Card, Icon, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { fmt } from '../../lib/format'
import { useAppState } from '../../state/AppState'
import { useAuth } from '../../state/Auth'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors } from '../../theme'

function Pulse({ delay }: { delay: number }) {
  const [v] = useState(() => new Animated.Value(0))
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [v, delay])
  return (
    <Animated.View
      style={[p.ring, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.5] }) }] }]}
    />
  )
}

/**
 * Tap to pay (Android): while this screen is open (and the app unlocked), the phone holds a one-time pay code and
 * hands it to the merchant's NFC reader (a Famoco terminal or a merchant's phone) when held to it. The merchant's
 * app charges it like a scanned payment code: single use, short-lived, the customer's PIN on the merchant's device
 * above NO_PIN_TAP_LIMIT. Needs Quick Pay (the payment code agreement) and the PIN once per app session, like the
 * payment QR on the Money screen. Phones that can't (iPhone, no NFC) are sent to the QR instead.
 */
export default function Tap() {
  const t = useT()
  const { state } = useAppState()
  const { status, payCodeVerified, verifyPayCode } = useAuth()
  const { askPin } = useDialogs()
  const { fail } = useMoqoqo()
  const me = state.me
  const supported = tapSupported()
  const [nfcOn, setNfcOn] = useState(() => nfcEnabled())
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(AppState.currentState === 'active')
  const [code, setCode] = useState<PayCode | null>(null)
  const [error, setError] = useState(false)
  const [reading, setReading] = useState(false)
  const [nonce, setNonce] = useState(0)

  // The merchant charged my code: intent.updated reaches the payer too.
  const [before] = useState(() => new Set(Object.keys(state.intents)))
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const paid = Object.values(state.intents).find((i) =>
    !before.has(i.id) && !dismissed.has(i.id) && i.method === 'paycode' && i.status === 'paid' && i.paidBy?.id === me?.id) ?? null
  useEffect(() => {
    if (paid) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }, [paid?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- once per payment

  useFocusEffect(useCallback(() => {
    setFocused(true)
    setNfcOn(nfcEnabled())
    return () => setFocused(false)
  }, []))
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setActive(s === 'active')
      if (s === 'active') setNfcOn(nfcEnabled())
    })
    return () => sub.remove()
  }, [])

  const ready = supported && nfcOn && !!me?.quickPay && payCodeVerified && status === 'unlocked'
  const armed = ready && focused && active

  // Hold a fresh code while armed; hand nothing over otherwise (another tab, the app in the background, locked).
  useEffect(() => {
    if (!armed) {
      disarmTap()
      return
    }
    let alive = true
    const fetchCode = () => api<PayCode>('/v1/paycode', { method: 'POST' }).then(
      (c) => {
        if (!alive) return
        armTap(c.code, c.expiresAt)
        setCode(c)
        setError(false)
      },
      () => { if (alive) setError(true) },
    )
    fetchCode()
    const timer = setInterval(fetchCode, PAYCODE_REFRESH_SECONDS * 1000)
    return () => {
      alive = false
      clearInterval(timer)
      disarmTap()
    }
    // A new code after each payment (the last one is spent).
  }, [armed, nonce, paid?.id])

  useEffect(() => onTapRead(() => {
    setReading(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }), [])


  // A read that didn't end in a payment (declined, PIN cancelled) stops saying "Paying…" after a while.
  useEffect(() => {
    if (!reading) return
    const timer = setTimeout(() => setReading(false), 20_000)
    return () => clearTimeout(timer)
  }, [reading])

  // Only a code fetched while armed counts (one from before a lock or another tab is never shown as ready).
  const shown = armed ? code : null

  const unlock = () => askPin({ label: t.money.showPin }).then((pin) => {
    if (pin) api('/v1/auth/verify-pin', { body: { pin } }).then(verifyPayCode, fail)
  })

  const fallback = (
    <>
      <Button label={t.money.show} icon="qr-code-outline" variant="ghost" onPress={() => router.push('/money')} style={p.full} />
      <Button label={t.pay.scanTitle} icon="scan-outline" variant="ghost" onPress={() => router.push('/pay')} style={p.full} />
    </>
  )

  let body: React.ReactNode
  if (paid) {
    body = (
      <>
        <View style={p.ok}><Icon name="checkmark" size={56} color="#fff" /></View>
        <Text style={p.paid}>{t.tap.paid(fmt(paid.amount))}</Text>
        <Text style={p.muted}>{paid.merchant.businessName ?? paid.merchant.name}</Text>
        <Button label={t.tap.viewReceipt} variant="ghost" onPress={() => router.push('/transactions')} style={p.full} />
        <Button label={t.tap.done} onPress={() => { setDismissed((d) => new Set(d).add(paid.id)); setReading(false) }} style={p.full} />
      </>
    )
  } else if (!supported) {
    body = (
      <>
        <View style={[p.core, p.coreOff]}><Icon name="phone-portrait-outline" size={44} color={colors.muted} /></View>
        <Text style={p.lead}>{t.tap.unsupported}</Text>
        {fallback}
      </>
    )
  } else if (!nfcOn) {
    body = (
      <>
        <View style={[p.core, p.coreOff]}><View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="wifi" size={44} color={colors.muted} /></View></View>
        <Text style={p.lead}>{t.tap.nfcOff}</Text>
        <Button label={t.tap.openNfc} icon="settings-outline" onPress={() => Linking.sendIntent('android.settings.NFC_SETTINGS').catch(() => Linking.openSettings())} style={p.full} />
        {fallback}
      </>
    )
  } else if (!me?.quickPay) {
    body = (
      <>
        <View style={[p.core, p.coreOff]}><Icon name="flash-outline" size={44} color={colors.muted} /></View>
        <Text style={p.lead}>{t.tap.setUp}</Text>
        <Button label={t.tap.setUpButton} onPress={() => router.push('/money')} style={p.full} />
      </>
    )
  } else if (!payCodeVerified) {
    body = (
      <>
        <View style={[p.core, p.coreOff]}><Icon name="lock-closed-outline" size={44} color={colors.muted} /></View>
        <Text style={p.lead}>{t.tap.unlock}</Text>
        <Button label={t.tap.unlockButton} icon="keypad-outline" onPress={unlock} style={p.full} />
      </>
    )
  } else {
    body = (
      <>
        <View style={p.stage}>
          {shown && <Pulse delay={0} />}
          {shown && <Pulse delay={1000} />}
          <View style={p.core}>
            {shown ? <View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="wifi" size={44} color="#fff" /></View> : <ActivityIndicator color="#fff" />}
          </View>
        </View>
        {error && !shown ? (
          <>
            <Text style={p.lead}>{t.money.loadFailed}</Text>
            <Button label={t.money.retry} icon="refresh" onPress={() => setNonce((n) => n + 1)} style={p.full} />
          </>
        ) : (
          <>
            <Text style={p.hold} accessibilityLiveRegion="polite">{reading ? t.tap.paying : t.tap.hold}</Text>
            <Text style={p.muted}>{t.common.balance(fmt(state.balance))}</Text>
            <Text style={[p.muted, { textAlign: 'center', marginTop: 10 }]}>{t.tap.pinNote(NO_PIN_TAP_LIMIT)}</Text>
          </>
        )}
        {fallback}
      </>
    )
  }

  return (
    <Screen>
      <Text style={p.title}>{t.tap.title}</Text>
      <Card style={p.card}>{body}</Card>
    </Screen>
  )
}

const p = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 16 },
  card: { alignItems: 'center', paddingVertical: 28 },
  stage: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 3, borderColor: colors.primary },
  core: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  coreOff: { backgroundColor: colors.surface2, marginBottom: 16 },
  hold: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  lead: { fontSize: 15, color: colors.text, textAlign: 'center', marginBottom: 8, paddingHorizontal: 8 },
  muted: { color: colors.muted, fontSize: 13.5, marginTop: 4 },
  full: { alignSelf: 'stretch', marginTop: 10 },
  ok: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  paid: { fontSize: 28, fontWeight: '800', color: colors.text },
})
