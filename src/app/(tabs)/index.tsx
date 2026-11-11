import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useState } from 'react'
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BILL_ICON, iconForChat } from '../../components/icons'
import { BillIcon, TxIcon } from '../../components/TxIcon'
import { useServices } from '../../lib/services'
import type { HomeSection } from '../../../shared/api'
import { NoticeBanners } from '../../components/Maintenance'
import { UssdFallback } from '../../components/UssdFallback'
import { useUssd } from '../../lib/ussd'
import { OfferBanners } from '../../components/OfferBanners'
import { useHomeContent } from '../../lib/home'
import { MiniAppTile, ShortcutTile, useOpenMiniApp } from '../../components/MiniApps'
import { homeApps } from '../../miniapps/registry'
import { RecentsPanel } from '../../components/RecentsPanel'
import { Sheet, SheetOption } from '../../components/Sheet'
import { ActionButton, Avatar, Card, Icon, ListRow, Pill, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { fmt, maskMsisdn } from '../../lib/format'
import { CONTENT_MAX, useLayout } from '../../lib/layout'
import { useLightStatusBar } from '../../components/useLightStatusBar'
import { useChats, useTransactions } from '../../state/AppState'
import { useAuth } from '../../state/Auth'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

export default function Home() {
  const { state, sendMoney, createRequest } = useMoqoqo()
  const insets = useSafeAreaInsets()
  const t = useT()
  const ussd = useUssd()
  const { session } = useAuth()
  const name = session?.user.name ?? ''
  const chats = useChats()
  const openContactCentre = () => {
    const assistant = chats.find((c) => c.assistant)
    if (assistant) router.push({ pathname: '/chat/[id]', params: { id: assistant.id } })
    else router.push('/chats')
  }
  const transactions = useTransactions()
  const { services } = useServices()
  const { wide } = useLayout()
  useLightStatusBar(!wide)
  const [pick, setPick] = useState<'send' | 'request' | null>(null)
  // Top up: the wallet from a card, or airtime (for this number unless changed).
  const [topping, setTopping] = useState(false)
  const home = useHomeContent()
  const openApp = useOpenMiniApp()
  const [showBalance, setShowBalance] = useState(true)
  const [recents, setRecents] = useState(false)

  // Send goes to one person; a request can go to a group.
  const contacts = chats.filter((c) => (pick === 'send' ? !!c.msisdn : !!c.msisdn || c.group))
  const pending = chats.flatMap((c) =>
    c.messages.flatMap((m) => (m.type === 'request' && m.request.status === 'pending' ? [{ chat: c, m, r: m.request }] : [])),
  )
  const [whole, cents] = fmt(state.balance).slice(1).split('.')

  const choose = (id: string) => {
    const mode = pick
    setPick(null)
    if (mode === 'send') sendMoney(id, 'money')
    else createRequest(id)
  }

  // Phones and tablet portrait: one column (centred on tablets). Wide screens: card and actions
  // on the left, requests and transactions on the right.
  const hero = (
    <View style={wide ? h.heroWideWrap : undefined}>
      <LinearGradient colors={['#2446E8', '#0B1D86']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={wide ? [h.hero, h.heroWide] : [h.hero, { paddingTop: insets.top + 12 }]}>
        {/* Soft waves behind the header, as in the design. */}
        <View pointerEvents="none" style={[h.wave, { top: -120, right: -140, width: 360, height: 360 }]} />
        <View pointerEvents="none" style={[h.wave, { top: 40, right: -220, width: 420, height: 260, opacity: 0.05 }]} />
        <View style={h.topRow}>
          {/* The EcoCash logo (no greeting: the card below already names the wallet holder). */}
          <Image source={require('../../../assets/ecocash-logo-light.png')} style={h.logo} resizeMode="contain"
            accessibilityRole="image" accessibilityLabel="EcoCash" />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.home.notifications} onPress={() => router.push('/news')} style={h.roundBtn}>
              <Icon name="notifications-outline" size={22} color="#fff" />
              {pending.length > 0 && <View style={h.dot} />}
            </Pressable>
            {/* Contact centre: the EcoCash Assistant first; it hands over to a person in EcoCash Support when needed. */}
            <Pressable accessibilityRole="button" accessibilityLabel={t.home.contactCentre} onPress={openContactCentre} style={h.roundBtn}>
              <Icon name="headset-outline" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      </LinearGradient>

      <LinearGradient colors={['#2F6BFF', '#5B3BF5', '#B23CF2']} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={[h.card, wide && h.cardWide]}>
        <View style={h.cardTop}>
          <View style={h.cardTitle}>
            <Icon name="wallet" size={22} color="#fff" />
            <Text style={h.cardLabel}>{t.home.currentBalance}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={showBalance ? t.home.hideBalance : t.home.showBalance} onPress={() => setShowBalance((v) => !v)} hitSlop={10}>
              <Icon name={showBalance ? 'eye-outline' : 'eye-off-outline'} size={20} color="#DCE4FF" />
            </Pressable>
          </View>
          <View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="wifi" size={24} color="#fff" /></View>
        </View>
        <Text style={h.balance} accessibilityLabel={showBalance ? t.common.balance(fmt(state.balance)) : t.home.hideBalance}>
          {showBalance ? <>M{whole}<Text style={h.cents}>.{cents}</Text></> : `M${t.home.hidden}`}
        </Text>
        <View style={h.cardDivider} />
        <View style={h.cardBottom}>
          <View style={h.cardCell}>
            <View style={h.cardIcon}><Icon name="person-outline" size={18} color="#fff" /></View>
            <View style={{ flexShrink: 1 }}>
              <Text style={h.cardLbl}>{t.home.walletHolder}</Text>
              <Text style={h.cardVal} numberOfLines={1}>{name}</Text>
            </View>
          </View>
          <View style={h.cardSplit} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/me')} style={[h.cardCell, { flex: 0.8 }]}>
            <View style={h.cardIcon}><Icon name="shield-checkmark-outline" size={18} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={h.cardLbl}>KYC</Text>
              <Text style={h.cardVal}>{t.home.tier(state.me?.kycTier ?? 2)}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  )
  const actions = (
    <View style={[h.actions, wide && h.actionsWide]}>
      <ActionButton icon="arrow-up-circle-outline" label={t.common.send} onPress={() => router.push('/send')} />
      <ActionButton icon="hand-left-outline" label={t.common.request} onPress={() => setPick('request')} />
      <ActionButton icon="cash-outline" label={t.cashOutHub.title} onPress={() => router.push('/cashout')} />
      <ActionButton icon="qr-code-outline" label={t.money.title} onPress={() => router.push('/money')} />
      <ActionButton icon="add-circle-outline" label={t.cash.topupAction} onPress={() => setTopping(true)} />
    </View>
  )
  // Order and visibility come from the portal (Home & offers › Home layout).
  const sections: Record<HomeSection, React.ReactNode> = {
    offers: <OfferBanners offers={home.offers} />,
    services: (
      <>
      <SectionTitle title={t.home.services} action="grid-outline" onAction={() => router.push('/services')} />
      <Card style={h.services}>
        {homeApps(7).map((app) => <MiniAppTile key={app.id} app={app} onPress={() => openApp(app)} />)}
        <ShortcutTile icon="ellipsis-horizontal" label={t.home.seeAll} onPress={() => router.push('/services')} />
      </Card>
      </>
    ),
    requests: (
      <>
      {pending.length > 0 && (
        <>
          <SectionTitle title={t.home.requestsTitle(pending.length)} />
          <Card style={{ paddingVertical: 4 }}>
            {pending.map(({ chat, m, r }, i) => {
              const bill = r.bill ? t.bills[r.bill] : null
              const ic = r.bill ? BILL_ICON[r.bill]
                : { icon: r.kind === 'cashout' ? 'cash' as const : r.kind === 'merchant' ? 'storefront' as const : 'hand-left' as const, color: colors.primary }
              const what = bill ? bill.name : r.kind === 'cashout' ? t.biz.cashOut : r.kind === 'merchant' ? t.biz.charge : 'EcoCash'
              return (
                <ListRow
                  key={m.id}
                  last={i === pending.length - 1}
                  onPress={() => router.push(`/chat/${chat.id}`)}
                  left={r.bill && bill ? <BillIcon bill={r.bill} name={bill.name} size={42} /> : <Avatar name={chat.name} icon={ic.icon} color={ic.color} size={42} />}
                  title={`${what} · ${m.who ?? chat.name}`}
                  subtitle={m.from === 'them' ? t.home.waitingForYou : t.home.waitingForThem}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={h.amount}>{fmt(r.amount - (r.paid ?? 0))}</Text>
                      <Pill label={m.from === 'them' ? t.home.toPay : t.home.sent} tone={m.from === 'them' ? 'warn' : 'primary'} />
                    </View>
                  }
                />
              )
            })}
          </Card>
        </>
      )}

      </>
    ),
    transactions: (
      <>
      <SectionTitle title={t.home.recent} action="arrow-forward" onAction={() => router.push('/transactions')} />
      <Card style={{ paddingVertical: 4 }}>
        {transactions.slice(0, wide ? 8 : 5).map((x, i, arr) => {
          return (
            <ListRow
              key={x.id}
              last={i === arr.length - 1}
              left={<TxIcon description={x.description} amount={x.amount} services={services} size={42} />}
              title={x.description}
              subtitle={x.time}
              right={<Text style={[h.amount, x.amount > 0 && { color: colors.success }]}>{x.amount > 0 ? '+' : '−'}{fmt(Math.abs(x.amount))}</Text>}
            />
          )
        })}
      </Card>
      </>
    ),
  }
  const lists = (
    <View style={wide ? { flex: 1 } : h.column}>
      <NoticeBanners />
      <UssdFallback fn="balance" title={t.ussd.homeTitle(ussd.code)} />

      {home.layout.sections.filter((x) => x.visible).map(({ key }) => <View key={key}>{sections[key]}</View>)}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Pull down to see recently used mini apps and services. */}
      <ScrollView contentContainerStyle={wide ? [h.wide, { paddingTop: insets.top + 16 }] : { paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRecents(true)} tintColor="#fff" progressViewOffset={insets.top} />}>
        {wide ? (
          <>
            <View style={h.left}>{hero}{actions}</View>
            {lists}
          </>
        ) : (
          <>
            {hero}
            <View style={h.column}>{actions}</View>
            {lists}
          </>
        )}
      </ScrollView>

      <RecentsPanel visible={recents} onClose={() => setRecents(false)} />

      <Sheet visible={topping} title={t.cash.topupAction} onClose={() => setTopping(false)}>
        <SheetOption icon="card" color={colors.primary} title={t.home.topupWallet[0]} subtitle={t.home.topupWallet[1]}
          onPress={() => { setTopping(false); router.push('/topup') }} />
        <SheetOption icon="call" color="#16A34A" title={t.home.topupAirtime[0]} subtitle={t.home.topupAirtime[1]}
          onPress={() => { setTopping(false); router.push({ pathname: '/service/[id]', params: { id: 'svc-airtime' } }) }} />
      </Sheet>

      <Sheet visible={!!pick} title={pick === 'send' ? t.home.sendTo : t.home.requestFrom} onClose={() => setPick(null)}>
        {contacts.map((c) => (
          <SheetOption
            key={c.id}
            icon={iconForChat(c) ?? 'person'}
            title={c.name}
            subtitle={c.msisdn ? maskMsisdn(c.msisdn) : t.common.group}
            onPress={() => choose(c.id)}
          />
        ))}
      </Sheet>
    </View>
  )
}

