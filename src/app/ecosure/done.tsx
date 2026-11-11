import { router, useLocalSearchParams } from 'expo-router'
import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useEcoSure } from '../../miniapps/ecosure/data'
import { useEsT } from '../../miniapps/ecosure/strings'
import { es, space } from '../../miniapps/ecosure/theme'
import { EsIcon, PrimaryButton } from '../../miniapps/ecosure/ui'
import { FORM_MAX } from '../../lib/layout'

/** EcoSure's result screen: a green tick, what happened, an optional list (e.g. documents received), back to home. */
export default function Done() {
  const p = useLocalSearchParams<{ title: string; body: string; heading?: string; items?: string }>()
  const t = useEsT()
  const { refresh } = useEcoSure()
  const items = p.items ? p.items.split('\n').filter(Boolean) : []
  const home = () => {
    refresh()
    router.dismissTo('/ecosure')
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: es.background }} edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6), gap: space(3.5), width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: es.successDot, alignItems: 'center', justifyContent: 'center' }}>
          <EsIcon name="check" color="#fff" size={48} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: es.text, textAlign: 'center' }} accessibilityRole="header">{p.title}</Text>
        <Text style={{ fontSize: 15, color: es.textSoft, lineHeight: 24, textAlign: 'center', maxWidth: 320 }} accessibilityLiveRegion="polite">{p.body}</Text>
        {items.length ? (
          <View style={{ alignSelf: 'stretch', backgroundColor: es.surface, borderRadius: 14, borderWidth: 1, borderColor: es.border, padding: space(4), gap: 6 }}>
            {p.heading ? <Text style={{ fontSize: 14, fontWeight: '800', color: es.text }}>{p.heading}</Text> : null}
            {items.map((item) => <Text key={item} style={{ fontSize: 13, color: es.textSoft, lineHeight: 19 }}>•  {item}</Text>)}
          </View>
        ) : null}
        <Text style={{ fontSize: 13, color: es.textMuted, textAlign: 'center' }}>{t.chatNote}</Text>
      </View>
      <View style={{ padding: space(5), width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' }}>
        <PrimaryButton label={t.backHome} onPress={home} />
      </View>
    </SafeAreaView>
  )
}
