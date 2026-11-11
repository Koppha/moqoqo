import { router, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { EsProduct } from '../../shared/api'
import { MiniAppIcon } from '../components/MiniAppIcon'
import { useLightStatusBar } from '../components/useLightStatusBar'
import { LANGS, STRINGS, useLanguage } from '../i18n'
import { FORM_MAX } from '../lib/layout'
import { ecosure } from '../miniapps/ecosure/api'
import { funeralPackages } from '../miniapps/ecosure/data'
import { useEsT } from '../miniapps/ecosure/strings'
import { es, esRadius, esType, space, type EsGradient } from '../miniapps/ecosure/theme'
import { EsIcon, Gradient, Notice, OutlineButton, type EsIconName } from '../miniapps/ecosure/ui'

/**
 * The standalone EcoSure app's first page before sign-in, as in EcoSure's own app: what EcoSure covers, a quote with
 * no account, and a link to sign in (the same sign-in as EcoCash Super App, on the next screen). Buying cover needs sign-in.
 */
export default function Welcome() {
  const t = useEsT()
  const insets = useSafeAreaInsets()
  const { lang, setLang } = useLanguage()
  useLightStatusBar()
  const [products, setProducts] = useState<EsProduct[] | null>(null)
  useEffect(() => {
    ecosure.products().then(setProducts, () => {})
  }, [])

  // "From M30 a month" from the live catalogue once it has loaded; the built-in wording until then.
  const funeral = funeralPackages(products)
  const cheapest = (cover: 'family' | 'single') => (funeral.length ? Math.min(...funeral.map((p) => p.premium[cover])) : null)
  const cards: { key: 'family' | 'single' | 'shortTerm'; gradient: EsGradient; ink: string; icon: EsIconName; to: Href; sub: string }[] = [
    { key: 'family', gradient: 'family', ink: es.primary, icon: 'users', to: { pathname: '/ecosure/quote/[product]', params: { product: 'funeral', cover: 'family' } },
      sub: cheapest('family') != null ? t.from(cheapest('family')!) : t.cards.family.sub },
    { key: 'single', gradient: 'blue', ink: es.blue, icon: 'user', to: { pathname: '/ecosure/quote/[product]', params: { product: 'funeral', cover: 'single' } },
      sub: cheapest('single') != null ? t.from(cheapest('single')!) : t.cards.single.sub },
    { key: 'shortTerm', gradient: 'primary', ink: es.primary, icon: 'shield', to: '/ecosure/quotes', sub: t.cards.shortTerm.sub },
  ]

  return (
    <ScrollView style={{ flex: 1, backgroundColor: es.background }} contentContainerStyle={{ paddingBottom: insets.bottom + space(6) }}>
      <Gradient name="hero" style={{ paddingTop: insets.top + space(4), paddingBottom: space(7), paddingHorizontal: space(5), borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View style={{ width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MiniAppIcon id="ecosure" size={40} radius={12} fallback={(
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                  <EsIcon name="shieldFilled" color="#fff" size={22} />
                </View>
              )} />
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{t.brand}</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, padding: 3 }} accessibilityRole="radiogroup">
              {LANGS.map((code) => (
                <Pressable key={code} accessibilityRole="radio" accessibilityState={{ checked: code === lang }} onPress={() => setLang(code)}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: code === lang ? '#fff' : 'transparent' }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: code === lang ? es.primary : 'rgba(255,255,255,0.85)' }}>{STRINGS[code].langName}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', lineHeight: 32, marginTop: space(3) }} accessibilityRole="header">
            {t.welcome.hello}{'\n'}{t.welcome.title}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 20 }}>{t.welcome.tagline}</Text>
        </View>
      </Gradient>

      <View style={{ padding: space(4), gap: space(3), width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' }}>
        <Text style={esType.h3}>{t.selectCover}</Text>
        {cards.map((c) => (
          <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={`${t.cards[c.key].title}. ${c.sub}`} onPress={() => router.push(c.to)}>
            <Gradient name={c.gradient} style={{ borderRadius: esRadius.lg, padding: space(4), minHeight: 88, overflow: 'hidden', gap: 4 }}>
              <View style={{ position: 'absolute', right: 16, top: 16, width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <EsIcon name={c.icon} color="#fff" size={28} />
              </View>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t.cards[c.key].title}</Text>
              <Text style={{ color: '#fff', fontSize: 12, maxWidth: 210 }}>{c.sub}</Text>
              <View style={{ alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, minHeight: 28, justifyContent: 'center', marginTop: 4 }}>
                <Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>{t.explore}</Text>
              </View>
            </Gradient>
          </Pressable>
        ))}

        <OutlineButton label={t.welcome.getQuote} onPress={() => router.push('/ecosure/quotes')} style={{ marginTop: space(1) }} />

        {/* Signing in happens on the next screen (the same sign-in as EcoCash Super App): just a link here. */}
        <Pressable accessibilityRole="link" onPress={() => router.push('/login')}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3.5), borderRadius: esRadius.md, backgroundColor: es.surface, borderWidth: 1, borderColor: es.border, opacity: pressed ? 0.8 : 1 })}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: es.accentBg, alignItems: 'center', justifyContent: 'center' }}>
            <EsIcon name="user" size={20} color={es.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: es.accent }}>{t.welcome.login}</Text>
            <Text style={esType.small}>{t.welcome.loginHint}</Text>
          </View>
          <EsIcon name="chevron" size={18} color={es.textMuted} />
        </Pressable>

        <Notice tone="info" text={t.welcome.otp} />
      </View>
    </ScrollView>
  )
}
