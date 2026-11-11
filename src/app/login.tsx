import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMiniAppIcon } from '../components/MiniAppIcon'
import { PinEntry } from '../components/PinEntry'
import { Sheet } from '../components/Sheet'
import { Button, Icon } from '../components/ui'
import { useLightStatusBar } from '../components/useLightStatusBar'
import { LANGS, STRINGS, useLanguage, useT } from '../i18n'
import { FORM_MAX } from '../lib/layout'
import { checkPhone, getSimulateEconet, setSimulateEconet, type PhoneCheck } from '../lib/device'
import { apiUrl, CAN_CHANGE_SERVER, isDefaultServer, normaliseServer, setServer } from '../lib/server'
import { APP } from '../lib/variant'
import { useAuth } from '../state/Auth'
import { useAppState } from '../state/AppState'
import { localNumber, USERNAME_PATTERN } from '../../shared/api'
import { esGradients } from '../miniapps/ecosure/theme'
import { colors, gradients, radius } from '../theme'
import { useKeyboardScroll } from '../components/useKeyboardScroll'

const ECOSURE = APP === 'ecosure'

// Lesotho mobile numbers: 8 digits, Econet 6x / Vodacom 5x.
const VALID = /^[56]\d{7}$/

export default function Login() {
  const t = useT()
  // EcoSure's icon from the portal, when uploaded (EcoCash Super App and Business keep their built-in sign-in mark).
  const uploadedIcon = useMiniAppIcon('ecosure')
  const ecoSureIcon = ECOSURE ? uploadedIcon : null
  const { lang, setLang } = useLanguage()
  const { signIn, startEcoSureProfile } = useAuth()
  const { dispatch } = useAppState()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardScroll()
  useLightStatusBar()
  const [step, setStep] = useState<'number' | 'pin'>('number')
  const [number, setNumber] = useState('')
  const [touched, setTouched] = useState(false)
  /** Business app only: which kind of business account is signing in. */
  const [role, setRole] = useState<'merchant' | 'agent'>('merchant')
  const [serverOpen, setServerOpen] = useState(false)
  const [server, setServerText] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  // The SIM and connection: EcoCash Super App is set up on a phone only over Econet mobile data.
  const [phone, setPhone] = useState<PhoneCheck | null>(null)
  const [simulate, setSimulate] = useState(false)

  const recheck = () =>
    checkPhone().then((p) => {
      setPhone(p)
      if (p.econetNumber) setNumber((n) => n || p.econetNumber!)
    }, () => {})
  useEffect(() => {
    recheck()
    getSimulateEconet().then(setSimulate, () => {})
  }, [])

  /** Test builds: point the app at another server (a PC's Wi-Fi address changes), checked before it's saved. */
  const saveServer = async () => {
    const url = normaliseServer(server)
    if (!url) return setServerError(t.auth.serverBad)
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(`${url}/v1/app-config`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error()
    } catch {
      return setServerError(t.auth.serverUnreachable)
    }
    await setServer(url)
    setServerOpen(false)
    dispatch({ type: 'toast', text: t.auth.serverSaved(url) })
  }
  // Sign in with the number, or with the username chosen in Me.
  const [byName, setByName] = useState(false)
  const [username, setUsername] = useState('')
  const valid = byName ? USERNAME_PATTERN.test(username.replace(/^@/, '').toLowerCase()) : VALID.test(number)

  // The EcoSure app: create an EcoSure profile with the person's own PIN (or reset a forgotten one). An SMS code first.
  const [starting, setStarting] = useState(false)
  const createProfile = async () => {
    if (!VALID.test(number)) return setTouched(true)
    setStarting(true)
    const res = await startEcoSureProfile('+266' + number)
    setStarting(false)
    if (!res.ok) {
      if (res.code === 'NOT_ECONET') recheck()
      return dispatch({ type: 'toast', text: res.message ?? t.errors[res.code] })
    }
    const { onboarding: o, sent } = res.start
    router.push({ pathname: '/setup', params: { id: o.id, msisdn: o.msisdn, purpose: 'profile', sentTo: sent.sentTo, resendAfter: String(sent.resendAfter), devCode: sent.devCode ?? '' } })
    setStep('number')
  }

  const submitPin = async (pin: string) => {
    const res = await signIn(byName ? '@' + username.replace(/^@/, '') : '+266' + number, pin, APP === 'business' ? role : undefined)
    if (res.ok === 'setup') {
      // A phone this wallet isn't set up on: ID check and OTP first.
      router.push({ pathname: '/setup', params: { id: res.onboarding.id, msisdn: res.onboarding.msisdn } })
      setStep('number')
      return true
    }
    if (res.ok) return true
    if (res.code === 'NOT_ECONET') {
      dispatch({ type: 'toast', text: res.message ?? t.errors.NOT_ECONET })
      recheck()
      return false
    }
    // No EcoSure profile for this number yet: create it now (code, ID, their own PIN).
    if (res.code === 'PROFILE_NEEDED') {
      dispatch({ type: 'toast', text: t.errors.PROFILE_NEEDED })
      createProfile()
      return false
    }
    dispatch({ type: 'toast', text: t.errors[res.code] })
    if (res.code === 'NOT_REGISTERED' || res.code === 'WRONG_ROLE') setStep('number')
    return false
  }

  const demo = ECOSURE ? t.auth.demoEcoSure : APP !== 'business' ? t.auth.demo : role === 'merchant' ? t.auth.demoMerchant : t.auth.demoAgent

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      <ScrollView {...keyboard} contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={ECOSURE ? esGradients.hero : gradients.hero} start={{ x: 0, y: 0 }} end={ECOSURE ? { x: 1, y: 1 } : { x: 0.6, y: 1 }} style={[l.hero, { paddingTop: insets.top + 12 }]}>
          {/* The EcoSure app opens sign-in from its welcome page: a way back to it. */}
          {ECOSURE && router.canGoBack() && (
            <Pressable accessibilityRole="button" accessibilityLabel={t.common.back} onPress={() => router.back()} hitSlop={6}
              style={[l.back, { top: insets.top + 12 }]}>
              <Icon name="chevron-back" size={20} color="#fff" />
            </Pressable>
          )}
          <View style={l.langs}>
            {LANGS.map((code) => (
              <Pressable key={code} accessibilityRole="radio" accessibilityState={{ checked: code === lang }} accessibilityLabel={STRINGS[code].langName}
                onPress={() => setLang(code)} style={[l.lang, code === lang && l.langOn]}>
                <Text style={[l.langText, ECOSURE && l.onGradient, code === lang && l.langTextOn]}>{STRINGS[code].langName}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable disabled={!CAN_CHANGE_SERVER} onLongPress={() => { setServerText(apiUrl().replace(/^http:\/\//, '')); setServerError(null); setServerOpen(true) }}
            accessibilityLabel={CAN_CHANGE_SERVER ? t.auth.serverTitle : undefined} style={[l.logo, ECOSURE && l.logoGlass]}>
            {ecoSureIcon ? <Image source={{ uri: ecoSureIcon }} style={l.logoImage} accessibilityIgnoresInvertColors />
              : <Icon name={ECOSURE ? 'shield-checkmark' : 'chatbubbles'} size={34} color="#fff" />}
          </Pressable>
          <Text style={l.title}>{APP === 'business' ? t.auth.welcomeBusiness : APP === 'ecosure' ? t.auth.welcomeEcoSure : APP === 'society' ? t.auth.welcomeSociety : t.auth.welcome}</Text>
          <Text style={[l.tagline, ECOSURE && l.onGradient]}>{APP === 'business' ? t.auth.taglineBusiness : APP === 'ecosure' ? t.auth.taglineEcoSure : APP === 'society' ? t.auth.taglineSociety : t.auth.tagline}</Text>
        </LinearGradient>

        {step === 'number' ? (
          <View style={l.body}>
            {APP === 'business' && (
              <>
                <Text style={l.label}>{t.auth.signInAs}</Text>
                <View style={l.roles} accessibilityRole="radiogroup">
                  {(['merchant', 'agent'] as const).map((r) => (
                    <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: role === r }} onPress={() => setRole(r)} style={[l.role, role === r && l.roleOn]}>
                      <Icon name={r === 'merchant' ? 'storefront' : 'cash'} size={20} color={role === r ? '#fff' : colors.primary} />
                      <Text style={[l.roleText, role === r && l.roleTextOn]}>{r === 'merchant' ? t.auth.roleMerchant : t.auth.roleAgent}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <Text style={l.label}>{byName ? t.auth.username : ECOSURE ? t.auth.numberEcoSure : t.auth.number}</Text>
            {byName ? (
              <View style={[l.field, touched && !valid && l.fieldError]}>
                <Text style={l.prefix}>@</Text>
                <TextInput style={l.input} value={username} onChangeText={(v) => setUsername(v.replace(/\s/g, '').slice(0, 21))} onBlur={() => setTouched(true)}
                  onSubmitEditing={() => valid && setStep('pin')} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username"
                  placeholder="lerato.m" placeholderTextColor={colors.muted} accessibilityLabel={t.auth.username} autoFocus />
              </View>
            ) : (
            <View style={[l.field, touched && !valid && l.fieldError]}>
              <Text style={l.prefix}>+266</Text>
              <TextInput
                style={l.input}
                value={number}
                onChangeText={(v) => setNumber(localNumber(v))}
                onBlur={() => setTouched(true)}
                onSubmitEditing={() => valid && setStep('pin')}
                keyboardType="number-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                placeholder="6200 0021"
                placeholderTextColor={colors.muted}
                maxLength={20}
                accessibilityLabel={ECOSURE ? t.auth.numberEcoSure : t.auth.number}
                autoFocus
              />
            </View>
            )}
            {touched && !valid && <Text style={l.error}>{byName ? t.auth.invalidUsername : t.auth.invalidNumber}</Text>}
            <Pressable accessibilityRole="button" onPress={() => { setByName(!byName); setTouched(false) }} style={{ alignSelf: 'flex-start', paddingVertical: 8 }}>
              <Text style={l.changeLink}>{byName ? t.auth.useNumber : t.auth.useUsername}</Text>
            </Pressable>
            {phone && (
              <Pressable accessibilityRole="button" onPress={recheck} style={[l.simRow, phone.problem && l.simRowBad]}>
                <Icon name={phone.problem ? 'alert-circle' : 'checkmark-circle'} size={18} color={phone.problem ? '#B45309' : colors.success} />
                <Text style={[l.simText, phone.problem && { color: '#92400E' }]}>
                  {simulate ? t.setup.simulated : phone.problem ? t.setup.problem[phone.problem] : phone.econetNumber ? t.setup.simFound : t.setup.onEconet}
                </Text>
              </Pressable>
            )}
            {/* Test builds on an emulator (Wi-Fi, test SIM): one tap instead of the switch behind a long-press on the logo. */}
            {CAN_CHANGE_SERVER && phone?.problem && !simulate && (
              <Pressable accessibilityRole="button" onPress={async () => { await setSimulateEconet(true); setSimulate(true); recheck() }} style={{ alignSelf: 'flex-start', paddingVertical: 8 }}>
                <Text style={l.changeLink}>{t.setup.simulateLink}</Text>
              </Pressable>
            )}
            <Button label={t.dialogs.continue} disabled={!valid} onPress={() => setStep('pin')} style={{ marginTop: 20 }} />
            {ECOSURE && !byName && (
              <Pressable accessibilityRole="button" disabled={starting} onPress={createProfile} style={{ alignSelf: 'center', paddingVertical: 14 }}>
                <Text style={[l.changeLink, { textAlign: 'center' }]}>{starting ? t.setup.checking : t.auth.createProfile}</Text>
              </Pressable>
            )}
            <Text style={l.demo}>{demo}</Text>
          </View>
        ) : (
          <View style={l.body}>
            {APP === 'business' && <Text style={l.pinRole}>{t.auth.signInAs} {role === 'merchant' ? t.auth.roleMerchant : t.auth.roleAgent}</Text>}
            <Text style={l.pinTitle}>{ECOSURE ? t.auth.enterEcoSurePin : t.auth.enterPin}</Text>
            <Pressable accessibilityRole="button" onPress={() => setStep('number')} style={l.change}>
              <Text style={l.changeNumber}>{byName ? '@' + username.replace(/^@/, '').toLowerCase() : `+266 ${number.slice(0, 4)} ${number.slice(4)}`}</Text>
              <Text style={l.changeLink}>{t.auth.changeNumber}</Text>
            </Pressable>
            <PinEntry onComplete={submitPin} />
            <Text style={l.demo}>{demo}</Text>
          </View>
        )}
      </ScrollView>
      <Sheet typing visible={serverOpen} title={t.auth.serverTitle} onClose={() => setServerOpen(false)}>
        <Text style={l.serverHint}>{t.auth.serverHint}</Text>
        <TextInput style={[l.field, l.serverInput]} value={server} onChangeText={(v) => { setServerText(v); setServerError(null) }}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="192.168.1.5:4100" placeholderTextColor={colors.muted}
          accessibilityLabel={t.auth.serverTitle} onSubmitEditing={saveServer} />
        {serverError && <Text style={l.error}>{serverError}</Text>}
        <Button label={t.auth.serverTest} onPress={saveServer} />
        {!isDefaultServer() && <Button label={t.auth.serverReset} variant="ghost" onPress={async () => { await setServer(null); setServerOpen(false) }} />}
        <View style={l.simulate}>
          <Text style={[l.serverHint, { flex: 1, marginBottom: 0 }]}>{t.setup.simulate}</Text>
          <Switch value={simulate} onValueChange={async (on) => { await setSimulateEconet(on); setSimulate(on); recheck() }}
            trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel={t.setup.simulate} />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  )
}

const l = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingBottom: 28, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, alignItems: 'center' },
  langs: { alignSelf: 'flex-end', flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.pill, padding: 3 },
  lang: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  langOn: { backgroundColor: '#fff' },
  langText: { color: colors.heroMuted, fontSize: 13, fontWeight: '600' },
  langTextOn: { color: colors.primary },
  logo: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  // The EcoSure app signs in under EcoSure's own blue-to-purple header.
  logoImage: { width: 72, height: 72, borderRadius: 36 },
  logoGlass: { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  onGradient: { color: 'rgba(255,255,255,0.85)' },
  back: { position: 'absolute', left: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  title: { color: colors.heroText, fontSize: 24, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  tagline: { color: colors.heroMuted, fontSize: 14, marginTop: 6, textAlign: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 24, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8 },
  roles: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  role: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  roleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  roleTextOn: { color: '#fff' },
  pinRole: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.primary, marginBottom: 6 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, height: 58 },
  fieldError: { borderColor: '#DC2626' },
  prefix: { fontSize: 18, fontWeight: '600', color: colors.text, marginRight: 10 },
  input: { flex: 1, fontSize: 20, fontWeight: '600', color: colors.text, letterSpacing: 1.5 },
  error: { color: '#DC2626', fontSize: 13, marginTop: 6 },
  serverHint: { fontSize: 13, color: colors.muted, marginBottom: 12, lineHeight: 18 },
  serverInput: { fontSize: 17, color: colors.text, fontWeight: '600' },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: '#ECFDF5' },
  simRowBad: { backgroundColor: '#FEF3C7' },
  simText: { flex: 1, fontSize: 13, color: '#065F46' },
  simulate: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  demo: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 18 },
  pinTitle: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  change: { alignItems: 'center', marginTop: 6 },
  changeNumber: { fontSize: 15, color: colors.text },
  changeLink: { fontSize: 13, color: colors.primary, fontWeight: '600', marginTop: 2 },
})
