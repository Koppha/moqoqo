import * as ImagePicker from 'expo-image-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { checkServiceValues, localNumber, phoneNetwork, serviceAmount, serviceFee, type ServiceDef, type ServiceField, type ServiceQuote, type ServiceResult, type ServiceValues } from '../../../shared/api'
import { ContactPickButton } from '../../components/ContactPickButton'
import { Sheet } from '../../components/Sheet'
import { Avatar, Button, Card, Header, Icon, Screen } from '../../components/ui'
import { SavedAccounts } from '../../components/SavedAccounts'
import { UssdFallback } from '../../components/UssdFallback'
import { useT } from '../../i18n'
import { api, errorCode, ApiFailure } from '../../lib/api'
import { fmt, maskMsisdn, uid } from '../../lib/format'
import { FORM_MAX } from '../../lib/layout'
import { cachedService, useLocalized, useServices } from '../../lib/services'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

type Upload = { status: 'uploading' | 'done' | 'error'; id?: string }

/**
 * Any service defined in the portal: the customer fills in its fields, sees amount, fee (and the account holder's
 * name when the service checks it), confirms with the PIN, and gets a receipt. Request services (e.g. Update KYC)
 * work the same way without money.
 */
export default function ServiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const t = useT()
  const L = useLocalized()
  const { services } = useServices()
  const def = services.find((s) => s.id === id) ?? cachedService(id)
  if (!def) return <Screen><Header title={t.svc.title} /><ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /></Screen>
  return <ServiceForm key={def.id} def={def} title={L(def.name)} />
}

/** Phone fields that offer "My number" start with it (airtime, bundles), when that number's network is one they take. */
function ownNumberDefaults(def: ServiceDef, msisdn?: string): ServiceValues {
  const own = msisdn ? localNumber(msisdn) : ''
  const net = phoneNetwork(own)
  if (!net) return {}
  return Object.fromEntries(def.fields.filter((f) => f.type === 'phone' && f.ownNumber && (!f.networks?.length || f.networks.includes(net))).map((f) => [f.key, own]))
}

/** The field saved accounts fill (as the server decides it): the one required account field beside the amount. */
function savableAccount(def: ServiceDef): string | null {
  if (def.executor === 'request') return null
  const account = def.fields.find((f) => f.required && (f.type === 'text' || f.type === 'number' || f.type === 'phone'))
  const amount = def.fields.find((f) => f.type === 'amount')
  const others = def.fields.filter((f) => f.required && f !== account && f !== amount)
  return account && amount && others.length === 0 ? account.key : null
}

