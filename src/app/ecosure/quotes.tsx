// Get a quote, step 1: choose what to cover (EcoSure BRS §3.1). Products come from the catalogue, so anything
// published there appears without an app update. Also lists the customer's earlier quotes.
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { EsProduct, EsQuote } from '../../../shared/api'
import { ecosure } from '../../miniapps/ecosure/api'
import { useAuth } from '../../state/Auth'
import { useEcoSure } from '../../miniapps/ecosure/data'
import { maloti, showDate } from '../../miniapps/ecosure/format'
import { useEsT } from '../../miniapps/ecosure/strings'
import { es, esRadius, esType, space } from '../../miniapps/ecosure/theme'
import { Badge, CATEGORY_ICON, Card, EsIcon, EsScreen, Loading, Notice, OutlineButton, type EsIconName } from '../../miniapps/ecosure/ui'

function ProductCard({ title, sub, price, icon, onPress }: { title: string; sub: string; price: string; icon: EsIconName; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${price}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: es.surface, borderRadius: esRadius.lg, borderWidth: 1, borderColor: es.border, padding: space(4), opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: es.lilac, alignItems: 'center', justifyContent: 'center' }}>
        <EsIcon name={icon} size={24} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: es.text }}>{title}</Text>
        <Text style={esType.small}>{sub}</Text>
        <Text style={{ fontSize: 13, fontWeight: '700', color: es.primary, marginTop: 2 }}>{price}</Text>
      </View>
      <EsIcon name="chevron" size={20} color={es.textMuted} />
    </Pressable>
  )
}

export default function Quotes() {
  const t = useEsT()
  const { products, error, refresh } = useEcoSure()
  const [mine, setMine] = useState<EsQuote[]>([])
  // A guest (before sign-in) has no earlier quotes to list.
  const guest = useAuth().status === 'signedOut'
  useEffect(() => {
    if (guest) return
    let alive = true
    ecosure.quotes().then((q) => { if (alive) setMine(q) }, () => {})
    return () => { alive = false }
  }, [guest])

  const priceLine = (list: EsProduct[]) => {
    const prices = list.flatMap((p) => (p.pricing === 'fixed' ? p.options.map((o) => o.monthlyPremium) : []))
    return prices.length ? t.from(Math.min(...prices)) : t.pricedByTeam
  }

  if (error && !products) {
    return (
      <EsScreen title={t.quotesTitle}>
        <Notice text={t.loadFailed} />
        <OutlineButton label={t.retry} onPress={refresh} />
      </EsScreen>
    )
  }
  if (!products) return <EsScreen title={t.quotesTitle}><Loading /></EsScreen>
  const funeral = products.filter((p) => p.line === 'funeral')
  const shortTerm = products.filter((p) => p.line === 'short_term')

  return (
    <EsScreen title={t.quotesTitle}>
      <View style={{ gap: 4 }}>
        <Text style={esType.h2}>{t.whatCover}</Text>
        <Text style={esType.body}>{t.quoteIntro}</Text>
      </View>
      {funeral.length ? (
        <>
          <Text style={esType.h3}>{t.funeralSection}</Text>
          <ProductCard title={t.familyOrSingle} sub={t.categories.funeral} price={priceLine(funeral)} icon="users"
            onPress={() => router.push({ pathname: '/ecosure/quote/[product]', params: { product: 'funeral' } })} />
        </>
      ) : null}
      {shortTerm.length ? (
        <>
          <Text style={esType.h3}>{t.shortTermSection}</Text>
          {shortTerm.map((p) => (
            <ProductCard key={p.code} title={p.name} sub={t.categories[p.category]} price={priceLine([p])} icon={CATEGORY_ICON[p.category]}
              onPress={() => router.push({ pathname: '/ecosure/quote/[product]', params: { product: p.code } })} />
          ))}
        </>
      ) : null}
      {mine.length ? (
        <>
          <Text style={esType.h3}>{t.myQuotes}</Text>
          {mine.map((q) => (
            <Card key={q.reference} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: es.text }}>{q.productName}{q.option ? ` · ${q.option}` : ''}</Text>
                <Text style={esType.small}>{q.reference} · {showDate(q.createdAt)}</Text>
                {q.monthlyPremium !== undefined ? <Text style={{ fontWeight: '800', color: es.primary }}>{t.perMonth(maloti(q.monthlyPremium))}</Text> : null}
              </View>
              <Badge label={t.quoteStatus[q.status]} tone={q.status === 'priced' ? 'success' : q.status === 'submitted' ? 'info' : 'warning'} />
            </Card>
          ))}
        </>
      ) : null}
    </EsScreen>
  )
}
