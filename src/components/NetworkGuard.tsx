import * as Network from 'expo-network'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { wifiSecurity } from '../../modules/device-integrity'
import { useT } from '../i18n'
import { setNetworkNewHandler } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { useAuth } from '../state/Auth'
import { colors, radius } from '../theme'
import { Button, Icon } from './ui'

/**
 * Asks before continuing on a network that may be watched or imitated (CBL/LCA DFS guidelines 3.2.4i): an open Wi-Fi
 * (no password; Android 12+), or a network the server hasn't seen this phone use before (x-network-new). Once per
 * network per app session; "Not now" signs out. Covers the app until the person decides.
 */
export function NetworkGuard() {
  const t = useT()
  const { status, signOut } = useAuth()
  const signedIn = status === 'unlocked'
  const [reason, setReason] = useState<'new' | 'open' | null>(null)
  const accepted = useRef(new Set<string>())
  const current = useRef('')

  /** This network as far as the phone can tell without location: its kind, Wi-Fi security and local address range. */
  const identify = useCallback(async () => {
    const [state, ip] = await Promise.all([Network.getNetworkStateAsync().catch(() => null), Network.getIpAddressAsync().catch(() => '')])
    const range = ip.split('.').slice(0, 3).join('.')
    const wifi = state?.type === Network.NetworkStateType.WIFI ? wifiSecurity() : null
    current.current = `${state?.type ?? 'unknown'}|${wifi ?? ''}|${range}`
    return wifi
  }, [])

  const check = useCallback(async () => {
    const wifi = await identify()
    if (wifi === 'open' && !accepted.current.has(current.current)) setReason((r) => r ?? 'open')
  }, [identify])

  useEffect(() => {
    if (!signedIn) return
    check()
    const sub = Network.addNetworkStateListener(() => { check() })
    setNetworkNewHandler(() => {
      identify().then(() => {
        if (!accepted.current.has(current.current)) setReason((r) => r ?? 'new')
      })
    })
    return () => {
      sub.remove()
      setNetworkNewHandler(null)
    }
  }, [signedIn, check, identify])

  const proceed = () => {
    accepted.current.add(current.current)
    setReason(null)
  }
  const leave = () => {
    setReason(null)
    void signOut(true)
  }

  return (
    <Modal visible={signedIn && reason !== null} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <View style={s.frame}>
        <View style={s.column} accessibilityLiveRegion="polite">
          <View style={s.icon}><Icon name={reason === 'open' ? 'wifi' : 'globe-outline'} size={36} color={colors.primary} /></View>
          <Text style={s.title}>{reason === 'open' ? t.netGuard.openTitle : t.netGuard.newTitle}</Text>
          <Text style={s.body}>{reason === 'open' ? t.netGuard.openBody : t.netGuard.newBody}</Text>
          <Text style={s.tip}>{t.netGuard.tip}</Text>
          <Button label={t.netGuard.continue} onPress={proceed} style={s.full} />
          <Button label={t.netGuard.notNow} variant="ghost" onPress={leave} style={s.full} />
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', alignItems: 'center' },
  icon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { fontSize: 15, color: colors.text, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  tip: { fontSize: 13.5, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 19, backgroundColor: colors.surface, padding: 12, borderRadius: radius.md, overflow: 'hidden' },
  full: { alignSelf: 'stretch', marginTop: 14 },
})
