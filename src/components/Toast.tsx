import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppState } from '../state/AppState'
import { colors, radius } from '../theme'

export function Toast() {
  const { state, dispatch } = useAppState()
  const insets = useSafeAreaInsets()
  useEffect(() => {
    if (!state.toast) return
    const t = setTimeout(() => dispatch({ type: 'toast', text: null }), 2200)
    return () => clearTimeout(t)
  }, [state.toast, dispatch])
  if (!state.toast) return null
  return (
    <View pointerEvents="none" style={[t.wrap, { bottom: 110 + insets.bottom }]}>
      <Text accessibilityLiveRegion="polite" style={t.toast}>{state.toast}</Text>
    </View>
  )
}

const t = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: { backgroundColor: colors.hero, color: '#fff', paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill, fontSize: 14, overflow: 'hidden' },
})