function ServiceForm({ def, title }: { def: ServiceDef; title: string }) {
  const t = useT()
  const L = useLocalized()
  const { state, settled, fail, toast } = useMoqoqo()
  const { askPin } = useDialogs()
  const [values, setValues] = useState<ServiceValues>(() => ownNumberDefaults(def, state.me?.msisdn))
  const [touched, setTouched] = useState(false)
  const [uploads, setUploads] = useState<Record<string, Upload>>({})
  const [quote, setQuote] = useState<ServiceQuote | null>(null)
  const [result, setResult] = useState<ServiceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const money = def.executor !== 'request'

  const set = (key: string, v: string) => setValues((x) => ({ ...x, [key]: v }))
  // Money services whose only required fields are an account and the amount can keep saved accounts (up to 5).
  const accountKey = savableAccount(def)
  const errors = checkServiceValues(def, values)
  const amount = serviceAmount(def, values)
  const uploading = Object.values(uploads).some((u) => u.status === 'uploading')

  const errorText = (f: ServiceField) => {
    const e = errors[f.key]
    if (!e || !touched) return null
    if (e === 'pattern' && f.patternMessage) return L(f.patternMessage)
    if (e === 'tooSmall' && f.min !== undefined) return t.svc.min(fmt(f.min))
    if (e === 'tooBig' && f.max !== undefined) return t.svc.max(fmt(f.max))
    return t.svc.errors[e]
  }

  const review = async () => {
    setTouched(true)
    if (Object.keys(errors).length || uploading) return
    setBusy(true)
    try {
      setQuote(await api<ServiceQuote>(`/v1/services/${def.id}/quote`, { body: { values } }))
    } catch (e) {
      if (e instanceof ApiFailure && e.message && errorCode(e) === 'VALIDATION') toast(e.message)
      else fail(e)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!quote) return
    const q = quote
    setQuote(null)
    const pin = await askPin({ amount: money ? q.total : undefined, label: title })
    if (!pin) return
    setBusy(true)
    try {
      const res = await api<ServiceResult>(`/v1/services/${def.id}/submit`, { body: { values, pin, clientId: uid() } })
      if (res.transaction && res.balance !== undefined) settled({ balance: res.balance, transaction: res.transaction })
      setResult(res)
    } catch (e) {
      if (e instanceof ApiFailure && errorCode(e) === 'VALIDATION' && e.message) toast(e.message)
      else fail(e)
    } finally {
      setBusy(false)
    }
  }

  const pickImage = async (key: string, how: 'camera' | 'photos') => {
    const perm = how === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return toast(how === 'camera' ? t.svc.cameraDenied : t.svc.photosDenied)
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, exif: false }
    const r = how === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
    if (r.canceled || !r.assets[0]?.base64) return
    const a = r.assets[0]
    setUploads((u) => ({ ...u, [key]: { status: 'uploading' } }))
    try {
      const up = await api<{ id: string }>('/v1/ecosure/uploads', {
        body: { fileName: a.fileName ?? `${key}.jpg`, contentType: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', base64: a.base64 },
      })
      setUploads((u) => ({ ...u, [key]: { status: 'done', id: up.id } }))
      set(key, up.id)
    } catch (e) {
      setUploads((u) => ({ ...u, [key]: { status: 'error' } }))
      fail(e)
    }
  }

  if (result) {
    return (
      <Screen footer={<View style={s.footer}><Button label={t.svc.done} onPress={() => router.back()} /></View>}>
        <Header title={title} back={false} />
        <View style={s.body}>
          <View style={s.doneIcon}><Icon name="checkmark" size={40} color="#fff" /></View>
          <Text style={s.doneTitle}>{result.request ? t.svc.requestSent : t.svc.paid}</Text>
          {result.request ? <Text style={s.doneSub}>{t.svc.requestHint}</Text> : null}
          <Card style={{ marginTop: 18 }}>
            <Row label={t.svc.reference} value={result.reference} mono />
            {result.lines.map((l) => <Row key={l.label} label={l.label} value={l.value} />)}
          </Card>
        </View>
      </Screen>
    )
  }

  return (
    <Screen footer={<View style={s.footer}><Button label={busy ? t.svc.checking : t.svc.continue} disabled={busy || uploading} onPress={review} /></View>}>
      <Header title={title} />
      <View style={s.body}>
        {def.id === 'svc-airtime' && <UssdFallback fn="airtime" />}
        {def.description.en ? <Text style={s.desc}>{L(def.description)}</Text> : null}
        {def.fields.map((f) => (
          <View key={f.key} style={{ marginBottom: 16 }}>
            {f.type !== 'checkbox' && <Text style={s.label}>{L(f.label)}{f.required ? '' : ` ${t.svc.optional}`}</Text>}
            {f.key === accountKey && <SavedAccounts target={`service:${def.id}`} value={values[f.key] ?? ''} onPick={(a) => set(f.key, a)} />}
            <FieldInput f={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} myNumber={state.me?.msisdn}
              upload={uploads[f.key]} onPick={(how) => pickImage(f.key, how)} invalid={!!errorText(f)} />
            {f.hint?.en ? <Text style={s.hint}>{L(f.hint)}</Text> : null}
            {errorText(f) ? <Text style={s.error}>{errorText(f)}</Text> : null}
          </View>
        ))}
        {money && amount !== null && amount > 0 && (
          <Text style={s.feeLine}>{t.svc.feeLine(fmt(serviceFee(def.fee, amount)))}</Text>
        )}
      </View>

      <Sheet visible={!!quote} title={t.svc.review} onClose={() => setQuote(null)}>
        {quote && (
          <>
            {quote.recipientName ? (
              <View style={s.nameBox}>
                <Avatar name={quote.recipientName} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={s.nameLbl}>{t.svc.accountName}</Text>
                  <Text style={s.nameVal}>{quote.recipientName}</Text>
                </View>
              </View>
            ) : null}
            {quote.lines.map((l) => <Row key={l.label} label={l.label} value={l.value} />)}
            {money && (
              <>
                <Row label={t.svc.fee} value={fmt(quote.fee)} />
                <Row label={t.svc.total} value={fmt(quote.total)} strong />
              </>
            )}
            <Button label={money ? t.svc.payWithPin : t.svc.sendWithPin} onPress={confirm} style={{ marginTop: 14 }} />
          </>
        )}
      </Sheet>
    </Screen>
  )
}

