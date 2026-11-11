// Get a quote, step 2: one product (or the funeral packages), built from its catalogue settings: price options,
// quote questions and the documents needed (uploaded here, one file each). Fixed-price products are priced at
// once; "quoted" products go to staff, who send the price to the EcoSure chat. The server always does the pricing.
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import type { EsCover, EsProduct } from '../../../../shared/api'
import { useAppState } from '../../../state/AppState'
import { useAuth } from '../../../state/Auth'
import { continueAfterSignIn } from '../../../lib/afterSignIn'
import { useMoqoqo } from '../../../state/useMoqoqo'
import { ecosure } from '../../../miniapps/ecosure/api'
import { useEcoSure } from '../../../miniapps/ecosure/data'
import { DocumentRow, useDocuments } from '../../../miniapps/ecosure/documents'
import { coverName, maloti, normaliseMsisdn, showDate } from '../../../miniapps/ecosure/format'
import { useEsT } from '../../../miniapps/ecosure/strings'
import { es, esType, space } from '../../../miniapps/ecosure/theme'
import { CATEGORY_ICON, Card, Checkbox, EsIcon, EsScreen, Field, Loading, Notice, OptionRow, OutlineButton, PackageCard, PrimaryButton, ProductHeader, Segmented } from '../../../miniapps/ecosure/ui'

type QuoteField = EsProduct['quoteFields'][number]

function Question({ f, value, onChange, optional }: { f: QuoteField; value: string; onChange: (v: string) => void; optional: string }) {
  const t = useEsT()
  const label = f.required ? f.label : `${f.label} ${optional}`
  if (f.type === 'yes_no' || (f.type === 'choice' && f.choices.length <= 3)) {
    const options = f.type === 'yes_no' ? [{ value: 'yes', label: t.yes }, { value: 'no', label: t.no }] : f.choices.map((c) => ({ value: c, label: c }))
    return (
      <View style={{ gap: 6 }}>
        <Text style={esType.label}>{label}</Text>
        <Segmented options={options} value={value} onChange={onChange} />
      </View>
    )
  }
  if (f.type === 'choice') {
    return (
      <View style={{ gap: space(2) }}>
        <Text style={esType.label}>{label}</Text>
        {f.choices.map((c) => <OptionRow key={c} title={c} selected={value === c} onPress={() => onChange(c)} />)}
      </View>
    )
  }
  return <Field label={label} value={value} onChangeText={onChange} keyboardType={f.type === 'number' ? 'numeric' : 'default'} />
}

/** For a guest: why and how to create a profile before a quote (the same sign-up as EcoCash Super App), then back here. */
function ProfileFirst({ buy }: { buy: boolean }) {
  const t = useEsT()
  return (
    <Card style={{ gap: space(3), borderColor: es.accent }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: es.accentBg, alignItems: 'center', justifyContent: 'center' }}>
          <EsIcon name="user" size={18} color={es.accent} />
        </View>
        <Text style={[esType.h3, { flex: 1 }]}>{t.guest.title}</Text>
      </View>
      <Text style={esType.body}>{buy ? t.guest.whyBuy : t.guest.whyQuote}</Text>
      {t.guest.steps.map((step, i) => (
        <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: es.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{i + 1}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 13, color: es.text }}>{step}</Text>
        </View>
      ))}
      <Text style={esType.small}>{t.guest.comeBack}</Text>
    </Card>
  )
}

