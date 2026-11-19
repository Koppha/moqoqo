import { router, type Href } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MiniAppIcon } from '../../../components/MiniAppIcon'
import { useAppState } from '../../../state/AppState'
import { useMoqoqo } from '../../../state/useMoqoqo'
import { ecosure } from '../../../miniapps/ecosure/api'
import { cheapestFuneral, useEcoSure } from '../../../miniapps/ecosure/data'
import { coverName, maloti, showDate, statusName, statusTone } from '../../../miniapps/ecosure/format'
import { useEsT } from '../../../miniapps/ecosure/strings'
import { es, esRadius, esType, space, type EsGradient } from '../../../miniapps/ecosure/theme'
import { Badge, Card, CloseCapsule, EsIcon, Gradient, Notice, OutlineButton, type EsIconName } from '../../../miniapps/ecosure/ui'
import { FORM_MAX } from '../../../lib/layout'

const SLIDES: { gradient: EsGradient; icon: EsIconName; to: Href }[] = [
  { gradient: 'primary', icon: 'shield', to: '/ecosure/quote/funeral' },
  { gradient: 'blue', icon: 'card', to: '/ecosure/pay' },
  { gradient: 'coral', icon: 'claims', to: '/ecosure/claims' },
]

/** EcoSure home, as in the EcoSure app: banner slides, my cover, select your cover, quick actions. */
export default function EcoSureHome() {
  const t = useEsT()
  const insets = useSafeAreaInsets()
  const { state } = useAppState()
  const { toast, fail } = useMoqoqo()
  const { products, content, policy, sponsorships, error, refresh } = useEcoSure()
  const [slide, setSlide] = useState(0)
  const firstName = (state.me?.name ?? '').split(' ')[0]
  const requests = sponsorships?.forMe.filter((x) => x.status === 'awaiting') ?? []
  const sl = SLIDES[slide]
  // Prices in the banner and cards come from the live catalogue; without it, the same words without a price.
  const familyFrom = cheapestFuneral(products, 'family')
  const singleFrom = cheapestFuneral(products, 'single')
  const copy = slide === 0 && familyFrom != null ? { ...t.slides[0], title: t.slideFamilyFrom(familyFrom) } : t.slides[slide]
  const cardSub = (key: keyof typeof t.cards) =>
    key === 'family' && familyFrom != null ? t.withFrom(t.cards.family.sub, familyFrom)
      : key === 'single' && singleFrom != null ? t.withFrom(t.cards.single.sub, singleFrom)
        : t.cards[key].sub

  const answer = async (id: string, action: 'accept' | 'decline') => {
    try {
      await ecosure.sponsorAction(id, action)
      await refresh()
    } catch (e) {
      fail(e)
    }
  }

  const cards: { key: keyof typeof t.cards; gradient: EsGradient; ink: string; icon: EsIconName; to: Href }[] = [
    { key: 'family', gradient: 'family', ink: es.primary, icon: 'users', to: { pathname: '/ecosure/quote/[product]', params: { product: 'funeral', cover: 'family' } } },
    { key: 'single', gradient: 'blue', ink: es.blue, icon: 'user', to: { pathname: '/ecosure/quote/[product]', params: { product: 'funeral', cover: 'single' } } },
    { key: 'shortTerm', gradient: 'primary', ink: es.primary, icon: 'shield', to: '/ecosure/quotes' },
    { key: 'claims', gradient: 'coral', ink: es.coral, icon: 'claims', to: '/ecosure/claims' },
  ]
  const quick: { label: string; icon: EsIconName; to: Href }[] = [
    { label: t.qa.dependants, icon: 'users', to: '/ecosure/dependants' },
    { label: t.qa.manage, icon: 'sliders', to: '/ecosure/policy' },
    { label: t.qa.sponsor, icon: 'heart', to: '/ecosure/sponsor' },
    { label: t.qa.migrate, icon: 'swap', to: '/ecosure/migrate' },
  ]

  return (
    <ScrollView style={{ flex: 1, backgroundColor: es.background }}
      contentContainerStyle={{ paddingTop: insets.top + space(3), padding: space(5), gap: space(4), width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MiniAppIcon id="ecosure" size={38} radius={11} fallback={(
            <Gradient style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
              <EsIcon name="shield" color="#fff" size={22} />
            </Gradient>
          )} />
          <View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: es.text }}>{t.brand}</Text>
            <Text style={esType.small}>{t.greet(firstName)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.help} onPress={() => toast(t.helpText(content?.callCentre ?? null))}
            style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: es.border, backgroundColor: es.surface, alignItems: 'center', justifyContent: 'center' }}>
            <EsIcon name="headset" size={20} color={es.text} />
          </Pressable>
          <CloseCapsule />
        </View>
      </View>

      {error && !policy ? (
        <>
          <Notice text={t.loadFailed} />
          <OutlineButton label={t.retry} onPress={refresh} />
        </>
      ) : null}

      {requests.map((r) => (
        <Card key={r.id} style={{ backgroundColor: es.lilac, borderColor: es.lilacMuted }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: es.text }}>{t.sponsorRequest(r.sponsor.name)}</Text>
          <Text style={esType.small}>{r.policy.packageName} · {coverName(r.policy.cover, t)} · {t.perMonth(maloti(r.policy.premium))}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Pressable accessibilityRole="button" onPress={() => answer(r.id, 'accept')} style={{ flex: 1 }}>
              <Gradient style={{ height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{t.accept}</Text></Gradient>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => answer(r.id, 'decline')} style={{ flex: 1, height: 42, borderRadius: 21, borderWidth: 1, borderColor: es.lilacMuted, backgroundColor: es.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: es.textSoft, fontWeight: '700' }}>{t.decline}</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      <Gradient name={sl.gradient} style={{ borderRadius: esRadius.lg, padding: space(4.5), minHeight: 132, overflow: 'hidden', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ position: 'absolute', right: 22, top: 26, width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <EsIcon name={sl.icon} color="#fff" size={38} />
        </View>
        <View style={{ maxWidth: 210, gap: 4 }}>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', lineHeight: 22 }}>{copy.title}</Text>
          <Text style={{ color: es.lilac, fontSize: 12 }}>{copy.sub}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push(sl.to)} style={{ alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 17, paddingHorizontal: 14, minHeight: 34, justifyContent: 'center' }}>
          <Text style={{ color: es.primary, fontSize: 12, fontWeight: '700' }}>{copy.cta}</Text>
        </Pressable>
      </Gradient>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: -8 }}>
        {SLIDES.map((_, i) => (
          <Pressable key={i} accessibilityLabel={t.slides[i].title} onPress={() => setSlide(i)} hitSlop={10}
            style={{ width: i === slide ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === slide ? es.primary : es.lilacMuted }} />
        ))}
      </View>

      {policy ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[esType.small, { fontWeight: '600' }]}>{t.myCover}</Text>
            <Badge label={statusName(policy.status, t)} tone={statusTone(policy.status)} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: es.text }}>{policy.packageName} {coverName(policy.cover, t)}</Text>
          <Text style={esType.small}>{t.policyLine(policy.number, policy.members.length)}</Text>
          {policy.sponsoredBy ? <Text style={[esType.small, { color: es.primary, fontWeight: '600' }]}>{t.sponsoredBy(policy.sponsoredBy.name)}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: es.divider, paddingTop: 10, gap: 8 }}>
            <Text style={{ fontSize: 13, color: es.text, flex: 1 }}>
              {t.nextPremium} <Text style={{ fontWeight: '800' }}>{maloti(policy.premium)}</Text> · {showDate(policy.nextDue)}
            </Text>
            <Pressable onPress={() => router.push('/ecosure/pay')} accessibilityRole="button">
              <Gradient style={{ height: 36, borderRadius: 18, paddingHorizontal: 18, justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t.pay}</Text>
              </Gradient>
            </Pressable>
          </View>
        </Card>
      ) : !error ? (
        <Card style={{ backgroundColor: es.lilac, borderColor: es.lilacMuted }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: es.text }}>{t.noCover}</Text>
          <Text style={esType.small}>{t.noCoverSub}</Text>
        </Card>
      ) : null}

      <Text style={esType.h3}>{t.selectCover}</Text>
      {cards.map((c) => (
        <Gradient key={c.key} name={c.gradient} style={{ borderRadius: esRadius.lg, padding: space(4), minHeight: 96, overflow: 'hidden', gap: 6 }}>
          <View style={{ position: 'absolute', right: 16, top: 16, width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
            <EsIcon name={c.icon} color="#fff" size={32} />
          </View>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{t.cards[c.key].title}</Text>
          <Text style={{ color: '#fff', fontSize: 12, maxWidth: 200 }}>{cardSub(c.key)}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push(c.to)} style={{ alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, minHeight: 32, justifyContent: 'center', marginTop: 4 }}>
            <Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>{t.explore}</Text>
          </Pressable>
        </Gradient>
      ))}

      <Text style={esType.h3}>{t.quickActions}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {quick.map((q) => (
          <Pressable key={q.label} accessibilityRole="button" onPress={() => router.push(q.to)} style={{ alignItems: 'center', gap: 6, width: 76 }}>
            <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: es.lilac, alignItems: 'center', justifyContent: 'center' }}>
              <EsIcon name={q.icon} size={24} />
            </View>
            <Text style={{ fontSize: 11, fontWeight: '600', color: es.textSoft, textAlign: 'center' }}>{q.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}
