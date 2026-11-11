import * as Haptics from 'expo-haptics'
import { useRef, useState } from 'react'
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native'
import { useT } from '../i18n'
import { colors } from '../theme'
import { Keypad } from './Keypad'

/**
 * Four PIN dots over the keypad. `onComplete` gets the PIN once 4 digits are in;
 * resolve false to shake and clear (wrong PIN). `onBiometrics` adds a fingerprint key.
 */
export function PinEntry({ onComplete, onBiometrics }: {
  onComplete: (pin: string) => Promise<boolean>
  onBiometrics?: () => void
}) {
  const t = useT()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake] = useState(() => new Animated.Value(0))
  const busyRef = useRef(false)

  const fail = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    Animated.sequence([10, -10, 8, -8, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true }))).start()
    setPin('')
  }

  const onKey = async (k: string) => {
    if (busyRef.current) return
    if (k === '👆') return onBiometrics?.()
    const next = k === '⌫' ? pin.slice(0, -1) : (pin + k).slice(0, 4)
    setPin(next)
    if (next.length < 4) return
    busyRef.current = true
    setBusy(true)
    const ok = await onComplete(next).catch(() => false)
    busyRef.current = false
    setBusy(false)
    if (!ok) fail()
  }

  return (
    <View>
      <Animated.View style={[p.dots, { transform: [{ translateX: shake }] }]} accessibilityLabel={t.dialogs.digits(pin.length)}>
        {busy ? <ActivityIndicator color={colors.primary} />
          : [0, 1, 2, 3].map((i) => <View key={i} style={[p.dot, i < pin.length && p.dotOn]} />)}
      </Animated.View>
      <Keypad extra={onBiometrics ? '👆' : null} onKey={onKey} />
    </View>
  )
}

const p = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, height: 16, marginVertical: 22 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.primary },
  dotOn: { backgroundColor: colors.primary },
})
