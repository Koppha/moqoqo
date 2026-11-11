import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Icon, type IconName } from '../components/ui'
import { LANGS, STRINGS, useLanguage, useT } from '../i18n'
import { FORM_MAX } from '../lib/layout'
import { markOnboardingSeen } from '../lib/onboarding'
import { useAuth } from '../state/Auth'
import { colors, radius } from '../theme'

type SlideKey = 'chat' | 'apps' | 'together' | 'safe'
interface Slide {
  key: SlideKey
  icon: IconName
  gradient: readonly [string, string]
  /** Small floating badges around the main icon. */
  chips: { icon: IconName; color: string; at: { top?: number; bottom?: number; left?: number; right?: number } }[]
}

const SLIDES: Slide[] = [
  {
    key: 'chat', icon: 'chatbubbles', gradient: ['#5B2C9F', '#2E3A8C'],
    chips: [
      { icon: 'arrow-up-circle', color: '#16A34A', at: { top: 18, right: 6 } },
      { icon: 'hand-left', color: '#E8590C', at: { bottom: 24, left: 0 } },
      { icon: 'document-text', color: '#0EA5E9', at: { bottom: 8, right: 22 } },
    ],
  },
  {
    key: 'apps', icon: 'apps', gradient: ['#2E3A8C', '#0EA5E9'],
    chips: [
      { icon: 'shield-checkmark', color: '#5B2FD1', at: { top: 10, left: 10 } },
      { icon: 'flash', color: '#F59E0B', at: { top: 30, right: 0 } },
      { icon: 'globe', color: '#2563EB', at: { bottom: 12, left: 16 } },
      { icon: 'people', color: '#0F766E', at: { bottom: 20, right: 10 } },
    ],
  },
  {
    key: 'together', icon: 'people', gradient: ['#0F766E', '#16A34A'],
    chips: [
      { icon: 'checkmark-done-circle', color: '#16A34A', at: { top: 16, right: 4 } },
      { icon: 'wallet', color: '#7A2FB0', at: { bottom: 18, left: 4 } },
    ],
  },
  {
    key: 'safe', icon: 'lock-closed', gradient: ['#E2231A', '#7A2FB0'],
    chips: [
      { icon: 'finger-print', color: '#5B2C9F', at: { top: 14, left: 8 } },
      { icon: 'phone-portrait', color: '#2E3A8C', at: { bottom: 14, right: 8 } },
    ],
  },
]

/**
 * EcoCash Super App's introduction: four short pages before the first sign-in (shown once on this phone), with the
 * language choice up front. Skip or "Get started" goes to sign-in. Opened again from Me › Introduction, it goes back.
 */
export default function Onboarding() {
  const t = useT()
  const { lang, setLang } = useLanguage()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const list = useRef<FlatList<Slide>>(null)
  const [index, setIndex] = useState(0)
  const last = index === SLIDES.length - 1
  const pageWidth = width

  const { status } = useAuth()
  const finish = async () => {
    // Signed in: opened from Me › Introduction, so return there (or home, if there is nothing to go back to).
    if (status !== 'signedOut') return router.canGoBack() ? router.back() : router.replace('/')
    await markOnboardingSeen()
    router.replace('/login')
  }
  const next = () => (last ? finish() : list.current?.scrollToIndex({ index: index + 1, animated: true }))
  // FlatList needs the same function on every render.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Slide>[] }) => {
    const i = viewableItems[0]?.index
    if (i != null) setIndex(i)
  }, [])

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={s.top}>
        <View style={s.langs} accessibilityRole="radiogroup">
          {LANGS.map((code) => (
            <Pressable key={code} accessibilityRole="radio" accessibilityState={{ checked: code === lang }} onPress={() => setLang(code)}
              style={[s.lang, code === lang && s.langOn]}>
              <Text style={[s.langText, code === lang && s.langTextOn]}>{STRINGS[code].langName}</Text>
            </Pressable>
          ))}
        </View>
        {!last && (
          <Pressable accessibilityRole="button" onPress={finish} hitSlop={12}>
            <Text style={s.skip}>{t.onboarding.skip}</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={list}
        data={SLIDES}
        keyExtractor={(x) => x.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
        renderItem={({ item }) => {
          const copy = t.onboarding.slides[item.key]
          return (
            <View style={[s.page, { width: pageWidth }]}>
              <View style={s.art}>
                <LinearGradient colors={item.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.blob}>
                  <View style={s.ring}>
                    <Icon name={item.icon} size={72} color="#fff" />
                  </View>
                </LinearGradient>
                {item.chips.map((c) => (
                  <View key={c.icon} style={[s.chip, c.at]}>
                    <Icon name={c.icon} size={22} color={c.color} />
                  </View>
                ))}
              </View>
              <View style={s.copy}>
                <Text style={s.title} accessibilityRole="header">{copy.title}</Text>
                <Text style={s.body}>{copy.body}</Text>
              </View>
            </View>
          )
        }}
      />

      <View style={s.bottom}>
        <View style={s.dots}>
          {SLIDES.map((x, i) => <View key={x.key} style={[s.dot, i === index && s.dotOn]} />)}
        </View>
        <Button label={last ? t.onboarding.start : t.onboarding.next} onPress={next} style={s.cta} />
        {last && <Text style={s.terms}>{t.onboarding.terms}</Text>}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  langs: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.pill, padding: 3 },
  lang: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  langOn: { backgroundColor: colors.primary },
  langText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  langTextOn: { color: '#fff' },
  skip: { fontSize: 15, fontWeight: '600', color: colors.primary },
  page: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  art: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  blob: { width: 200, height: 200, borderRadius: 100, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  chip: {
    position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1B1F3B', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  copy: { marginTop: 40, maxWidth: FORM_MAX, alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center', lineHeight: 32 },
  body: { fontSize: 16, color: colors.muted, textAlign: 'center', lineHeight: 23, marginTop: 14 },
  bottom: { paddingHorizontal: 24, alignItems: 'center', width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 24, backgroundColor: colors.primary },
  cta: { alignSelf: 'stretch' },
  terms: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12 },
})
