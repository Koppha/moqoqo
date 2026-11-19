import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import NfcManager, { NfcTech } from 'react-native-nfc-manager'
import { ECOCASH_AID, TAP_PREFIX } from '../../modules/ecocash-hce'
import { NO_PIN_TAP_LIMIT, PAYCODE_DIGITS, type PaymentIntent } from '../../shared/api'
import { QrCode } from '../components/QrCode'
import { Button, Card, Header, Icon, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { fmt } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { API_URL } from '../lib/variant'
import { useAppState } from '../state/AppState'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

/** Demo card linked to Lerato on the seeded server; only offered when testing against a local server on a device without NFC. */
const DEMO_TAG = '04A2246A8B6D80'
const LOCAL_SERVER = API_URL.startsWith('http://')

type Nfc = 'checking' | 'ready' | 'off' | 'none'

/** Customers' payment codes: 18 digits starting 62, as a Code 128 barcode or a QR code. */
const PAYCODE = new RegExp(`^62\\d{${PAYCODE_DIGITS - 2}}$`)

/**
 * A customer's phone held to this device (EcoCash Tap to pay): select our application ID; while its Tap screen is
 * open it answers "EC1:" + its one-time payment code + 9000 (else 6985). The code is then charged like a scanned one.
 */
async function readTapCode(): Promise<string | null> {
  const aid = (ECOCASH_AID.match(/../g) ?? []).map((h) => parseInt(h, 16))
  const res = await NfcManager.isoDepHandler.transceive([0x00, 0xa4, 0x04, 0x00, aid.length, ...aid, 0x00])
  if (res.length < 2 || res[res.length - 2] !== 0x90 || res[res.length - 1] !== 0x00) return null
  const text = String.fromCharCode(...res.slice(0, -2))
  if (!text.startsWith(TAP_PREFIX)) return null
  const code = text.slice(TAP_PREFIX.length)
  return PAYCODE.test(code) ? code : null
}

/**
 * Merchant "Receive money": one sale amount → a payment request the customer pays by scanning the QR,
 * typing the 6-digit code, tapping an EcoCash card/sticker on this terminal's NFC reader, or showing
 * their payment code for this terminal to scan. Agents use the same screen for cash-out
 * (`/receive?purpose=cashout`): the customer pays e-money in, the agent hands over the cash.
 */
export default function Receive() {
  const t = useT()
  const cashout = useLocalSearchParams<{ purpose?: string }>().purpose === 'cashout'
  const { state, dispatch } = useAppState()
  const { fail, toast } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [intentId, setIntentId] = useState<string | null>(null)
  const [nfc, setNfc] = useState<Nfc>('checking')
  const [now, setNow] = useState(() => Date.now())
  const [scan, setScan] = useState<'off' | 'camera' | 'type'>('off')
  const [typed, setTyped] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const scanned = useRef(false)
  const intent: PaymentIntent | undefined = intentId ? state.intents[intentId] : undefined
  const open = intent?.status === 'open' && new Date(intent.expiresAt).getTime() > now

  const start = useCallback(async () => {
    setIntentId(null)
    const amount = await askAmount({
      title: cashout ? t.cashout.howMuch : t.receive.howMuch, balance: state.balance,
      recipient: { name: state.me?.businessName ?? state.me?.name ?? '', subtitle: cashout ? t.cashout.title : t.receive.title, icon: cashout ? 'cash' : 'storefront' },
      confirmLabel: t.dialogs.continue,
    })
    if (!amount) return router.back()
    try {
      const created = await api<PaymentIntent>(cashout ? '/v1/agent/cashouts' : '/v1/merchant/intents', { body: { amount } })
      dispatch({ type: 'intent', intent: created })
      setIntentId(created.id)
    } catch (e) {
      fail(e)
      router.back()
    }
  }, [askAmount, cashout, dispatch, fail, state.balance, state.me, t])

  // Ask for the amount as soon as the screen opens.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [start])

  // Clock for the expiry countdown, and a poll in case a realtime event was missed.
  useEffect(() => {
    if (!intentId || !open) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(() => {
      api<PaymentIntent>(`/v1/merchant/intents/${intentId}`).then((i) => dispatch({ type: 'intent', intent: i })).catch(() => {})
    }, 5000)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [intentId, open, dispatch])

  // Paid: celebrate once.
  const status = intent?.status
  useEffect(() => {
    if (status === 'paid') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }, [status])

  // Leaving with the request still open cancels it, so it can't be paid after the customer walked away.
  const latest = useRef<{ id: string | null; open: boolean }>({ id: null, open: false })
  useEffect(() => { latest.current = { id: intentId, open } }, [intentId, open])
  useEffect(() => () => {
    const { id, open: stillOpen } = latest.current
    if (id && stillOpen) api(`/v1/merchant/intents/${id}/cancel`, { method: 'POST' }).catch(() => {})
  }, [])

  // ---- NFC: read customers' cards/stickers while the request is open ----
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const supported = await NfcManager.isSupported()
        if (!supported) return alive && setNfc('none')
        await NfcManager.start()
        if (alive) setNfc((await NfcManager.isEnabled()) ? 'ready' : 'off')
      } catch {
        if (alive) setNfc('none')
      }
    })()
    return () => { alive = false }
  }, [])

  const charge = useCallback(async (tagId: string) => {
    if (!intent) return
    let pin: string | undefined
    if (intent.amount > NO_PIN_TAP_LIMIT) {
      pin = (await askPin({ amount: intent.amount, label: t.receive.customerPin })) ?? undefined
      if (!pin) return
    }
    try {
      dispatch({ type: 'intent', intent: await api<PaymentIntent>(`/v1/merchant/intents/${intent.id}/tap`, { body: { tagId, pin }, onBehalfOf: true }) })
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'CONFLICT') return // already paid by QR in the meantime
      fail(e)
    }
  }, [intent, askPin, dispatch, fail, t])

  // ---- the customer's payment code, scanned or typed ----
  const chargeCode = useCallback(async (code: string) => {
    if (!intent) return
    let pin: string | undefined
    if (intent.amount > NO_PIN_TAP_LIMIT) {
      pin = (await askPin({ amount: intent.amount, label: t.receive.customerPin })) ?? undefined
      if (!pin) {
        scanned.current = false
        return
      }
    }
    try {
      dispatch({ type: 'intent', intent: await api<PaymentIntent>(`/v1/merchant/intents/${intent.id}/paycode`, { body: { code, pin }, onBehalfOf: true }) })
      setScan('off')
      setTyped('')
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'CONFLICT') return setScan('off') // paid another way meanwhile
      setScanError(t.errors[e instanceof ApiFailure ? e.code : 'UNKNOWN'])
      if (!(e instanceof ApiFailure && e.code === 'NOT_FOUND')) fail(e)
    } finally {
      scanned.current = false
    }
  }, [intent, askPin, dispatch, fail, t])

  const onScan = ({ data }: { data: string }) => {
    if (scanned.current) return
    const code = data.trim()
    if (!PAYCODE.test(code)) return setScanError(t.receive.notPayCode)
    scanned.current = true
    setScanError(null)
    chargeCode(code)
  }

  useEffect(() => {
    if (nfc !== 'ready' || !open || !intent) return
    let alive = true
    ;(async () => {
      while (alive) {
        try {
          // A customer's phone (EcoCash Tap to pay) answers as IsoDep; a card or sticker as plain NfcA.
          await NfcManager.requestTechnology([NfcTech.IsoDep, NfcTech.NfcA])
          const tag = await NfcManager.getTag()
          if (!alive || !tag) break
          if (tag.techTypes?.some((x) => x.endsWith('IsoDep'))) {
            const code = await readTapCode()
            if (!alive) break
            if (code) await chargeCode(code)
            else toast(t.receive.tapOpenApp)
            break
          }
          if (tag.id) await charge(tag.id.toUpperCase())
          break
        } catch {
          // Cancelled or a bad read: try again while the request is open.
        } finally {
          await NfcManager.cancelTechnologyRequest().catch(() => {})
        }
      }
    })()
    return () => {
      alive = false
      NfcManager.cancelTechnologyRequest().catch(() => {})
    }
  }, [nfc, open, intent?.id, charge, chargeCode, toast, t, intent])

  const cancel = async () => {
    if (intent && open) {
      try {
        dispatch({ type: 'intent', intent: await api<PaymentIntent>(`/v1/merchant/intents/${intent.id}/cancel`, { method: 'POST' }) })
      } catch {
        // Paid or expired meanwhile; the screen shows whichever.
      }
    }
    router.back()
  }

  const left = intent ? Math.max(0, Math.ceil((new Date(intent.expiresAt).getTime() - now) / 60_000)) : 0

  return (
    <Screen>
      <Header title={cashout ? t.cashout.title : t.receive.title} />
      <View style={s.column}>
        {!intent ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />
        ) : intent.status === 'paid' ? (
          <Card style={s.center}>
            <View style={[s.badge, { backgroundColor: colors.success }]}><Icon name="checkmark" size={52} color="#fff" /></View>
            <Text style={s.amount}>{fmt(intent.amount)}</Text>
            <Text style={s.lead} accessibilityLiveRegion="assertive">{cashout ? t.cashout.handOver(fmt(intent.amount), intent.paidBy?.name ?? '') : t.receive.paid(fmt(intent.amount), intent.paidBy?.name ?? '')}</Text>
            <Button label={cashout ? t.cashout.another : t.receive.newSale} icon="add" onPress={start} style={s.full} />
            <Button label={t.tap.done} variant="ghost" onPress={() => router.back()} style={s.full} />
          </Card>
        ) : !open ? (
          <Card style={s.center}>
            <View style={[s.badge, { backgroundColor: colors.surface2 }]}><Icon name="time-outline" size={44} color={colors.muted} /></View>
            <Text style={s.lead}>{intent.status === 'cancelled' ? t.receive.cancelled : t.receive.expired}</Text>
            <Button label={cashout ? t.cashout.another : t.receive.newSale} icon="add" onPress={start} style={s.full} />
          </Card>
        ) : scan !== 'off' ? (
          <Card style={s.center}>
            <Text style={s.amount}>{fmt(intent.amount)}</Text>
            {scan === 'camera' ? (
              !permission ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />
                : !permission.granted ? (
                  <>
                    <Text style={s.lead}>{t.pay.cameraNeeded}</Text>
                    <Button label={t.pay.allowCamera} onPress={requestPermission} style={s.full} />
                  </>
                ) : (
                  <>
                    <View style={s.cameraBox}>
                      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr'] }} onBarcodeScanned={onScan} />
                      <View style={s.frame} pointerEvents="none" />
                    </View>
                    <Text style={s.muted}>{t.receive.scanCustomerHint}</Text>
                  </>
                )
            ) : (
              <>
                <Text style={[s.muted, { marginTop: 16 }]}>{t.receive.customerCodeLabel}</Text>
                <TextInput style={s.codeInput} value={typed} onChangeText={(v) => setTyped(v.replace(/\D/g, '').slice(0, PAYCODE_DIGITS))}
                  keyboardType="number-pad" maxLength={PAYCODE_DIGITS} autoFocus accessibilityLabel={t.receive.customerCodeLabel} />
                <Button label={t.receive.chargeCode} disabled={!PAYCODE.test(typed)} onPress={() => { scanned.current = true; setScanError(null); chargeCode(typed) }} style={s.full} />
              </>
            )}
            {scanError && <Text style={s.error} accessibilityLiveRegion="polite">{scanError}</Text>}
            <Button label={scan === 'camera' ? t.receive.typeCustomer : t.pay.useCamera} icon={scan === 'camera' ? 'keypad-outline' : 'barcode-outline'} variant="ghost"
              onPress={() => { setScan(scan === 'camera' ? 'type' : 'camera'); setScanError(null) }} style={s.full} />
            <Button label={t.receive.backToRequest} variant="ghost" onPress={() => setScan('off')} style={s.full} />
          </Card>
        ) : (
          <Card style={s.center}>
            <Text style={s.amount}>{fmt(intent.amount)}</Text>
            <Text style={s.muted}>{cashout ? t.cashout.scan : t.receive.scan}</Text>
            <View style={{ marginVertical: 16 }}>
              <QrCode value={`moqoqo://pay?i=${intent.id}`} size={240} label={cashout ? t.cashout.scan : t.receive.scan} />
            </View>
            <Text style={s.code}>
              {cashout
                ? t.cashout.orCode(intent.code.replace(/(\d{3})(\d{3})/, '$1 $2'), intent.merchant.code)
                : t.receive.orCode(intent.code.replace(/(\d{3})(\d{3})/, '$1 $2'))}
            </Text>
            <View style={s.tap}>
              <Icon name="wifi" size={22} color={nfc === 'ready' ? colors.primary : colors.muted} />
              <Text style={s.tapText}>{nfc === 'ready' ? t.receive.tapCard : nfc === 'off' ? t.receive.nfcOff : nfc === 'none' ? t.receive.noNfc : '…'}</Text>
            </View>
            {nfc === 'none' && LOCAL_SERVER && (
              <Button label={t.receive.simulateTap} icon="card-outline" variant="ghost" onPress={() => charge(DEMO_TAG)} style={s.full} />
            )}
            <Button label={t.receive.scanCustomer} icon="barcode-outline" variant="ghost" onPress={() => { setScan('camera'); setScanError(null) }} style={s.full} />
            <View style={s.waiting}>
              <ActivityIndicator color={colors.primary} />
              <Text style={s.muted}>{t.receive.waiting} · {t.receive.expiresIn(left)}</Text>
            </View>
            {cashout && <Button label={t.cashout.byNumber} icon="call-outline" variant="ghost" onPress={() => router.replace('/biz-action/cash-out')} style={s.full} />}
            <Button label={t.receive.cancel} variant="ghost" onPress={() => { toast(t.receive.cancelled); cancel() }} style={s.full} />
          </Card>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  center: { alignItems: 'center', paddingVertical: 24 },
  amount: { fontSize: 34, fontWeight: '800', color: colors.text },
  lead: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginTop: 8, paddingHorizontal: 12 },
  muted: { fontSize: 13.5, color: colors.muted, textAlign: 'center', marginTop: 4 },
  code: { fontSize: 15, color: colors.text, fontWeight: '600' },
  tap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12, marginTop: 16, alignSelf: 'stretch' },
  tapText: { flex: 1, color: colors.primaryDark, fontSize: 13.5, fontWeight: '500' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  badge: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  full: { alignSelf: 'stretch' },
  cameraBox: { alignSelf: 'stretch', aspectRatio: 1.4, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  frame: { width: '80%', height: '50%', borderWidth: 3, borderColor: '#fff', borderRadius: radius.md },
  codeInput: { alignSelf: 'stretch', backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, height: 60, fontSize: 20, fontWeight: '700', letterSpacing: 2, textAlign: 'center', color: colors.text, marginTop: 8 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12, fontSize: 14 },
})
