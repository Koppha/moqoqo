import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import { AppState, Modal, StyleSheet, Text, View } from 'react-native'
import { deviceBlockReason, type AppConfig, type DeviceIntegrity } from '../../shared/api'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { checkIntegrity } from '../lib/integrity'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { colors, gradients } from '../theme'
import { Button, Icon } from './ui'

/**
 * Full-screen stop when the portal's device security blocks this phone (rooted or jailbroken, or developer mode and
 * USB debugging on). Checked at start and whenever the app comes back to the front, so turning developer options on
 * while the app is open is caught too. Sits above everything, sign-in included; the server refuses these phones too.
 */
export function DeviceGate() {
  const t = useT()
  const { state, dispatch } = useAppState()
  const [integrity, setIntegrity] = useState<DeviceIntegrity | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const read = () => checkIntegrity().then(setIntegrity, () => {})
    read()
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') read() })
    return () => sub.remove()
  }, [])

  const check = async () => {
    setChecking(true)
    try {
      setIntegrity(await checkIntegrity())
      dispatch({ type: 'config', config: await api<AppConfig>('/v1/app-config') })
    } catch {
      // Unreachable server: keep what we know.
    }
    setChecking(false)
  }

  const policy = state.config?.deviceSecurity
  const reason = policy && integrity ? deviceBlockReason(policy, integrity) : null
  return (
    <Modal visible={reason === 'rooted' || reason === 'developer'} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <LinearGradient colors={gradients.hero} style={s.frame}>
        <View style={s.column} accessibilityLiveRegion="polite">
          <View style={s.icon}><Icon name="shield" size={40} color="#fff" /></View>
          <Text style={s.title}>{t.deviceBlock.title}</Text>
          <Text style={s.body}>{reason === 'rooted' ? t.deviceBlock.rooted : t.deviceBlock.developer}</Text>
          <Button label={checking ? t.deviceBlock.checking : t.deviceBlock.checkAgain} variant="dark" disabled={checking} onPress={check} style={{ alignSelf: 'stretch', marginTop: 28 }} />
        </View>
      </LinearGradient>
    </Modal>
  )
}

const s = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'center', padding: 24 },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', alignItems: 'center' },
  icon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { color: colors.heroText, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.heroMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12 },
})
