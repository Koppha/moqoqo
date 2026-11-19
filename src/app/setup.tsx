import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listenForCode } from '../../modules/sms-retriever'
import { OTP_LENGTH, type LoginResponse, type OnboardingIdentity, type OnboardingNext, type OnboardingOtpSent } from '../../shared/api'
import { Button, CircleIconButton, Icon } from '../components/ui'
import { useT } from '../i18n'
import { api, ApiFailure, errorCode } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { useAuth } from '../state/Auth'
import { colors, radius } from '../theme'
import { useKeyboardScroll } from '../components/useKeyboardScroll'

type Step = 'id' | 'confirm' | 'otp' | 'pin'

/**
 * Setting up EcoCash Super App on a phone (after number + EcoCash PIN): ID number → Home Affairs name → confirm name, date of
 * birth and gender → OTP by SMS → signed in, and this phone is the wallet's bound phone. Fingerprint/face is offered next.
 * Creating an EcoSure profile (the EcoSure app, `purpose=profile`): the SMS code first (already sent), then the ID and
 * details, then the person's own EcoSure PIN.
 */
export default function Setup() {
  const { id, msisdn, purpose, sentTo, resendAfter, devCode } = useLocalSearchParams<{
    id: string; msisdn: string; purpose?: 'profile'; sentTo?: string; resendAfter?: string; devCode?: string
  }>()
  const profile = purpose === 'profile'
  const t = useT()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardScroll()
  const { dispatch } = useAppState()
  const { completeSignIn } = useAuth()
  const [step, setStep] = useState<Step>(profile ? 'otp' : 'id')
  const [idNumber, setIdNumber] = useState('')
  const [name, setName] = useState('')
  const [isMe, setIsMe] = useState(false)
  const [dob, setDob] = useState({ d: '', m: '', y: '' })
  const [gender, setGender] = useState<'female' | 'male' | null>(null)
  const [otp, setOtp] = useState('')
  // Explicit consent before the app is registered on this phone (DFS guidelines 3.2.5). EcoSure profiles have their own terms.
  const [terms, setTerms] = useState(false)
  const needTerms = !profile && !terms
  // A profile's code went out when it started (on the sign-in screen).
  const [sent, setSent] = useState<OnboardingOtpSent | null>(profile && sentTo ? { sentTo, resendAfter: Number(resendAfter) || 30, ...(devCode ? { devCode } : {}) } : null)
  const [wait, setWait] = useState(profile ? Number(resendAfter) || 30 : 0)
  const [pin, setPin] = useState('')
  const [pinAgain, setPinAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  /** Runs a step; shows the server's reason when it refuses. Expired sign-ups go back to the number. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      const code = errorCode(e)
      if (code === 'NOT_FOUND' || code === 'CONFLICT' || (e instanceof ApiFailure && /expired|Start again/.test(e.message))) {
        dispatch({ type: 'toast', text: e instanceof ApiFailure ? e.message : t.errors.UNKNOWN })
        router.back()
        return
      }
      setError(e instanceof ApiFailure && e.message ? e.message : t.errors[code])
    } finally {
      setBusy(false)
    }
  }

  const lookUp = () => run(async () => {
    const r = await api<OnboardingIdentity>(`/v1/onboarding/${id}/identity`, { body: { idNumber } })
    setName(r.fullName)
    setStep('confirm')
  })

  const pad = (s: string) => s.padStart(2, '0')
  const dobText = `${dob.y}-${pad(dob.m)}-${pad(dob.d)}`
  const dobValid = /^\d{4}$/.test(dob.y) && Number(dob.m) >= 1 && Number(dob.m) <= 12 && Number(dob.d) >= 1 && Number(dob.d) <= 31

  const confirm = () => run(async () => {
    const r = await api<OnboardingOtpSent | OnboardingNext>(`/v1/onboarding/${id}/confirm`, { body: { nameConfirmed: isMe, dob: dobText, gender } })
    if ('next' in r) return setStep('pin')
    setSent(r)
    setWait(r.resendAfter)
    setStep('otp')
  })

  const resend = () => run(async () => {
    const r = await api<OnboardingOtpSent>(`/v1/onboarding/${id}/resend`, { method: 'POST' })
    setSent(r)
    setWait(r.resendAfter)
    setOtp('')
  })

  const verify = (code = otp) => run(async () => {
    const res = await api<LoginResponse | OnboardingNext>(`/v1/onboarding/${id}/verify`, { body: { otp: code, acceptTerms: profile ? undefined : terms } })
    if ('next' in res) return setStep('id')
    await completeSignIn(res)
    dispatch({ type: 'toast', text: t.setup.done })
  })

  const createPin = () => run(async () => {
    if (pin !== pinAgain) throw new ApiFailure('VALIDATION', t.setup.pinMismatch)
    const res = await api<LoginResponse>(`/v1/onboarding/${id}/pin`, { body: { pin } })
    await completeSignIn(res)
    dispatch({ type: 'toast', text: t.setup.profileDone })
  })

  // Android: the code SMS fills itself in (SMS Retriever, DFS guidelines 3.2.5b-iv) and is checked straight away once
  // the terms are accepted; listening restarts with each new code. iPhone offers it above the keyboard instead.
  const latest = useRef({ needTerms, busy, verify })
  useEffect(() => { latest.current = { needTerms, busy, verify } })
  useEffect(() => {
    if (step !== 'otp') return
    return listenForCode(OTP_LENGTH, (code) => {
      setOtp(code)
      const l = latest.current
      if (!l.needTerms && !l.busy) l.verify(code)
    })
  }, [step, sent])

  const order: Step[] = profile ? ['otp', 'id', 'confirm', 'pin'] : ['id', 'confirm', 'otp']
  const stepNo = order.indexOf(step) + 1
  // Back: to the details from the PIN is not possible once confirmed, nor to the code once it was right.
  const back = () => (step === 'confirm' ? setStep('id') : step === 'otp' && !profile ? setStep('confirm') : router.back())
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      <ScrollView {...keyboard} contentContainerStyle={[s.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <CircleIconButton icon="arrow-back" label={t.common.back} onPress={back} />
          <Text style={s.progress}>{t.setup.stepOf(stepNo, order.length)}</Text>
        </View>
        {profile && step === 'otp' ? <Text style={s.kicker}>{t.setup.profileTitle}</Text> : null}
        <Text style={s.title}>{step === 'id' ? t.setup.idTitle : step === 'confirm' ? t.setup.confirmTitle : step === 'pin' ? t.setup.pinTitle : t.setup.otpTitle}</Text>
        <Text style={s.sub}>{step === 'id' ? t.setup.idSub(msisdn ?? '') : step === 'confirm' ? t.setup.confirmSub : step === 'pin' ? t.setup.pinSub : (sent?.channel === 'email' ? t.setup.otpSubEmail(sent.sentTo) : t.setup.otpSub(sent?.sentTo ?? msisdn ?? ''))}</Text>

        {step === 'id' && (
          <>
            <Text style={s.label}>{t.setup.idNumber}</Text>
            <TextInput style={s.input} value={idNumber} onChangeText={(v) => setIdNumber(v.replace(/[^0-9A-Za-z]/g, '').slice(0, 20))} autoCapitalize="characters"
              autoCorrect={false} keyboardType="default" placeholder="9001010001" placeholderTextColor={colors.muted} accessibilityLabel={t.setup.idNumber} onSubmitEditing={lookUp} autoFocus />
            <Text style={s.hint}>{t.setup.idHint}</Text>
            <Button label={busy ? t.setup.checking : t.dialogs.continue} disabled={busy || idNumber.length < 6} onPress={lookUp} style={{ marginTop: 18 }} />
          </>
        )}

        {step === 'confirm' && (
          <>
            <View style={s.nameCard}>
              <Icon name="id-card" size={26} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.nameLbl}>{t.setup.homeAffairsName}</Text>
                <Text style={s.name}>{name}</Text>
              </View>
            </View>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isMe }} onPress={() => setIsMe(!isMe)} style={s.check}>
              <Icon name={isMe ? 'checkbox' : 'square-outline'} size={24} color={isMe ? colors.primary : colors.muted} />
              <Text style={s.checkText}>{t.setup.thisIsMe}</Text>
            </Pressable>

            <Text style={s.label}>{t.setup.dob}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.input, { flex: 1 }]} value={dob.d} onChangeText={(v) => setDob({ ...dob, d: v.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" placeholder={t.setup.day} placeholderTextColor={colors.muted} accessibilityLabel={t.setup.day} />
              <TextInput style={[s.input, { flex: 1 }]} value={dob.m} onChangeText={(v) => setDob({ ...dob, m: v.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" placeholder={t.setup.month} placeholderTextColor={colors.muted} accessibilityLabel={t.setup.month} />
              <TextInput style={[s.input, { flex: 1.4 }]} value={dob.y} onChangeText={(v) => setDob({ ...dob, y: v.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" placeholder={t.setup.year} placeholderTextColor={colors.muted} accessibilityLabel={t.setup.year} />
            </View>

            <Text style={s.label}>{t.setup.gender}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
              {(['female', 'male'] as const).map((g) => (
                <Pressable key={g} accessibilityRole="radio" accessibilityState={{ checked: gender === g }} onPress={() => setGender(g)} style={[s.choice, gender === g && s.choiceOn]}>
                  <Text style={[s.choiceText, gender === g && { color: '#fff' }]}>{g === 'female' ? t.setup.female : t.setup.male}</Text>
                </Pressable>
              ))}
            </View>
            <Button label={busy ? t.setup.checking : profile ? t.dialogs.continue : t.setup.sendCode} disabled={busy || !isMe || !dobValid || !gender} onPress={confirm} style={{ marginTop: 20 }} />
            <Text style={s.hint}>{t.setup.notMe}</Text>
          </>
        )}

        {step === 'otp' && (
          <>
            <TextInput style={[s.input, s.otp]} value={otp} maxLength={OTP_LENGTH} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode"
              placeholder="••••••" placeholderTextColor={colors.muted} accessibilityLabel={t.setup.otpTitle} autoFocus
              onChangeText={(v) => {
                const code = v.replace(/\D/g, '').slice(0, OTP_LENGTH)
                setOtp(code)
                if (code.length === OTP_LENGTH && !needTerms) verify(code)
              }} />
            {sent?.devCode ? <Text style={s.devCode}>{t.setup.devCode(sent.devCode)}</Text> : null}
            {!profile && (
              <View style={s.check}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: terms }} onPress={() => setTerms(!terms)} style={s.termsTick}>
                  <Icon name={terms ? 'checkbox' : 'square-outline'} size={24} color={terms ? colors.primary : colors.muted} />
                  <Text style={s.checkText}>{t.setup.acceptTerms}</Text>
                </Pressable>
                <Pressable accessibilityRole="link" onPress={() => router.push('/legal')} hitSlop={8}>
                  <Text style={s.resendText}>{t.setup.readTerms}</Text>
                </Pressable>
              </View>
            )}
            <Button label={busy ? t.setup.checking : t.setup.verify} disabled={busy || otp.length !== OTP_LENGTH || needTerms} onPress={() => verify()} style={{ marginTop: 16 }} />
            <Pressable accessibilityRole="button" disabled={wait > 0 || busy} onPress={resend} style={s.resend}>
              <Text style={[s.resendText, wait > 0 && { color: colors.muted }]}>{wait > 0 ? t.setup.resendIn(wait) : t.setup.resend}</Text>
            </Pressable>
          </>
        )}

        {step === 'pin' && (
          <>
            <Text style={s.label}>{t.setup.pinNew}</Text>
            <TextInput style={[s.input, s.otp]} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad"
              secureTextEntry maxLength={4} placeholder="••••" placeholderTextColor={colors.muted} accessibilityLabel={t.setup.pinNew} autoFocus />
            <Text style={s.label}>{t.setup.pinAgain}</Text>
            <TextInput style={[s.input, s.otp]} value={pinAgain} onChangeText={(v) => setPinAgain(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad"
              secureTextEntry maxLength={4} placeholder="••••" placeholderTextColor={colors.muted} accessibilityLabel={t.setup.pinAgain} onSubmitEditing={createPin} />
            <Button label={busy ? t.setup.checking : t.setup.createPin} disabled={busy || pin.length !== 4 || pinAgain.length !== 4} onPress={createPin} style={{ marginTop: 20 }} />
          </>
        )}

        {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 20, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progress: { fontSize: 13, fontWeight: '700', color: colors.muted },
  kicker: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 20 },
  sub: { fontSize: 14, color: colors.muted, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8, marginTop: 14 },
  input: { height: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 18, color: colors.text, fontWeight: '600' },
  otp: { textAlign: 'center', letterSpacing: 10, fontSize: 26 },
  hint: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
  nameCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  nameLbl: { fontSize: 12, color: colors.muted },
  name: { fontSize: 19, fontWeight: '800', color: colors.text, marginTop: 2 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingVertical: 6 },
  termsTick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkText: { fontSize: 15, color: colors.text, flex: 1 },
  choice: { flex: 1, height: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: 16, fontWeight: '600', color: colors.text },
  devCode: { textAlign: 'center', fontSize: 13, color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: radius.md, padding: 10, marginTop: 12 },
  resend: { alignSelf: 'center', paddingVertical: 14 },
  resendText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, marginTop: 14, textAlign: 'center' },
})
