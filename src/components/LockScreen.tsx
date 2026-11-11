import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { maskMsisdn } from '../lib/format'
import { useSplashLeaving } from '../lib/splash'
import { FORM_MAX } from '../lib/layout'
import { useAuth } from '../state/Auth'
import { colors } from '../theme'
import { PinEntry } from './PinEntry'
import { useDarkStatusBarWhileMounted } from './useLightStatusBar'
import { Sheet } from './Sheet'
import { Avatar, Button, Icon } from './ui'

/** Covers the app while locked; the screens underneath stay mounted. */
export function LockScreen() {
  const { status, session } = useAuth()
  // On launch, after the splash starts to leave: it fades in over the splash.
  const splashLeaving = useSplashLeaving()
  if (!session) return null
  const locked = status === 'locked' && splashLeaving
  return (
    <Modal visible={locked} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      {/* Mounted per lock, so the error resets and biometrics are offered each time. */}
      {locked && <LockBody name={session.user.businessName ?? session.user.name} msisdn={session.user.msisdn} />}
    </Modal>
  )
}

function LockBody({ name, msisdn }: { name: string; msisdn: string }) {
  const t = useT()
  const { biometrics, unlockWithPin, unlockWithBiometrics, signOut } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const kind = t.auth.bioName(biometrics.face)
  useDarkStatusBarWhileMounted()

  // Offer biometrics straight away when the lock appears.
  useEffect(() => {
    if (biometrics.enabled) unlockWithBiometrics()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per lock
  }, [])

  const submit = async (pin: string) => {
    const res = await unlockWithPin(pin)
    setError(res.ok ? null : t.errors[res.code])
    return res.ok
  }

  return (
    <SafeAreaView style={k.frame}>
      <View style={k.column}>
      <View style={k.top}>
        <Avatar name={name} size={64} color={colors.primary} />
        <Text style={k.hello}>{t.auth.welcomeBack(name.split(' ')[0])}</Text>
        <Text style={k.number}>{maskMsisdn(msisdn)}</Text>
        <Text style={k.hint}>{t.auth.unlockPin}</Text>
        {error && <Text style={k.error} accessibilityLiveRegion="polite">{error}</Text>}
      </View>
      <PinEntry onComplete={submit} onBiometrics={biometrics.enabled ? () => unlockWithBiometrics() : undefined} />
      {biometrics.enabled && (
        <Pressable accessibilityRole="button" onPress={() => unlockWithBiometrics()} style={k.bio}>
          <Icon name={biometrics.face ? 'scan' : 'finger-print'} size={20} color={colors.primary} />
          <Text style={k.bioText}>{t.auth.unlockWith(kind)}</Text>
        </Pressable>
      )}
      {/* Someone else's phone, or a sign-in the server no longer knows (unlocking can't work then). */}
      <Pressable accessibilityRole="button" onPress={() => signOut()} style={k.notYou}>
        <Text style={k.notYouText}>{t.auth.notYou(name.split(' ')[0])}</Text>
      </Pressable>
      </View>
    </SafeAreaView>
  )
}

/** One-time sheet after the first login on a device with a fingerprint or face sensor. */
export function BiometricOffer() {
  const t = useT()
  const { status, biometrics, offerBiometrics, setBiometricsEnabled, dismissOffer } = useAuth()
  const kind = t.auth.bioName(biometrics.face)
  return (
    <Sheet visible={status === 'unlocked' && offerBiometrics} title={t.auth.offerTitle(kind)} onClose={dismissOffer}>
      <View style={{ alignItems: 'center', marginBottom: 6 }}>
        <View style={k.offerIcon}><Icon name={biometrics.face ? 'scan' : 'finger-print'} size={36} color={colors.primary} /></View>
        <Text style={k.offerBody}>{t.auth.offerBody}</Text>
      </View>
      <Button label={t.auth.turnOn} icon={biometrics.face ? 'scan' : 'finger-print'} onPress={() => setBiometricsEnabled(true)} />
      <Button label={t.auth.notNow} variant="ghost" onPress={dismissOffer} />
    </Sheet>
  )
}

const k = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  top: { alignItems: 'center', paddingHorizontal: 24 },
  hello: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 14 },
  number: { fontSize: 14, color: colors.muted, marginTop: 2 },
  hint: { fontSize: 15, color: colors.text, marginTop: 22 },
  error: { fontSize: 13, color: '#DC2626', marginTop: 6 },
  bio: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  bioText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  notYou: { alignItems: 'center', paddingVertical: 12 },
  notYouText: { color: colors.muted, fontSize: 14, textDecorationLine: 'underline' },
  offerIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  offerBody: { textAlign: 'center', color: colors.muted, fontSize: 14, marginTop: 12, paddingHorizontal: 12 },
})
