import * as Haptics from 'expo-haptics'
import { router, type Href } from 'expo-router'
import { usePreventScreenCapture, useScreenshotListener } from 'expo-screen-capture'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PAYCODE_REFRESH_SECONDS, type Me, type PayCode } from '../../shared/api'
import { Barcode } from '../components/Barcode'
import { QrCode } from '../components/QrCode'
import { Sheet, SheetOption } from '../components/Sheet'
import { Button, Icon, type IconName } from '../components/ui'
import { useLightStatusBar } from '../components/useLightStatusBar'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { useAuth } from '../state/Auth'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

/**
 * "Money": the customer's payment code for paying merchants (Quick Pay), plus links to receive and scan.
 * The code is a one-time token from the server, refreshed every minute and after each payment. It is
 * shown after the PIN (or biometrics), asked once per app session (until the app locks again), and the
 * screen can't be captured while it is visible.
 */
export default function Money() {
  const t = useT()
  const { state, dispatch } = useAppState()
  const { updateUser, status, unlockedAt, payCodeVerified, verifyPayCode } = useAuth()
  const { askPin } = useDialogs()
  const { fail, toast } = useMoqoqo()
  const { width } = useWindowDimensions()
  useLightStatusBar()
  const me = state.me
  const [agreed, setAgreed] = useState(false)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // The PIN/biometrics is asked once per app session: after that the code shows straight away until the app
  // locks again. A PIN entered on the lock screen after this screen opened (the Money shortcut on a cold start)
  // counts too. While the app is locked the lock screen covers everything.
  const [mountedAt] = useState(() => Date.now())
  const viaLock = unlockedAt !== null && unlockedAt > mountedAt
  const unlocked = payCodeVerified || viaLock
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const inner = Math.min(width - 32, FORM_MAX) - 40

  const saveMe = useCallback((next: Me) => {
    dispatch({ type: 'me', me: next })
    updateUser(next)
  }, [dispatch, updateUser])

  const enable = async () => {
    if (!agreed) return toast(t.money.mustAgree)
    const pin = await askPin({ label: t.money.enablePin })
    if (!pin) return
    try {
      saveMe(await api<Me>('/v1/paycode/enable', { body: { pin } }))
      verifyPayCode() // the PIN was just checked
      toast(t.money.enabled)
    } catch (e) {
      fail(e)
    }
  }

  const unlock = useCallback(() => {
    askPin({ label: t.money.showPin }).then((pin) => {
      if (pin) api('/v1/auth/verify-pin', { body: { pin } }).then(verifyPayCode, fail)
    })
  }, [askPin, fail, t, verifyPayCode])

  const turnOff = async () => {
    setMenuOpen(false)
    try {
      saveMe(await api<Me>('/v1/paycode/disable', { method: 'POST' }))
      setAgreed(false)
      toast(t.money.turnedOff)
    } catch (e) {
      fail(e)
    }
  }

  // Ask for the PIN as soon as the screen opens (once the app itself is unlocked), when there is a code to show.
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || !me?.quickPay || status !== 'unlocked') return
    asked.current = true
    if (!unlocked) unlock()
  }, [me?.quickPay, status, unlocked, unlock])

  // The lock-screen PIN (shortcut on a cold start) also covers later visits in this session.
  useEffect(() => {
    if (viaLock && !payCodeVerified) verifyPayCode()
  }, [viaLock, payCodeVerified, verifyPayCode])

  // A merchant charged one of my codes while this screen is open: intent.updated reaches the payer too.
  const [before] = useState(() => new Set(Object.keys(state.intents)))
  const paid = Object.values(state.intents).find((i) =>
    !before.has(i.id) && !dismissed.has(i.id) && i.method === 'paycode' && i.status === 'paid' && i.paidBy?.id === me?.id) ?? null
  useEffect(() => {
    if (paid) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }, [paid?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- once per payment

  if (!me) return null
  const links: { icon: IconName; label: string; to: Href }[] = [
    { icon: 'wallet-outline', label: t.money.receive, to: '/receive-money' },
    { icon: 'scan-outline', label: t.money.scan, to: '/pay' },
    { icon: 'document-text-outline', label: t.split.title, to: '/split' },
    { icon: 'card-outline', label: t.cash.topupTitle, to: '/topup' },
    { icon: 'business-outline', label: t.cash.bankTitle, to: '/bank' },
    { icon: 'globe-outline', label: t.remit.title, to: '/remit' },
    { icon: 'receipt-outline', label: t.money.history, to: '/transactions' },
  ]

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Pressable accessibilityLabel={t.common.back} onPress={() => router.back()} style={s.back}>
          <Icon name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={s.title}>{t.money.title}</Text>
        <View style={s.back} />
      </View>
      <ScrollView contentContainerStyle={s.column}>
        <View style={s.card}>
          <View style={s.cardHead}>
            <Icon name="scan-outline" size={22} color={colors.primary} />
            <Text style={s.cardTitle}>{t.money.payMerchant}</Text>
            {me.quickPay && (
              <Pressable accessibilityLabel={t.money.options} onPress={() => setMenuOpen(true)} hitSlop={10}>
                <Icon name="ellipsis-horizontal" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {paid ? (
            <View style={s.center}>
              <View style={s.ok}><Icon name="checkmark" size={48} color="#fff" /></View>
              <Text style={s.paidAmount}>{fmt(paid.amount)}</Text>
              <Text style={s.lead} accessibilityLiveRegion="assertive">
                {t.money.paid(fmt(paid.amount), paid.merchant.businessName ?? paid.merchant.name)}
              </Text>
              <Button label={t.money.done} onPress={() => setDismissed((d) => new Set(d).add(paid.id))} style={s.full} />
            </View>
          ) : !me.quickPay ? (
            <View style={s.center}>
              <Icon name="information-circle-outline" size={84} color={colors.muted} />
              <Text style={s.lead}>{t.money.notEnabled}</Text>
              <View style={s.agreeRow}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} accessibilityLabel={t.money.agreementTitle}
                  onPress={() => setAgreed((a) => !a)} hitSlop={8}>
                  <Icon name={agreed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={agreed ? colors.primary : colors.muted} />
                </Pressable>
                <Text style={s.agreeText}>
                  {t.money.agreePrefix}
                  <Text style={s.link} onPress={() => setAgreementOpen(true)}>{t.money.agreement}</Text>
                </Text>
              </View>
              <Button label={t.money.enable} disabled={!agreed} onPress={enable} style={s.enable} />
            </View>
          ) : !unlocked ? (
            <View style={s.center}>
              <View style={s.lockBadge}><Icon name="lock-closed" size={30} color={colors.primary} /></View>
              <Text style={s.lead}>{t.money.hidden}</Text>
              <Button label={t.money.show} icon="eye-outline" onPress={unlock} style={s.enable} />
            </View>
          ) : (
            <PayCodePanel width={inner} balance={state.balance} />
          )}

          <View style={s.security}>
            <Icon name="shield-checkmark-outline" size={14} color={colors.muted} />
            <Text style={s.securityText}>{t.money.security}</Text>
          </View>
        </View>

        <View style={s.links}>
          {links.map((l, i) => (
            <Pressable key={l.label} accessibilityRole="button" onPress={() => router.push(l.to)}
              style={({ pressed }) => [s.linkRow, i < links.length - 1 && s.linkBorder, pressed && { opacity: 0.7 }]}>
              <Icon name={l.icon} size={24} color="#fff" />
              <Text style={s.linkText}>{l.label}</Text>
              <Icon name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Sheet visible={agreementOpen} title={t.money.agreementTitle} onClose={() => setAgreementOpen(false)}>
        {t.money.agreementText.map((p) => <Text key={p} style={s.para}>{p}</Text>)}
        <Button label={t.money.accept} onPress={() => { setAgreed(true); setAgreementOpen(false) }} />
      </Sheet>
      <Sheet visible={menuOpen} title={t.money.options} onClose={() => setMenuOpen(false)}>
        <SheetOption icon="power" color={colors.danger} title={t.money.turnOff} subtitle={t.money.turnOffHint} onPress={turnOff} />
      </Sheet>
    </SafeAreaView>
  )
}

/** Mounted only while the code is visible, so screen capture is blocked exactly then. */
function PayCodePanel({ width, balance }: { width: number; balance: number }) {
  const t = useT()
  usePreventScreenCapture('paycode')
  const [code, setCode] = useState<PayCode | null>(null)
  const [error, setError] = useState(false)
  const [digits, setDigits] = useState(false)
  const [warning, setWarning] = useState(false)
  const [help, setHelp] = useState(false)
  const [methods, setMethods] = useState(false)
  /** Bumped to fetch a new code right now (retry, or after a screenshot); also restarts the refresh timer. */
  const [nonce, setNonce] = useState(0)
  const load = () => setNonce((n) => n + 1)

  useEffect(() => {
    let alive = true
    const fetchCode = () => api<PayCode>('/v1/paycode', { method: 'POST' }).then(
      (c) => { if (alive) { setCode(c); setError(false) } },
      () => { if (alive) setError(true) },
    )
    fetchCode()
    const timer = setInterval(fetchCode, PAYCODE_REFRESH_SECONDS * 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [nonce])

  // Where the OS lets a screenshot through anyway: warn, and replace the captured code at once.
  useScreenshotListener(() => {
    setWarning(true)
    load()
  })

  if (error && !code) {
    return (
      <View style={s.center}>
        <Text style={s.lead}>{t.money.loadFailed}</Text>
        <Button label={t.money.retry} icon="refresh" onPress={load} style={s.enable} />
      </View>
    )
  }
  if (!code) return <ActivityIndicator color={colors.primary} style={{ marginVertical: 120 }} />

  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={t.money.tapDigits} onPress={() => setDigits((d) => !d)} style={s.codeArea}>
        <Text style={s.tapHint}>{digits ? code.code.replace(/(\d{4})(?=\d)/g, '$1 ') : t.money.tapDigits}</Text>
        <Barcode value={code.code} width={width} height={Math.round(width * 0.26)} label={t.money.barcode} />
        <View style={{ marginTop: 20 }}>
          <QrCode value={code.code} size={Math.min(220, width * 0.62)} label={t.money.qr} />
        </View>
      </Pressable>

      {/* The balance stays out of sight (the cashier is looking at this screen) until the payer opens the picker. */}
      <Pressable accessibilityRole="button" accessibilityLabel={`${t.money.wallet}, ${t.money.defaultMethod}`} onPress={() => setMethods(true)}
        style={({ pressed }) => [s.source, pressed && { opacity: 0.6 }]}>
        <View style={s.sourceIcon}><Icon name="wallet" size={20} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.sourceTitle}>{t.money.wallet}</Text>
          <Text style={s.sourceSub}>{t.money.defaultMethod}</Text>
        </View>
        <Icon name="chevron-down" size={22} color={colors.muted} />
      </Pressable>
      <Sheet visible={methods} title={t.money.selectMethod} onClose={() => setMethods(false)}>
        <Text style={s.methodHint}>{t.money.selectMethodHint}</Text>
        <View style={s.method} accessibilityRole="radio" accessibilityState={{ checked: true }}>
          <View style={s.sourceIcon}><Icon name="wallet" size={20} color={colors.primary} /></View>
          <Text style={s.methodText}>{t.money.walletLeft(fmt(balance))}</Text>
          <Icon name="checkmark" size={24} color={colors.primary} />
        </View>
        <Button label={t.money.ok} onPress={() => setMethods(false)} style={s.enable} />
      </Sheet>

      {warning && (
        <View style={s.warning} accessibilityViewIsModal>
          <Icon name="shield-checkmark-outline" size={64} color={colors.muted} />
          <Text style={s.warningText} accessibilityLiveRegion="assertive">{t.money.warning}</Text>
          <Button label={t.money.ok} onPress={() => setWarning(false)} style={s.enable} />
          <Pressable accessibilityRole="button" onPress={() => setHelp(true)} style={{ marginTop: 18 }}>
            <Text style={s.link}>{t.money.help}</Text>
          </Pressable>
        </View>
      )}
      <Sheet visible={help} title={t.money.help} onClose={() => setHelp(false)}>
        <Text style={s.para}>{t.money.helpText}</Text>
        <Button label={t.money.ok} onPress={() => setHelp(false)} />
      </Sheet>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.primary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '700' },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, marginTop: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.primary },
  center: { alignItems: 'center', paddingVertical: 24 },
  lead: { fontSize: 16, color: colors.text, textAlign: 'center', marginTop: 20, lineHeight: 23, paddingHorizontal: 4 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, paddingHorizontal: 8 },
  agreeText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '600' },
  enable: { alignSelf: 'center', minWidth: 200, paddingHorizontal: 32, marginTop: 22 },
  lockBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  codeArea: { alignItems: 'center', paddingTop: 4, paddingBottom: 20 },
  tapHint: { color: colors.muted, fontSize: 14, marginBottom: 10, letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  source: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
  sourceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  sourceTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  sourceSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  methodHint: { textAlign: 'center', color: colors.muted, fontSize: 13.5, lineHeight: 19, marginTop: -6, marginBottom: 14, paddingHorizontal: 12 },
  method: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14 },
  methodText: { flex: 1, fontSize: 16, color: colors.text },
  security: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  securityText: { color: colors.muted, fontSize: 12.5 },
  warning: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.98)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  warningText: { fontSize: 16, color: colors.text, textAlign: 'center', lineHeight: 23, marginTop: 16 },
  ok: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  paidAmount: { fontSize: 32, fontWeight: '800', color: colors.text, marginTop: 16 },
  full: { alignSelf: 'stretch' },
  links: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.lg, marginTop: 16, paddingHorizontal: 16 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  linkBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.25)' },
  linkText: { flex: 1, color: '#fff', fontSize: 17 },
  para: { color: colors.text, fontSize: 14.5, lineHeight: 21, marginBottom: 12 },
})
