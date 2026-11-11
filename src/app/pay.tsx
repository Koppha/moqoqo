import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import type { MoneyResult, Payee, PaymentIntent, PublicUser } from '../../shared/api'
import { Avatar, Button, Card, Header, Icon, Screen } from '../components/ui'
import { UssdFallback } from '../components/UssdFallback'
import { useT } from '../i18n'
import { api, ApiFailure } from '../lib/api'
import { fmt, uid } from '../lib/format'
import { readQrFromImage } from '../lib/qrImage'
import { FORM_MAX } from '../lib/layout'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

type Merchant = PublicUser & { code: string }
type Target =
  | { kind: 'intent'; intent: PaymentIntent; method: 'qr' | 'code' }
  | { kind: 'merchant'; merchant: Merchant }
  | { kind: 'person'; payee: Payee; amount?: number }
/** `for=agent`: opened from Cash out (pay an agent, who hands over cash); otherwise Pay merchant. */
type Query = { i?: string; m?: string; u?: string; a?: string; for?: string }

/**
 * `moqoqo://pay?i=<intentId>` (amount set at the till), `moqoqo://pay?m=<merchantCode>` (printed sticker),
 * or `moqoqo://pay?u=<userId>[&a=<amount>]` (a person's receive QR).
 */
function parse(data: string): Query | null {
  const match = /^moqoqo:\/\/pay\?(.+)$/.exec(data.trim())
  if (!match) return null
  const out: Query = {}
  for (const part of match[1].split('&')) {
    const [k, v] = part.split('=')
    if ((k === 'i' || k === 'm' || k === 'u' || k === 'a') && v) out[k] = decodeURIComponent(v)
  }
  return out.i || out.m || out.u ? out : null
}

/** A merchant code (digits, any length; a till's one-off code is 6 digits), or an agent's code (AGENT-0101). */
const CODE = /^(\d+|[A-Z]+-\d+)$/

const amountOf = (a?: string) => {
  const n = Number(a)
  return n > 0 ? Math.round(n * 100) / 100 : undefined
}

/**
 * Customer pays a merchant: scan the QR, type the merchant code (or a till's one-off code), or arrive here from a
 * moqoqo://pay link opened by the phone's own camera app. PIN always.
 */
