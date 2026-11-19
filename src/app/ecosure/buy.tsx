// Create a policy (EcoSure "Register and buy"): 1 Ts&Cs, 2 your details, 3 package, 4 pay. The policy is only
// created once the first premium is paid from the wallet (EcoSure tech spec F03); the server does both at once.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import type { EsCover } from '../../../shared/api'
import { fmt } from '../../lib/format'
import { useAppState } from '../../state/AppState'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { ecosure } from '../../miniapps/ecosure/api'
import { defaultPackage, funeralPackages, packagesFor, useEcoSure } from '../../miniapps/ecosure/data'
import { coverName, maloti, maskDate, normaliseMsisdn, parseDate } from '../../miniapps/ecosure/format'
import { useEsT } from '../../miniapps/ecosure/strings'
import { useLocalized } from '../../lib/services'
import { es, esType, space } from '../../miniapps/ecosure/theme'
import { Card, Checkbox, EsIcon, EsScreen, Field, Loading, Notice, OptionRow, PrimaryButton, Segmented } from '../../miniapps/ecosure/ui'

type Step = 1 | 2 | 3 | 4

export default function BuyCover() {
  const params = useLocalSearchParams<{ code?: string; cover?: EsCover }>()
  const t = useEsT()
  const { state } = useAppState()
  const { askPin } = useDialogs()
  const { settled, fail } = useMoqoqo()
  const { products, content, setPolicy } = useEcoSure()
  const loc = useLocalized()
  const packages = funeralPackages(products)
  const [step, setStep] = useState<Step>(1)
  const [accepted, setAccepted] = useState(false)
  const [d, setD] = useState({ idNumber: '', fullName: state.me?.name ?? '', dob: '', gender: '' as '' | 'female' | 'male', beneficiaryName: '', beneficiaryMsisdn: '' })
  const [cover, setCover] = useState<EsCover>(params.cover === 'single' ? 'single' : 'family')
  const [code, setCode] = useState(params.code ?? null)
  const [paying, setPaying] = useState(false)

  if (!products) return <EsScreen title={t.step(step)}><Loading /></EsScreen>
  const offered = packagesFor(packages, cover)
  const pkg = offered.find((p) => p.code === code) ?? defaultPackage(offered) ?? packages[0]
  const terms = content ? loc(content.terms) : null
  const premium = pkg.premium[cover]
  const set = (k: keyof typeof d) => (v: string) => setD({ ...d, [k]: v })
  const back = () => (step === 1 ? router.back() : setStep((step - 1) as Step))

  const next = async () => {
    if (step === 1) {
      if (!terms) return
      if (!accepted) return Alert.alert(t.terms, t.mustAgree)
      return setStep(2)
    }
    if (step === 2) {
      if (!d.idNumber.trim() || !d.fullName.trim() || !d.dob || !d.gender) return Alert.alert(t.details, t.missingDetails)
      if (!parseDate(d.dob)) return Alert.alert(t.details, t.badDob)
      if (d.beneficiaryMsisdn.trim() && !normaliseMsisdn(d.beneficiaryMsisdn)) return Alert.alert(t.beneficiary, t.badNumber)
      return setStep(3)
    }
    if (step === 3) {
      if (pkg.terms[cover]?.beneficiaryRequired && !d.beneficiaryName.trim()) {
        Alert.alert(t.beneficiary, t.needsBeneficiary)
        return setStep(2)
      }
      return setStep(4)
    }
    const pin = await askPin({ amount: premium, label: `${pkg.name} · ${coverName(cover, t)}` })
    if (!pin) return
    setPaying(true)
    try {
      const res = await ecosure.buy({
        productCode: pkg.code, cover, idNumber: d.idNumber.trim(), fullName: d.fullName.trim(), dob: parseDate(d.dob)!,
        gender: d.gender as 'female' | 'male', beneficiaryName: d.beneficiaryName.trim() || undefined,
        beneficiaryMsisdn: d.beneficiaryMsisdn.trim() ? normaliseMsisdn(d.beneficiaryMsisdn)! : undefined, acceptedTerms: true, pin,
      })
      settled(res.money)
      setPolicy(res.policy)
      router.replace({
        pathname: '/ecosure/done',
        params: { title: t.registered, body: t.registeredBody(`${res.policy.packageName} ${coverName(res.policy.cover, t)}`, res.policy.number, res.payment.receipt) },
      })
    } catch (e) {
      fail(e)
    } finally {
      setPaying(false)
    }
  }

  const ctaLabel = step === 4 ? t.payAmount(maloti(premium)) : step === 1 ? t.continue : t.next
  return (
    <EsScreen title={t.step(step)} onBack={back} cta={<PrimaryButton label={ctaLabel} onPress={next} loading={paying} />}>
      {step === 1 ? (
        <>
          <Text style={esType.h2}>{t.terms}</Text>
          <Card><Text style={{ fontSize: 14, lineHeight: 22, color: es.textSoft }}>{terms ?? '…'}</Text></Card>
          <Checkbox checked={accepted} onToggle={() => setAccepted(!accepted)} label={t.agree} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={esType.h2}>{t.details}</Text>
          <Field label={t.idNumber} value={d.idNumber} onChangeText={set('idNumber')} autoCapitalize="characters" />
          <Notice text={t.idNotice} />
          <Field label={t.fullName} placeholder={t.asOnId} value={d.fullName} onChangeText={set('fullName')} autoCapitalize="words" />
          <Field label={t.dob} placeholder={t.dobPh} value={d.dob} onChangeText={(v) => set('dob')(maskDate(v))} keyboardType="number-pad" maxLength={10} />
          <Text style={esType.label}>{t.gender}</Text>
          <Segmented options={[{ value: 'female' as const, label: t.female }, { value: 'male' as const, label: t.male }]} value={d.gender} onChange={set('gender')} />
          <Field label={t.mobile} value={state.me?.msisdn ?? ''} editable={false} />
          <View style={{ gap: 4, marginTop: space(2) }}>
            <Text style={esType.h3}>{t.beneficiary}</Text>
            <Text style={esType.small}>{t.beneficiaryHint}</Text>
          </View>
          <Field label={t.beneficiaryName} value={d.beneficiaryName} onChangeText={set('beneficiaryName')} autoCapitalize="words" />
          <Field label={t.beneficiaryMobile} placeholder="6200 0021" value={d.beneficiaryMsisdn} onChangeText={set('beneficiaryMsisdn')} keyboardType="phone-pad" />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Text style={esType.label}>{t.coverType}</Text>
          <Segmented options={[{ value: 'family' as const, label: t.cover.family, icon: 'users' }, { value: 'single' as const, label: t.cover.single, icon: 'user' }]} value={cover} onChange={setCover} />
          <Text style={esType.label}>{t.package}</Text>
          {offered.map((p) => (
            <OptionRow key={p.code} title={p.name} value={t.perMonth(maloti(p.premium[cover]))} selected={p.code === pkg.code} onPress={() => setCode(p.code)}
              sub={p.terms[cover]?.sumAssured ? t.coverTerms(maloti(p.terms[cover]!.sumAssured!), p.terms[cover]!.waitingMonths) : undefined} />
          ))}
          <Text style={esType.small}>{t.priceNote}</Text>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Text style={esType.h2}>{t.payConfirm}</Text>
          <Card>
            <Text style={esType.small}>{t.summary}</Text>
            <Text style={{ fontSize: 17, fontWeight: '700', color: es.text }}>{pkg.name} · {coverName(cover, t)}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: es.primary }}>{t.perMonth(maloti(premium))}</Text>
            {pkg.terms[cover]?.sumAssured ? <Text style={esType.small}>{t.coverTerms(maloti(pkg.terms[cover]!.sumAssured!), pkg.terms[cover]!.waitingMonths)}</Text> : null}
            <Text style={esType.small}>{d.fullName} · {d.dob}{d.beneficiaryName ? ` · ${t.beneficiary}: ${d.beneficiaryName}` : ''}</Text>
          </Card>
          <Text style={esType.label}>{t.payWith}</Text>
          <OptionRow title={t.wallet} sub={t.walletBalance(fmt(state.balance))} selected onPress={() => {}} />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <EsIcon name="shield" size={18} color={es.textMuted} />
            <Text style={[esType.small, { flex: 1 }]}>{t.payNote}</Text>
          </View>
        </>
      ) : null}
    </EsScreen>
  )
}
