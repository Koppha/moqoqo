import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { Modal, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useT } from '../i18n'
import { enableNotifications, pushPermission, registerIfAllowed } from '../lib/notifications'
import { useAuth } from '../state/Auth'
import { colors } from '../theme'
import { Button, Icon } from './ui'

const KEY_ASKED = 'moqoqo.pushAsked'

/**
 * After signing in (and after the fingerprint offer), once per phone: why notifications matter, then the system
 * prompt. Every unlock re-registers the phone's push token when notifications are already allowed, so pushes keep
 * reaching the wallet now signed in.
 */
export function PushPrompt() {
  const t = useT()
  const { status, offerBiometrics, session } = useAuth()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const userId = session?.user.id

  useEffect(() => {
    if (Platform.OS === 'web' || status !== 'unlocked' || offerBiometrics || !userId) return
    let live = true
    ;(async () => {
      const permission = await pushPermission()
      if (permission === 'on') return registerIfAllowed()
      if (permission === 'blocked') return
      const asked = await SecureStore.getItemAsync(KEY_ASKED)
      if (!asked && live) setShow(true)
    })().catch(() => {})
    return () => {
      live = false
    }
  }, [status, offerBiometrics, userId])

  const done = async (turnOn: boolean) => {
    setBusy(true)
    await SecureStore.setItemAsync(KEY_ASKED, '1').catch(() => {})
    if (turnOn) await enableNotifications().catch(() => false)
    setBusy(false)
    setShow(false)
  }

  return (
    <Modal visible={show} animationType="fade" onRequestClose={() => done(false)} statusBarTranslucent>
      <SafeAreaView style={s.screen}>
        <View style={s.badge}><Icon name="notifications" size={30} color="#fff" /></View>
        <Text style={s.title}>{t.notifications.promptTitle}</Text>
        <Text style={s.body}>{t.notifications.promptBody}</Text>
        <View style={s.actions}>
          <Button label={t.notifications.promptOn} icon="notifications" disabled={busy} onPress={() => done(true)} />
          <Button label={t.notifications.promptLater} variant="ghost" disabled={busy} onPress={() => done(false)} />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  badge: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { marginTop: 10, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', maxWidth: 340 },
  actions: { marginTop: 30, width: '100%', maxWidth: 420, gap: 10 },
})