export default function QuoteDetails() {
  const params = useLocalSearchParams<{ product: string; cover?: EsCover }>()
  const t = useEsT()
  const { state } = useAppState()
  const { fail } = useMoqoqo()
  const { products, policy, error, refresh } = useEcoSure()
  const isFuneral = params.product === 'funeral'
  const { docs, add, remove, busy } = useDocuments()
  // Before sign-in (the standalone EcoSure app): cover and prices only. A quote needs a profile: the guest creates
  // one first (the usual sign-up), then comes back to this quote to finish it.
  const guest = useAuth().status === 'signedOut'

  const funeral = useMemo(() => {
    const cheapest = (p: EsProduct) => Math.min(...p.options.map((o) => o.monthlyPremium))
    return (products ?? []).filter((p) => p.line === 'funeral').sort((a, b) => cheapest(a) - cheapest(b))
  }, [products])
  const [cover, setCover] = useState<EsCover>(params.cover === 'single' ? 'single' : 'family')
  const [pickedCode, setCode] = useState<string | null>(null)
  const [pickedOption, setOption] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  // Contact details: the profile's until the person types their own. (Signed in just now, after creating a profile
  // to get this quote, the profile arrives after the screen opened.)
  const [typedName, setName] = useState<string | null>(null)
  const [typedNumber, setNumber] = useState<string | null>(null)
  const name = typedName ?? state.me?.name ?? ''
  const number = typedNumber ?? (state.me?.msisdn ?? '').replace(/^\+266/, '')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)

  // Funeral starts on EcoSure Standard (or the first package); other products are the one in the link.
  const code = pickedCode ?? (isFuneral ? funeral.find((p) => p.code === 'FUN-STD')?.code ?? funeral[0]?.code : params.product)
  const product = products?.find((p) => p.code === code)
  const title = isFuneral ? t.funeralQuote : product ? t.productQuote(product.name) : t.quotesTitle

  if (error && !products) {
    return <EsScreen title={title}><Notice text={t.loadFailed} /><OutlineButton label={t.retry} onPress={refresh} /></EsScreen>
  }
  if (!products) return <EsScreen title={title}><Loading /></EsScreen>
  if (!product) {
    return (
      <EsScreen title={title}>
        <Notice title={t.notAvailable} text="" />
        <OutlineButton label={t.allCover} onPress={() => router.replace('/ecosure/quotes')} />
      </EsScreen>
    )
  }

  const option = isFuneral ? product.options.find((o) => o.cover === cover)?.label ?? '' : pickedOption
  const premium = product.pricing === 'fixed' ? product.options.find((o) => o.label === option)?.monthlyPremium : undefined
  const questions = product.quoteFields.filter((f) => f.type !== 'document')
  const documents = product.quoteFields.filter((f) => f.type === 'document')
  const quoted = product.pricing === 'quoted'

  /** Same checks as the server, so problems show before sending. '' = fine. */
  const check = () => {
    if (product.pricing === 'fixed' && premium === undefined) return t.chooseOption
    for (const f of questions) {
      const v = (answers[f.label] ?? '').trim()
      if (!v && f.required) return t.answer(f.label)
      if (v && f.type === 'number' && !(Number(v) >= 0)) return t.mustBeNumber(f.label)
    }
    if (busy) return t.waitUploads
    const missing = documents.find((f) => f.required && docs[f.label]?.status !== 'done')
    if (missing) return t.uploadDoc(missing.label)
    if (quoted) {
      if (!name.trim() || !number.trim()) return t.contactNeeded
      if (!normaliseMsisdn(number)) return t.badNumber
      if (!consent) return t.consentNeeded
    }
    return ''
  }

  const submit = async () => {
    const err = check()
    if (err) return Alert.alert(t.checkQuote, err)
    setSending(true)
    try {
      const q = await ecosure.quote({
        productCode: product.code,
        option: product.pricing === 'fixed' ? option : undefined,
        answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
        documents: Object.fromEntries(Object.entries(docs).filter(([, d]) => d.status === 'done').map(([label, d]) => [label, d.id!])),
        contactName: quoted ? name.trim() : undefined,
        msisdn: quoted ? normaliseMsisdn(number) ?? undefined : undefined,
        consent: quoted && consent,
      })
      const items = q.documents.map((d) => `${d.label}: ${d.fileName}`)
      router.push({
        pathname: '/ecosure/done',
        params: q.status === 'priced'
          ? { title: t.quoteReady, body: t.quoteReadyBody(`${q.productName}${q.option ? ` · ${q.option}` : ''}`, maloti(q.monthlyPremium ?? 0), q.reference, q.expiresAt ? showDate(q.expiresAt) : undefined), heading: items.length ? t.docsReceived : '', items: items.join('\n') }
          : { title: t.requestSent, body: t.requestSentBody(q.productName, q.reference), heading: items.length ? t.docsReceived : '', items: items.join('\n') },
      })
    } catch (e) {
      fail(e)
    } finally {
      setSending(false)
    }
  }

  // A guest creates a profile (or logs in) first; this quote opens again once they're in, to finish it.
  const onboard = () => {
    continueAfterSignIn({ pathname: '/ecosure/quote/[product]', params: { product: params.product, ...(isFuneral ? { cover } : {}) } })
    router.push('/login')
  }

  // Funeral: buy straight away (or, with cover already, change package from My policy).
  const cta = guest ? (
    <PrimaryButton label={t.guest.createProfile} arrow onPress={onboard} />
  ) : isFuneral ? (
    policy
      ? <PrimaryButton label={t.actions.changePackage} arrow onPress={() => router.push('/ecosure/policy')} />
      : <PrimaryButton label={t.buyThis} arrow disabled={premium === undefined}
          onPress={() => router.push({ pathname: '/ecosure/buy', params: { code: product.code, cover } })} />
  ) : (
    <PrimaryButton label={quoted ? t.sendRequest : t.getQuote} loading={sending} onPress={submit} />
  )

  return (
    <EsScreen title={title} cta={cta}>
      <ProductHeader icon={CATEGORY_ICON[product.category]} title={isFuneral ? t.funeralSection : product.name}
        text={isFuneral ? t.funeralBlurb : t.categories[product.category]} />

      {isFuneral ? (
        <>
          <View style={{ gap: space(2) }}>
            <Text style={esType.h3}>{t.coverType}</Text>
            <Segmented options={[{ value: 'family' as const, label: t.cover.family, icon: 'users' }, { value: 'single' as const, label: t.cover.single, icon: 'user' }]} value={cover} onChange={setCover} />
          </View>
          <Text style={esType.h3}>{t.package}</Text>
          {funeral.map((p) => {
            const price = p.options.find((o) => o.cover === cover)?.monthlyPremium
            return price === undefined ? null : (
              <PackageCard key={p.code} title={p.name} tagline={t.taglines[p.code]} price={t.perMonth(maloti(price))} selected={p.code === product.code} onPress={() => setCode(p.code)} />
            )
          })}
          {policy ? <Notice tone="info" text={`${t.myCover}: ${policy.packageName} ${coverName(policy.cover, t)} (${policy.number}).`} /> : null}
        </>
      ) : product.pricing === 'fixed' ? (
        <>
          <Text style={esType.label}>{t.chooseCover}</Text>
          {product.options.map((o) => (
            <OptionRow key={o.label} title={o.label} value={t.perMonth(maloti(o.monthlyPremium))} selected={o.label === option} onPress={() => setOption(o.label)} />
          ))}
        </>
      ) : null}

      {guest ? <ProfileFirst buy={isFuneral} /> : null}

      {!guest && questions.length ? (
        <>
          <Text style={esType.h3}>{isFuneral ? t.aFewQuestions : t.aboutCover}</Text>
          {questions.map((f) => (
            <Question key={f.label} f={f} optional={t.optional} value={answers[f.label] ?? ''} onChange={(v) => setAnswers({ ...answers, [f.label]: v })} />
          ))}
        </>
      ) : null}

      {product.pricing === 'fixed' ? (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 14, color: es.textSoft }}>{t.yourPremium}</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: es.primary }}>{premium !== undefined ? maloti(premium) : '—'}<Text style={esType.small}>{t.perMonthSuffix}</Text></Text>
        </Card>
      ) : (
        <Notice tone="info" title={t.pricedTitle} text={t.pricedText} />
      )}

      {!guest && documents.length ? (
        <Card>
          <Text style={esType.h3}>{t.documents}</Text>
          <Text style={esType.small}>{t.quoteDocsHint}</Text>
          {documents.map((f) => (
            <DocumentRow key={f.label} label={f.label} required={f.required || f.label.includes('(')} doc={docs[f.label]}
              onAdd={(how) => add(f.label, how)} onRemove={() => remove(f.label)} />
          ))}
        </Card>
      ) : null}

      {!guest && quoted ? (
        <View style={{ backgroundColor: es.lilac, borderRadius: 14, padding: space(4), gap: space(2.5) }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: es.primary }}>{t.contactTitle}</Text>
          <Field label={t.contactName} value={name} onChangeText={setName} />
          <Field label={t.contactMobile} placeholder="6200 0021" keyboardType="phone-pad" value={number} onChangeText={setNumber} />
          <Checkbox checked={consent} onToggle={() => setConsent(!consent)} label={t.consent} />
        </View>
      ) : null}
    </EsScreen>
  )
}
