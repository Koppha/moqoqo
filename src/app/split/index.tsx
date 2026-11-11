import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Header, Icon, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { FORM_MAX } from '../../lib/layout'
import { colors } from '../../theme'

/** Split bill: what it is, then pick a chat to split in, or look back at earlier ones. */
export default function SplitIntro() {
  const t = useT()
  return (
    <Screen scroll={false}
      footer={
        <View style={s.footer}>
          <Button label={t.split.create} onPress={() => router.push('/split/pick-chat')} style={s.create} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/split/history')} style={s.historyBtn}>
            <Text style={s.history}>{t.split.history}</Text>
          </Pressable>
        </View>
      }>
      <Header title="" />
      <View style={s.body}>
        <Icon name="document-text-outline" size={72} color={colors.primary} />
        <Text style={s.title}>{t.split.title}</Text>
        <Text style={s.intro}>{t.split.intro}</Text>
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { alignItems: 'center', paddingHorizontal: 32, marginTop: 48 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 20 },
  intro: { fontSize: 15.5, color: colors.muted, textAlign: 'center', lineHeight: 22, marginTop: 12 },
  footer: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 32, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  create: { alignSelf: 'stretch' },
  historyBtn: { paddingVertical: 18 },
  history: { color: colors.primary, fontSize: 15, fontWeight: '600' },
})