export default function Pay() {
  const params = useLocalSearchParams<Query>()
  const t = useT()
  const forAgent = params.for === 'agent'
  const codeLabel = forAgent ? t.pay.codeLabelAgent : t.pay.codeLabel
  const { state, settled, fail, toast } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [permission, requestPermission] = useCameraPermissions()
  const [mode, setMode] = useState<'camera' | 'code'>('camera')
  const [code, setCode] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  // Busy from the start when opened from a link that still has to be looked up.
  const [busy, setBusy] = useState(() => !!(params.i || params.m || params.u))
  const [error, setError] = useState<string | null>(null)
  const scanned = useRef(false)

  /**
   * A merchant's or agent's own code (1001, AGENT-0101): their open request if they started one
   * (a sale or a cash-out); otherwise a merchant can still be paid an amount the customer types.
   */
  const findBusiness = useCallback(async (raw: string): Promise<{ target?: Target; error?: string }> => {
    const code = encodeURIComponent(raw)
    try {
      return { target: { kind: 'intent', intent: await api<PaymentIntent>(`/v1/intents/lookup?business=${code}`), method: 'code' } }
    } catch (e) {
      if (!(e instanceof ApiFailure && e.code === 'NOT_FOUND')) throw e
    }
    try {
      return { target: { kind: 'merchant', merchant: await api<Merchant>(`/v1/merchants/${code}`) } }
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'NOT_FOUND') return { error: t.pay.noOpen(raw) }
      throw e
    }
  }, [t])

  /** Look up what a QR, link or code points at. No state changes here; `apply` does that. */
  const find = useCallback(async (q: Query & { code?: string }): Promise<{ target?: Target; error?: string }> => {
    try {
      if (q.u) return { target: { kind: 'person', payee: await api<Payee>(`/v1/payees/${encodeURIComponent(q.u)}`), amount: amountOf(q.a) } }
      if (q.m) return { target: { kind: 'merchant', merchant: await api<Merchant>(`/v1/merchants/${encodeURIComponent(q.m)}`) } }
      if (q.code && !/^\d{6}$/.test(q.code)) return await findBusiness(q.code)
      const query = q.i ? `id=${encodeURIComponent(q.i)}` : `code=${q.code}`
      try {
        return { target: { kind: 'intent', intent: await api<PaymentIntent>(`/v1/intents/lookup?${query}`), method: q.code ? 'code' : 'qr' } }
      } catch (e) {
        // Six digits that aren't a till's one-off code: a merchant code of that length.
        if (q.code && e instanceof ApiFailure && e.code === 'NOT_FOUND') return await findBusiness(q.code)
        throw e
      }
    } catch (e) {
      return { error: e instanceof ApiFailure && e.code === 'NOT_FOUND' ? t.pay.gone : t.errors[e instanceof ApiFailure ? e.code : 'UNKNOWN'] }
    }
  }, [t, findBusiness])

  const apply = (r: { target?: Target; error?: string }) => {
    if (r.target) setTarget(r.target)
    if (r.error) {
      setError(r.error)
      scanned.current = false
    }
    setBusy(false)
  }

  // Opened from a link: look it up straight away.
  useEffect(() => {
    if (!params.i && !params.m && !params.u) return
    let alive = true
    find({ i: params.i, m: params.m, u: params.u, a: params.a }).then((r) => alive && apply(r))
    return () => { alive = false }
  }, [params.i, params.m, params.u, params.a, find])

  const lookup = (q: Query & { code?: string }) => {
    setBusy(true)
    setError(null)
    find(q).then(apply)
  }

  /** A QR code from a photo or screenshot in the gallery: read it, then the same as scanning it. */
  const fromGallery = async () => {
    setError(null)
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (picked.canceled) return
    setBusy(true)
    try {
      const found = await readQrFromImage(picked.assets[0].uri)
      const q = found.map(parse).find((x) => x !== null)
      if (!q) {
        setBusy(false)
        return setError(found.length ? t.pay.notMoqoqo : t.pay.noQrInImage)
      }
      scanned.current = true
      lookup(q)
    } catch {
      setBusy(false)
      setError(t.pay.noQrInImage)
    }
  }

  const onScan = ({ data }: { data: string }) => {
    if (scanned.current || busy) return
    const q = parse(data)
    if (!q) return setError(t.pay.notMoqoqo)
    scanned.current = true
    lookup(q)
  }

  const payPerson = async (payee: Payee, preset?: number) => {
    const amount = preset ?? await askAmount({ title: t.pay.payPerson(payee.name), balance: state.balance, recipient: { name: payee.name, subtitle: payee.maskedMsisdn }, confirmLabel: t.dialogs.continue })
    if (!amount) return
    const pin = await askPin({ amount, label: t.pay.payPerson(payee.name) })
    if (!pin) return
    try {
      settled(await api<MoneyResult>('/v1/payments/person', { body: { toUserId: payee.id, amount, pin, clientId: uid() } }))
      toast(t.pay.paid(fmt(amount), payee.name))
      router.back()
    } catch (e) {
      fail(e)
    }
  }

  const pay = async () => {
    if (!target) return
    if (target.kind === 'person') return payPerson(target.payee, target.amount)
    const merchant = target.kind === 'intent' ? target.intent.merchant : target.merchant
    const name = merchant.businessName ?? merchant.name
    let amount = target.kind === 'intent' ? target.intent.amount : 0
    if (target.kind === 'merchant') {
      const typed = await askAmount({ title: t.pay.payTo(name), balance: 0, recipient: { name, subtitle: t.receive.merchantCode(merchant.code), icon: 'storefront' }, confirmLabel: t.dialogs.continue })
      if (!typed) return
      amount = typed
    }
    const isCashout = target.kind === 'intent' && target.intent.purpose === 'cashout'
    const pin = await askPin({ amount, label: isCashout ? t.cashout.confirmTitle(name) : t.pay.payTo(name) })
    if (!pin) return
    try {
      const res = target.kind === 'intent'
        ? await api<MoneyResult>(`/v1/intents/${target.intent.id}/pay`, { body: { pin, method: target.method } })
        : await api<MoneyResult>('/v1/payments/merchant', { body: { merchantCode: merchant.code, amount, pin } })
      settled(res)
      toast(isCashout ? t.cashout.collect(fmt(amount), name) : t.pay.paid(fmt(amount), name))
      router.back()
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'CONFLICT') {
        setError(t.pay.gone)
        setTarget(null)
        scanned.current = false
        return
      }
      fail(e)
    }
  }

  const merchant = target?.kind === 'intent' ? target.intent.merchant : target?.kind === 'merchant' ? target.merchant : null

  return (
    <Screen>
      <Header title={forAgent ? t.pay.agentTitle : t.pay.scanTitle} />
      {mode === 'camera' && <UssdFallback fn="merchant" />}
      <View style={s.column}>
        {target?.kind === 'person' ? (
          <Card style={s.confirm}>
            <Avatar name={target.payee.name} size={64} />
            <Text style={s.name}>{target.payee.name}</Text>
            <Text style={s.muted}>{target.payee.maskedMsisdn}</Text>
            <Text style={s.muted}>{t.pay.personHint}</Text>
            {target.amount ? <Text style={s.amount}>{fmt(target.amount)}</Text> : null}
            <Button label={target.amount ? t.msg.pay(fmt(target.amount)) : t.pay.payPerson(target.payee.name)} onPress={pay} style={s.full} />
            <Button label={t.receive.cancel} variant="ghost" onPress={() => { setTarget(null); scanned.current = false }} style={s.full} />
          </Card>
        ) : target && merchant ? (
          <Card style={s.confirm}>
            <Avatar name={merchant.businessName ?? merchant.name} icon={target.kind === 'intent' && target.intent.purpose === 'cashout' ? 'cash' : 'storefront'} color={colors.primary} size={64} />
            <Text style={s.name}>
              {target.kind === 'intent' && target.intent.purpose === 'cashout' ? t.cashout.confirmTitle(merchant.businessName ?? merchant.name) : merchant.businessName ?? merchant.name}
            </Text>
            <Text style={s.muted}>{t.receive.merchantCode(merchant.code)}</Text>
            {target.kind === 'intent' && <Text style={s.amount}>{fmt(target.intent.amount)}</Text>}
            {target.kind === 'intent' && target.intent.note ? <Text style={s.muted}>{target.intent.note}</Text> : null}
            <Button label={target.kind === 'merchant' ? t.pay.payTo(merchant.businessName ?? merchant.name)
              : target.intent.purpose === 'cashout' ? t.cashout.confirm(fmt(target.intent.amount)) : t.msg.pay(fmt(target.intent.amount))} onPress={pay} style={s.full} />
            <Button label={t.receive.cancel} variant="ghost" onPress={() => { setTarget(null); scanned.current = false }} style={s.full} />
          </Card>
        ) : mode === 'camera' ? (
          <>
            {!permission ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              : !permission.granted ? (
                <Card style={s.confirm}>
                  <Icon name="camera-outline" size={40} color={colors.primary} />
                  <Text style={s.lead}>{t.pay.cameraNeeded}</Text>
                  <Button label={t.pay.allowCamera} onPress={requestPermission} style={s.full} />
                </Card>
              ) : (
                <View style={s.cameraBox}>
                  <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
                  <View style={s.frame} pointerEvents="none" />
                </View>
              )}
            <Text style={s.hint}>{t.pay.scanHint}</Text>
            <Button label={t.pay.fromGallery} icon="images-outline" variant="ghost" onPress={fromGallery} disabled={busy} />
            <Button label={forAgent ? t.pay.enterAgentCode : t.pay.enterCode} icon="keypad-outline" variant="ghost" onPress={() => { setMode('code'); setError(null) }} />
          </>
        ) : (
          <>
            <Text style={s.label}>{codeLabel}</Text>
            <TextInput style={s.codeInput} value={code} onChangeText={(v) => setCode(forAgent ? v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) : v.replace(/\D/g, '').slice(0, 20))}
              keyboardType={forAgent ? 'default' : 'number-pad'} autoCapitalize="characters" autoCorrect={false} maxLength={forAgent ? 12 : 20}
              accessibilityLabel={codeLabel} autoFocus onSubmitEditing={() => CODE.test(code) && lookup({ code })} />
            <Button label={t.pay.find} disabled={!CODE.test(code) || busy} onPress={() => lookup({ code })} />
            <UssdFallback fn="merchant" values={{ code: CODE.test(code) ? code : undefined }} details={CODE.test(code) ? [code] : undefined} />
            <Button label={t.pay.useCamera} icon="qr-code-outline" variant="ghost" onPress={() => { setMode('camera'); setError(null) }} />
          </>
        )}
        {busy && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}
        {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  cameraBox: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '64%', aspectRatio: 1, borderWidth: 3, borderColor: '#fff', borderRadius: radius.md },
  hint: { textAlign: 'center', color: colors.muted, marginTop: 12 },
  confirm: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 8 },
  amount: { fontSize: 34, fontWeight: '800', color: colors.text, marginTop: 8 },
  lead: { fontSize: 15, color: colors.text, textAlign: 'center', marginTop: 8 },
  muted: { fontSize: 13.5, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8, marginTop: 8 },
  codeInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, height: 64, fontSize: 26, fontWeight: '700', letterSpacing: 3, textAlign: 'center', color: colors.text },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12, fontSize: 14 },
  full: { alignSelf: 'stretch' },
})
