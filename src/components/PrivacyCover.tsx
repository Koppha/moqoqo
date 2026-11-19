import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import { AppState, Modal, StyleSheet, Text, View } from 'react-native'
import { useT } from '../i18n'
import { INSECURE_RELEASE } from '../lib/server'
import { colors, gradients } from '../theme'
import { Icon } from './ui'

/**
 * Covers the app with a plain branded screen while it isn't in front, so the recent-apps preview shows no balance,
 * payments or chats (DFS guidelines 3.2.6b). iPhone takes the preview from this; Android takes it as the app leaves,
 * so the cover is a best effort there.
 */
export function PrivacyCover() {
  const [hidden, setHidden] = useState(AppState.currentState !== 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setHidden(s !== 'active'))
    return () => sub.remove()
  }, [])
  if (!hidden) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={gradients.hero} style={[StyleSheet.absoluteFill, s.center]}>
        <Icon name="shield-checkmark" size={56} color="#fff" />
      </LinearGradient>
    </View>
  )
}

/** A release build pointed at plain http stops here instead of sending anything (DFS guidelines 3.2.4a, 3.2.6g). */
export function InsecureReleaseGate() {
  const t = useT()
  if (!INSECURE_RELEASE) return null
  return (
    <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[s.center, { flex: 1, backgroundColor: colors.bg, padding: 24 }]}>
        <Icon name="lock-closed" size={48} color={colors.danger} />
        <Text style={s.title}>{t.privacy.insecureTitle}</Text>
        <Text style={s.body}>{t.privacy.insecureBody}</Text>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 16, textAlign: 'center' },
  body: { fontSize: 15, color: colors.muted, marginTop: 8, textAlign: 'center' },
})
