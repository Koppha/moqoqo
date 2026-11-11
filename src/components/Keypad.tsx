import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '../i18n'
import { colors, shadow } from '../theme'
import { Icon } from './ui'

/** Round white keys, as in the reference "Send Money" screen. '⌫' = backspace, '👆' = fingerprint, null = empty slot. */
export function Keypad({ extra, onKey }: { extra: '.' | '👆' | null; onKey: (k: string) => void }) {
  const t = useT()
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', extra ?? '', '0', '⌫']
  return (
    <View style={k.grid}>
      {keys.map((key) => (
        <View key={key || 'empty'} style={k.cell}>
          {key === '' ? <View style={[k.key, k.keyFlat]} /> : <Pressable
            accessibilityRole="button"
            accessibilityLabel={key === '⌫' ? t.dialogs.delete : key === '👆' ? t.dialogs.fingerprint : key}
            onPress={() => {
              Haptics.selectionAsync()
              onKey(key)
            }}
            style={({ pressed }) => [k.key, key === '⌫' && k.keyFlat, pressed && { transform: [{ scale: 0.94 }], backgroundColor: colors.primarySoft }]}
          >
            {key === '⌫' ? <Icon name="backspace-outline" size={22} color={colors.muted} />
              : key === '👆' ? <Icon name="finger-print" size={26} color={colors.primary} />
                : <Text style={k.text}>{key}</Text>}
          </Pressable>}
        </View>
      ))}
    </View>
  )
}

const k = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 24 },
  cell: { width: '33.33%', alignItems: 'center', paddingVertical: 7 },
  key: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.05 },
  keyFlat: { backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0 },
  text: { fontSize: 24, fontWeight: '500', color: colors.text },
})