const h = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingBottom: 96, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden' },
  wave: { position: 'absolute', borderRadius: 999, backgroundColor: '#FFFFFF', opacity: 0.07 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  // The logo with no background, "Eco" in white for the blue header (assets/ecocash-logo-light.png, 450 × 134).
  logo: { width: 120, height: 36 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 11, right: 13, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF4D5E', borderWidth: 1.5, borderColor: '#1A35C4' },
  card: { borderRadius: radius.lg, padding: 20, marginTop: -72, marginHorizontal: 16, width: 'auto', maxWidth: 560, alignSelf: 'stretch', shadowColor: '#2B2E8F', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  cardWide: { marginHorizontal: 0 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  balance: { color: '#fff', fontSize: 37, fontWeight: '800', marginTop: 10, letterSpacing: -0.5 },
  cents: { fontSize: 22, fontWeight: '700' },
  cardDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 16 },
  cardBottom: { flexDirection: 'row', alignItems: 'center' },
  cardCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  cardSplit: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 14 },
  cardLbl: { color: '#DCE4FF', fontSize: 12 },
  cardVal: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  actions: { flexDirection: 'row', backgroundColor: colors.surface, marginTop: 16, paddingVertical: 16, borderRadius: radius.lg },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },
  column: { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 16 },
  wide: { flexDirection: 'row', alignItems: 'flex-start', gap: 24, paddingHorizontal: 24, paddingBottom: 24, width: '100%', maxWidth: 1200, alignSelf: 'center' },
  left: { width: 420 },
  heroWide: { borderRadius: radius.xl, paddingTop: 16 },
  heroWideWrap: { paddingBottom: 4 },
  actionsWide: { marginHorizontal: 0 },
  services: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, paddingVertical: 16, paddingHorizontal: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 16, marginTop: 12 },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  bannerSub: { color: '#EDE5FF', fontSize: 13 },
  bannerCta: { alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, marginTop: 6 },
  bannerCtaText: { color: '#5B2FD1', fontWeight: '700', fontSize: 12.5 },
  bannerIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
})
