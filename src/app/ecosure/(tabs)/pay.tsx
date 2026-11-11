import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import type { EsPayment, EsPolicyLookup } from '../../../../shared/api'
import { fmt } from '../../../lib/format'
import { useAppState } from '../../../state/AppState'
import { useDialogs } from '../../../state/Dialogs'
import { useMoqoqo } from '../../../state/useMoqoqo'
import { ecosure } from '../../../miniapps/ecosure/api'
import { useEcoSure } from '../../../miniapps/ecosure/data'
import { coverName, maloti, normaliseMsisdn, showDate, statusName, statusTone } from '../../../miniapps/ecosure/format'
import { useEsT } from '../../../miniapps/ecosure/strings'
import { es, esType, space } from '../../../miniapps/ecosure/theme'
import { Badge, Card, EsScreen, Field, Notice, OptionRow, OutlineButton, PrimaryButton, Segmented } from '../../../miniapps/ecosure/ui'

/** Pay a premium for your own policy, or someone else's (by their number or ES- policy number), from the wallet. */
export default function Payments() {
  const params = useLocalSearchParams<{ ref?: string }>()
  const t = useEsT()
  const { state } = useAppState()
  const { askPin } = useDialogs()
  const { settled, fail } = useMoqoqo()
  const { policy, policies, refresh } = useEcoSure()
  // Until chosen: someone else's policy when opened for one (or when I have none), else mine.
  const [picked, setTab] = useState<'own' | 'other' | null>(null)
  const tab = picked ?? (params.ref || (policies && !policy) ? 'other' : 'own')
  const [ref, setRef] = useState(params.ref ?? '')
  const [other, setOther] = useState<EsPolicyLookup | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [months, setMonths] = useState(1)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<EsPayment[] | null>(null)

  useFocusEffect(useCallback(() => {
    let alive = true
    ecosure.payments().then((h) => { if (alive) setHistory(h) }, () => {})
    return () => { alive = false }
  }, []))

  const find = async () => {
    const q = /^es-/i.test(ref.trim()) ? ref.trim().toUpperCase() : normaliseMsisdn(ref)
    setNotFound(false)
    setOther(null)
    if (!q) return setNotFound(true)
    try {
      setOther(await ecosure.lookup(q))
    } catch {
      setNotFound(true)
    }
  }

  const target = tab === 'own' && policy
    ? { number: policy.number, premium: policy.premium, who: t.yourPolicy }
    : other ? { number: other.number, premium: other.premium, who: other.holderFirstName } : null
  const amount = target ? target.premium * months : 0

  const pay = async () => {
    if (!target) return
    const pin = await askPin({ amount, label: t.premiumPin(target.number) })
    if (!pin) return
    setBusy(true)
    try {
      const res = await ecosure.pay({ policyNumber: target.number, months, pin })
      settled(res.money)
      refresh()
      router.push({ pathname: '/ecosure/done', params: { title: t.paymentReceived, body: t.paymentBody(maloti(res.payment.amount), target.who, res.payment.receipt) } })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EsScreen title={t.tabs.pay} back={false}
      cta={target ? <PrimaryButton label={t.payAmount(maloti(amount))} onPress={pay} loading={busy} /> : undefined}>
      <Segmented options={[{ value: 'own' as const, label: t.ownPolicy }, { value: 'other' as const, label: t.otherPolicy }]} value={tab} onChange={setTab} />

      {tab === 'own' ? (
        policy ? (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: es.text }}>{policy.packageName} {coverName(policy.cover, t)}</Text>
              <Badge label={statusName(policy.status, t)} tone={statusTone(policy.status)} />
            </View>
            <Text style={esType.small}>{policy.number} · {t.nextDue} {showDate(policy.nextDue)}</Text>
          </Card>
        ) : (
          <>
            <Notice tone="info" text={t.noPolicy} />
            <OutlineButton label={t.getCover} onPress={() => router.push({ pathname: '/ecosure/quote/[product]', params: { product: 'funeral' } })} />
          </>
        )
      ) : (
        <>
          <Field label={t.otherRef} placeholder={t.otherPh} value={ref} onChangeText={(v) => { setRef(v); setOther(null) }} autoCapitalize="characters" onSubmitEditing={find} />
          <OutlineButton label={t.findPolicy} onPress={find} />
          <Text style={esType.small}>{t.privacy}</Text>
          {notFound ? <Notice tone="danger" text={t.policyNotFound} /> : null}
          {other ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: es.text }}>{t.payingFor(other.holderFirstName, other.packageName)}</Text>
                <Badge label={statusName(other.status, t)} tone={statusTone(other.status)} />
              </View>
              <Text style={esType.small}>{other.number} · {coverName(other.cover, t)} · {t.nextDue} {showDate(other.nextDue)}</Text>
            </Card>
          ) : null}
        </>
      )}

      {target ? (
        <>
          <Text style={esType.label}>{t.months}</Text>
          <Segmented options={[1, 2, 3].map((n) => ({ value: String(n), label: t.monthsN(n) }))} value={String(months)} onChange={(v) => setMonths(Number(v))} />
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: es.textSoft }}>{t.amountDue}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: es.primary }}>{maloti(amount)}</Text>
          </Card>
          <Text style={esType.label}>{t.payWith}</Text>
          <OptionRow title={t.wallet} sub={t.walletBalance(fmt(state.balance))} selected onPress={() => {}} />
        </>
      ) : null}

      <Text style={[esType.h3, { marginTop: space(2) }]}>{t.recent}</Text>
      {history && history.length === 0 ? <Text style={esType.small}>{t.noPayments}</Text> : null}
      {(history ?? []).map((h) => (
        <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: es.border, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: es.text, fontWeight: '600' }}>{showDate(h.createdAt)} · {h.policyNumber}</Text>
            <Text style={esType.small}>{h.receipt} · {t.monthsN(h.months)} · {h.payerName}</Text>
          </View>
          <Text style={{ fontWeight: '700', color: es.text }}>{maloti(h.amount)}</Text>
        </View>
      ))}
    </EsScreen>
  )
}
