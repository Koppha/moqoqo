import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { PinEntry } from '../components/PinEntry'
import { Avatar, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api, ApiFailure, errorCode } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { useAuth } from '../state/Auth'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors } from '../theme'

/** wallet: the EcoCash PIN (payments, *199#). app: the PIN that opens the app. open: open the app with the wallet PIN again. */
type Which = 'wallet' | 'app' | 'open'
type Step = 'current' | 'new' | 'repeat'

/**
 * Me › Self service › Change PIN: first which PIN, then current PIN, new PIN, new PIN again. The app PIN is optional:
 * until one is set, the EcoCash PIN opens the app; it can be dropped again (the EcoCash PIN opens the app).
 */
export default function ChangePin() {
  const t = useT()
  const { toast, fail } = useMoqoqo()
  const { session, updateUser } = useAuth()
  const hasAppPin = !!session?.user.appPin
  const [which, setWhich] = useState<Which | null>(null)
  const [step, setStep] = useState<Step>('current')
  const [current, setCurrent] = useState('')
  const [fresh, setFresh] = useState('')

  const choose = (w: Which) => {
    setWhich(w)
    setStep('current')
  }

  const done = (message: string, appPin: boolean | undefined) => {
    if (session && appPin !== undefined) updateUser({ ...session.user, appPin: appPin || undefined })
    toast(message)
    router.back()
  }

  const failed = (e: unknown) => {
    // Wrong current PIN: start again. Too easy a PIN: choose another.
    setStep(errorCode(e) === 'WRONG_PIN' || errorCode(e) === 'PIN_LOCKED' ? 'current' : 'new')
    if (e instanceof ApiFailure && errorCode(e) === 'VALIDATION' && e.message) toast(e.message)
    else fail(e)
    return false
  }

  const onPin = async (pin: string): Promise<boolean> => {
    if (step === 'current') {
      if (which === 'open') {
        try {
          await api('/v1/auth/remove-app-pin', { body: { currentPin: pin } })
          done(t.svc.appPinRemoved, false)
          return true
        } catch (e) {
          return failed(e)
        }
      }
      setCurrent(pin)
      setStep('new')
      return true
    }
    if (step === 'new') {
      setFresh(pin)
      setStep('repeat')
      return true
    }
    if (pin !== fresh) {
      toast(t.svc.pinMismatch)
      setStep('new')
      return false
    }
    try {
      await api(which === 'app' ? '/v1/auth/change-app-pin' : '/v1/auth/change-pin', { body: { currentPin: current, newPin: pin } })
      done(which === 'app' ? t.svc.appPinChanged : t.svc.pinChanged, which === 'app' ? true : undefined)
      return true
    } catch (e) {
      return failed(e)
    }
  }

  if (!which) {
    const rows: { key: Which; icon: 'wallet' | 'phone-portrait' | 'lock-open'; color: string; title: string; sub: string }[] = [
      { key: 'wallet', icon: 'wallet', color: '#5B2C9F', title: t.svc.walletPin[0], sub: t.svc.walletPin[1] },
      { key: 'app', icon: 'phone-portrait', color: '#0EA5E9', title: t.svc.appPin[0], sub: hasAppPin ? t.svc.appPin[1] : t.svc.appPinNone },
      ...(hasAppPin ? [{ key: 'open' as const, icon: 'lock-open' as const, color: '#6B7280', title: t.svc.appPinOff[0], sub: t.svc.appPinOff[1] }] : []),
    ]
    return (
      <Screen>
        <Header title={t.svc.changePin} />
        <Card style={{ paddingVertical: 4 }}>
          {rows.map((r, i) => (
            <ListRow key={r.key} last={i === rows.length - 1} onPress={() => choose(r.key)} left={<Avatar name={r.title} icon={r.icon} color={r.color} size={40} />}
              title={r.title} subtitle={r.sub} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
          ))}
        </Card>
      </Screen>
    )
  }

  // Which PIN to type first: the app PIN when there is one (app, open), else the EcoCash PIN.
  const currentTitle = which === 'wallet' ? t.svc.pinCurrentWallet : hasAppPin ? t.svc.pinCurrentApp : t.svc.pinCurrentWallet
  const title = step === 'current' ? currentTitle : step === 'new' ? t.svc.pinNew : t.svc.pinRepeat
  return (
    <Screen>
      <Header title={which === 'wallet' ? t.svc.walletPin[0] : which === 'app' ? t.svc.appPin[0] : t.svc.appPinOff[0]} />
      <View style={s.body}>
        <Text style={s.title}>{title}</Text>
        {step === 'new' && <Text style={s.hint}>{which === 'app' ? t.svc.appPinRule : t.svc.pinRule}</Text>}
        <PinEntry key={`${which}-${step}`} onComplete={onPin} />
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 20, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  title: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 12 },
  hint: { textAlign: 'center', fontSize: 13, color: colors.muted, marginTop: 6, marginHorizontal: 12 },
})
