import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import type { Offer } from '../../shared/api'
import { assetUri, openOffer } from '../lib/home'
import { useLocalized } from '../lib/services'
import { colors, radius } from '../theme'

/** Banners from the portal (Home & offers), swiped sideways when there are several. */
export function OfferBanners({ offers }: { offers: Offer[] }) {
  const [width, setWidth] = useState(0)
  const [page, setPage] = useState(0)
  if (!offers.length) return null
  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ marginTop: 16 }}>
      {width > 0 && (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {offers.map((o) => <View key={o.id} style={{ width }}><OfferCard offer={o} /></View>)}
        </ScrollView>
      )}
      {offers.length > 1 && (
        <View style={s.dots}>{offers.map((o, i) => <View key={o.id} style={[s.dot, i === page && s.dotOn]} />)}</View>
      )}
    </View>
  )
}

const ECOSURE_LOGO = require('../../assets/ecosure/icon.png')

export function OfferCard({ offer: o }: { offer: Offer }) {
  const L = useLocalized()
  // A picture uploaded in the portal; EcoSure offers without one show EcoSure's logo.
  const picture = o.image ? { uri: assetUri(o.image) } : o.target?.startsWith('ecosure') ? ECOSURE_LOGO : null
  return (
    <Pressable accessibilityRole={o.target ? 'button' : undefined} accessibilityLabel={`${L(o.title)}. ${L(o.cta)}`} disabled={!o.target} onPress={() => openOffer(o)}>
      <LinearGradient colors={[o.color, '#0B1D86']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.banner}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.title}>{L(o.title)}</Text>
          <Text style={s.sub}>{L(o.body)}</Text>
          {o.target && <View style={s.cta}><Text style={s.ctaText}>{L(o.cta)}</Text></View>}
        </View>
        {picture && <Image source={picture} style={s.image} resizeMode="cover" accessibilityIgnoresInvertColors />}
      </LinearGradient>
    </Pressable>
  )
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: radius.lg, minHeight: 120 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.9)', fontSize: 13.5 },
  cta: { alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, marginTop: 6 },
  ctaText: { color: '#0B1D86', fontWeight: '700', fontSize: 13 },
  image: { width: 76, height: 76, borderRadius: 14 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 16, backgroundColor: colors.primary },
})