function FieldInput({ f, value, onChange, myNumber, upload, onPick, invalid }: {
  f: ServiceField; value: string; onChange: (v: string) => void; myNumber?: string; upload?: Upload; onPick: (how: 'camera' | 'photos') => void; invalid: boolean
}) {
  const t = useT()
  const L = useLocalized()
  const box = [s.input, invalid && s.inputBad]
  switch (f.type) {
    case 'select':
      return (
        <View style={{ gap: 8 }}>
          {f.options?.map((o) => {
            const on = value === o.value
            return (
              <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={[s.choice, on && s.choiceOn]}>
                <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.muted} />
                <Text style={[s.choiceText, { flex: 1 }]}>{L(o.label)}</Text>
                {o.amount !== undefined && <Text style={s.choicePrice}>{fmt(o.amount)}</Text>}
              </Pressable>
            )
          })}
        </View>
      )
    case 'checkbox':
      return (
        <View style={s.checkRow}>
          <Text style={[s.label, { flex: 1, marginBottom: 0 }]}>{L(f.label)}</Text>
          <Switch value={value === 'true'} onValueChange={(on) => onChange(on ? 'true' : '')} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel={L(f.label)} />
        </View>
      )
    case 'image':
      return (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {upload?.status === 'uploading' ? <ActivityIndicator color={colors.primary} />
            : upload?.status === 'done' ? <Text style={s.uploaded}>✓ {t.svc.photoAdded}</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => onPick('camera')} style={s.smallBtn}><Icon name="camera-outline" size={18} color={colors.primary} /><Text style={s.smallBtnText}>{t.svc.camera}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => onPick('photos')} style={s.smallBtn}><Icon name="images-outline" size={18} color={colors.primary} /><Text style={s.smallBtnText}>{t.svc.photos}</Text></Pressable>
        </View>
      )
    case 'phone':
      return (
        <View>
          <View style={[s.input, s.phoneBox, invalid && s.inputBad]}>
            <Text style={s.prefix}>+266</Text>
            <TextInput style={s.phoneInput} value={value} onChangeText={(v) => onChange(localNumber(v))} keyboardType="phone-pad" maxLength={20}
              placeholder={f.networks?.length === 1 && f.networks[0] === 'vodacom' ? '5xxx xxxx' : '6xxx xxxx'} placeholderTextColor={colors.muted} accessibilityLabel={L(f.label)} />
            <ContactPickButton onPick={(n) => onChange(n)} />
          </View>
          {f.ownNumber && myNumber ? (
            <Pressable accessibilityRole="button" onPress={() => onChange(myNumber.replace(/^\+266/, ''))} style={s.myNumber}>
              <Icon name="person-circle-outline" size={16} color={colors.primary} />
              <Text style={s.smallBtnText}>{t.svc.myNumber} · {maskMsisdn(myNumber)}</Text>
            </Pressable>
          ) : null}
        </View>
      )
    default:
      return (
        <TextInput style={box} value={value} onChangeText={onChange} accessibilityLabel={L(f.label)} placeholderTextColor={colors.muted}
          keyboardType={f.type === 'amount' ? 'decimal-pad' : f.type === 'number' ? 'number-pad' : 'default'}
          placeholder={f.type === 'amount' ? 'M 0.00' : f.type === 'date' ? 'YYYY-MM-DD' : undefined} maxLength={f.maxLength ?? (f.type === 'date' ? 10 : 200)}
          autoCapitalize={f.type === 'text' ? 'sentences' : 'none'} />
      )
  }
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && { fontWeight: '800', fontSize: 17 }, mono && { fontVariant: ['tabular-nums'] }]} selectable>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  footer: { paddingHorizontal: 16, paddingBottom: 20 },
  body: { padding: 16, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  desc: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  error: { fontSize: 12.5, color: colors.danger, marginTop: 4 },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 16, color: colors.text },
  inputBad: { borderColor: colors.danger },
  phoneBox: { flexDirection: 'row', alignItems: 'center' },
  prefix: { fontSize: 16, fontWeight: '600', color: colors.text, marginRight: 8 },
  phoneInput: { flex: 1, fontSize: 17, color: colors.text, letterSpacing: 1 },
  myNumber: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start', paddingVertical: 4 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  choicePrice: { fontSize: 15, color: colors.primary, fontWeight: '800' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  smallBtnText: { color: colors.primary, fontWeight: '600', fontSize: 13.5 },
  uploaded: { color: colors.success, fontWeight: '700', fontSize: 13.5, marginRight: 4 },
  feeLine: { fontSize: 13, color: colors.muted, marginTop: 4 },
  nameBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft, marginBottom: 10 },
  nameLbl: { fontSize: 12, color: colors.muted },
  nameVal: { fontSize: 16, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { fontSize: 14, color: colors.muted, flexShrink: 1 },
  rowValue: { fontSize: 15, color: colors.text, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 20 },
  doneTitle: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 14 },
  doneSub: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 6 },
})
