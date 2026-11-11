import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ussdDialString, type UssdFunction, type UssdPlaceholder } from '../../shared/api'
import { useLanguage, useT } from '../i18n'
import { canDialUssd, dialUssd, useOffline, useUssd } from '../lib/ussd'
import { colors, radius } from '../theme'
import { Icon } from './ui'

/**
 * Shown only while the app has no internet: EcoCash's USSD menu instead. Android opens the dialer with the code (or a
 * shortcut with these values, when the portal sets one); the person types the PIN in the USSD session, never here.
 * `details` lists what to type in the menu (number, amount), for when the main code is dialled.
 */
export function UssdFallback({ fn, values, details, title }: {
  fn: UssdFunction
  values?: Partial<Record<UssdPlaceholder, string | number>>
  details?: string[]
  title?: string
}) {
  const t = useT()
  const { lang } = useLanguage()
  const ussd = useUssd()
  const offline = useOffline()
  const f = ussd.functions[fn]
  if (!offline || !ussd.enabled || !f?.enabled) return null
  const dial = ussdDialString(ussd, fn, values)
  const shortcut = dial !== ussd.code
  return (
    <View style={s.card} accessibilityRole="summary">
      <View style={s.row}>
        <View style={s.icon}><Icon name="keypad" size={20} color="#fff" /></View>
        <Text style={s.title}>{title ?? t.ussd.title(ussd.code)}</Text>
      </View>
      <Text style={s.steps}>{shortcut ? t.ussd.shortcutSteps : f.steps[lang]}</Text>
      {!shortcut && details && details.length > 0 && (
        <View style={s.details}>
          {details.map((d) => <Text key={d} style={s.detail} selectable>{d}</Text>)}
        </View>
      )}
      {canDialUssd ? (
        <Pressable accessibilityRole="button" onPress={() => dialUssd(dial)} style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]}>
          <Icon name="call" size={18} color="#fff" />
          <Text style={s.buttonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t.ussd.dial(dial)}</Text>
        </Pressable>
      ) : (
        <Text style={s.iphone} selectable>{t.ussd.iphone(dial)}</Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: '#F59E0B', padding: 14, marginVertical: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.text },
  steps: { fontSize: 14, lineHeight: 20, color: colors.text },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { fontSize: 13.5, fontWeight: '700', color: colors.text, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: radius.sm, backgroundColor: '#B45309', paddingHorizontal: 14 },
  buttonText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  iphone: { fontSize: 14, fontWeight: '700', color: colors.text },
})
