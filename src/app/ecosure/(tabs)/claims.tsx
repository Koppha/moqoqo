import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import type { EsCauseOfDeath, EsClaim } from '../../../../shared/api'
import { useDialogs } from '../../../state/Dialogs'
import { useMoqoqo } from '../../../state/useMoqoqo'
import { ecosure } from '../../../miniapps/ecosure/api'
import { useEcoSure } from '../../../miniapps/ecosure/data'
import { DocumentRow, useDocuments } from '../../../miniapps/ecosure/documents'
import { claimStatusName, maloti, maskDate, parseDate, relationName, showDate } from '../../../miniapps/ecosure/format'
import { useEsT } from '../../../miniapps/ecosure/strings'
import { es, esType, space } from '../../../miniapps/ecosure/theme'
import { Badge, Card, EsScreen, Field, Loading, Notice, OptionRow, OutlineButton, PrimaryButton, Segmented } from '../../../miniapps/ecosure/ui'

const CAUSES: EsCauseOfDeath[] = ['natural', 'unnatural', 'undetermined']

/** Documents for this cause: every document not tied to a cause, plus the one for the chosen cause. */
const claimDocuments = (all: string[], cause: EsCauseOfDeath | '') =>
  all.filter((d) => !/cause\)$/i.test(d) || (cause && d.toLowerCase().includes(`(${cause} cause)`)))

export default function Claims() {
  const t = useEsT()
  const { askPin } = useDialogs()
  const { fail } = useMoqoqo()
  const { policy, products, policies } = useEcoSure()
  const [tab, setTab] = useState<'submit' | 'track'>('submit')
  const [memberId, setMemberId] = useState('')
  const [date, setDate] = useState('')
  const [cause, setCause] = useState<EsCauseOfDeath | ''>('')
  const [busy, setBusy] = useState(false)
  const [claims, setClaims] = useState<EsClaim[] | null>(null)
  const { docs, add, remove, busy: uploading } = useDocuments()

  useFocusEffect(useCallback(() => {
    let alive = true
    ecosure.claims().then((c) => { if (alive) setClaims(c) }, () => { if (alive) setClaims([]) })
    return () => { alive = false }
  }, []))

  const product = products?.find((p) => p.code === policy?.productCode)
  const required = claimDocuments(product?.claimDocuments ?? [], cause)
  const canClaim = !!policy && (policy.status === 'active' || policy.status === 'grace')

  const submit = async () => {
    if (!policy) return
    if (!memberId || !date || !cause) return Alert.alert(t.submitClaim, t.claimMissing)
    const iso = parseDate(date)
    if (!iso) return Alert.alert(t.submitClaim, t.badDeathDate)
    if (uploading) return Alert.alert(t.submitClaim, t.waitUploads)
    const missing = required.find((d) => docs[d]?.status !== 'done')
    if (missing) return Alert.alert(t.submitClaim, t.uploadDoc(missing))
    const pin = await askPin({ label: t.claimPin })
    if (!pin) return
    setBusy(true)
    try {
      const claim = await ecosure.claim({
        policyId: policy.id, memberId, dateOfDeath: iso, cause,
        documents: required.map((label) => ({ label, uploadId: docs[label]!.id! })), pin,
      })
      setMemberId('')
      setDate('')
      setCause('')
      router.push({ pathname: '/ecosure/done', params: { title: t.claimSubmitted, body: t.claimSubmittedBody(claim.reference) } })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EsScreen title={t.tabs.claims} back={false}
      cta={tab === 'submit' && canClaim ? <PrimaryButton label={t.submitClaim} onPress={submit} loading={busy} /> : undefined}>
      <Segmented options={[{ value: 'submit' as const, label: t.submitTab }, { value: 'track' as const, label: t.trackTab }]} value={tab} onChange={setTab} />

      {tab === 'submit' ? (
        !policies ? <Loading /> : !canClaim ? (
          <>
            <Notice text={t.needPolicy} />
            {!policy ? <OutlineButton label={t.getCover} onPress={() => router.push({ pathname: '/ecosure/quote/[product]', params: { product: 'funeral' } })} /> : null}
          </>
        ) : (
          <>
            <Text style={esType.label}>{t.claimType}</Text>
            <OptionRow title={t.funeral} selected onPress={() => {}} />
            <Text style={esType.label}>{t.deceased}</Text>
            <View style={{ gap: space(2) }}>
              {policy.members.map((m) => (
                <OptionRow key={m.id} title={m.name} value={relationName(m.relationship, t)} selected={memberId === m.id} onPress={() => setMemberId(m.id)} />
              ))}
            </View>
            <Field label={t.dateOfDeath} placeholder={t.dobPh} value={date} onChangeText={(v) => setDate(maskDate(v))} keyboardType="number-pad" maxLength={10} />
            <Text style={esType.label}>{t.cause}</Text>
            <Segmented options={CAUSES.map((c) => ({ value: c, label: t.causes[c] }))} value={cause} onChange={setCause} />
            <Card>
              <Text style={esType.h3}>{t.documents}</Text>
              <Text style={esType.small}>{t.claimDocsHint}</Text>
              {required.map((d) => (
                <DocumentRow key={d} label={d} required doc={docs[d]} onAdd={(how) => add(d, how)} onRemove={() => remove(d)} />
              ))}
            </Card>
          </>
        )
      ) : !claims ? <Loading /> : claims.length === 0 ? (
        <Text style={[esType.small, { textAlign: 'center', marginTop: space(6) }]}>{t.noClaims}</Text>
      ) : (
        claims.map((c) => (
          <Card key={c.id} style={{ gap: space(3) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: es.text }}>{c.reference}</Text>
              <Badge label={claimStatusName(c.status, t)} tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'} />
            </View>
            <Text style={esType.small}>{c.member.name} · {relationName(c.member.relationship, t)} · {showDate(c.dateOfDeath)}</Text>
            {c.payout !== undefined && c.status === 'approved' ? <Text style={{ fontWeight: '700', color: es.success }}>{t.payout(maloti(c.payout))}</Text> : null}
            {c.reason ? <Notice tone={c.status === 'rejected' ? 'danger' : 'info'} text={c.reason} /> : null}
            {c.steps.map((s) => (
              <View key={s.label} style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: s.done ? es.successDot : 'transparent', borderWidth: s.done ? 0 : 2, borderColor: es.lilacMuted }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: es.text }}>{s.label}</Text>
                  {s.at ? <Text style={esType.small}>{showDate(s.at)}</Text> : null}
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
    </EsScreen>
  )
}
