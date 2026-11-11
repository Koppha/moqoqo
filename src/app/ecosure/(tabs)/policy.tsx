import { router, type Href } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Sheet } from '../../../components/Sheet'
import { useMoqoqo } from '../../../state/useMoqoqo'
import { ecosure } from '../../../miniapps/ecosure/api'
import { funeralPackages, useEcoSure } from '../../../miniapps/ecosure/data'
import { coverName, maloti, normaliseMsisdn, relationName, showDate, statusName, statusTone } from '../../../miniapps/ecosure/format'
import { useEsT } from '../../../miniapps/ecosure/strings'
import { es, esRadius, esType, space } from '../../../miniapps/ecosure/theme'
import { Badge, Card, EsIcon, EsScreen, Field, Loading, Notice, OptionRow, OutlineButton, PrimaryButton, type EsIconName } from '../../../miniapps/ecosure/ui'

/** My policy: the details, who is covered, and everything you can change. */
export default function MyPolicy() {
  const t = useEsT()
  const { toast, fail } = useMoqoqo()
  const { policy, policies, products, error, refresh, setPolicy } = useEcoSure()
  const [sheet, setSheet] = useState<'package' | 'beneficiary' | null>(null)
  const [code, setCode] = useState('')
  const [benName, setBenName] = useState('')
  const [benMsisdn, setBenMsisdn] = useState('')
  const [busy, setBusy] = useState(false)

  if (!policies) {
    return <EsScreen title={t.tabs.policy} back={false}>{error ? <><Notice text={t.loadFailed} /><OutlineButton label={t.retry} onPress={refresh} /></> : <Loading />}</EsScreen>
  }
  if (!policy) {
    return (
      <EsScreen title={t.tabs.policy} back={false}>
        <Card style={{ alignItems: 'center', paddingVertical: space(8), gap: space(3) }}>
          <EsIcon name="shield" size={48} />
          <Text style={[esType.body, { textAlign: 'center' }]}>{t.noPolicy}</Text>
        </Card>
        <PrimaryButton label={t.getCover} onPress={() => router.push({ pathname: '/ecosure/quote/[product]', params: { product: 'funeral' } })} />
        <OutlineButton label={t.actions.quotes} onPress={() => router.push('/ecosure/quotes')} />
      </EsScreen>
    )
  }

  const packages = funeralPackages(products)
  const rows: [string, string][] = [
    [t.policyNumber, policy.number],
    [t.package, `${policy.packageName} ${coverName(policy.cover, t)}`],
    [t.premium, t.perMonth(maloti(policy.premium))],
    [t.nextDue, showDate(policy.nextDue)],
    [t.paymentOption, policy.sponsoredBy ? t.sponsoredBy(policy.sponsoredBy.name) : t.wallet],
    [t.beneficiary, policy.beneficiary?.name ?? t.noneYet],
  ]
  const actions: { label: string; icon: EsIconName; onPress: () => void }[] = [
    { label: t.actions.pay, icon: 'card', onPress: () => router.push('/ecosure/pay' as Href) },
    { label: t.actions.changePackage, icon: 'sliders', onPress: () => { setCode(policy.productCode); setSheet('package') } },
    { label: t.actions.changeBeneficiary, icon: 'heart', onPress: () => { setBenName(policy.beneficiary?.name ?? ''); setBenMsisdn((policy.beneficiary?.msisdn ?? '').replace(/^\+266/, '')); setSheet('beneficiary') } },
    { label: t.actions.dependants, icon: 'users', onPress: () => router.push('/ecosure/dependants') },
    { label: t.actions.sponsor, icon: 'heart', onPress: () => router.push('/ecosure/sponsor') },
    { label: t.actions.migrate, icon: 'swap', onPress: () => router.push('/ecosure/migrate') },
    { label: t.actions.quotes, icon: 'receipt', onPress: () => router.push('/ecosure/quotes') },
  ]

  const save = async (body: Parameters<typeof ecosure.update>[1], done: string) => {
    setBusy(true)
    try {
      setPolicy(await ecosure.update(policy.id, body))
      setSheet(null)
      toast(done)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EsScreen title={t.tabs.policy} back={false}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: es.text }}>{t.policyDetails}</Text>
          <Badge label={statusName(policy.status, t)} tone={statusTone(policy.status)} />
        </View>
        {rows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ color: es.textMuted }}>{k}</Text>
            <Text style={{ fontWeight: '700', color: es.text, flexShrink: 1, textAlign: 'right' }}>{v}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={{ fontSize: 15, fontWeight: '800', color: es.text }}>{t.members}</Text>
        {policy.members.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: es.text, fontWeight: '600' }}>{m.name}</Text>
            <Text style={esType.small}>{relationName(m.relationship, t)}</Text>
          </View>
        ))}
      </Card>

      {actions.map((a) => (
        <Pressable key={a.label} accessibilityRole="button" onPress={a.onPress}
          style={({ pressed }) => ({ minHeight: 56, borderWidth: 1, borderColor: es.border, borderRadius: esRadius.md, backgroundColor: es.surface, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space(4), opacity: pressed ? 0.8 : 1 })}>
          <EsIcon name={a.icon} size={20} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: es.text }}>{a.label}</Text>
          <EsIcon name="chevron" size={18} color={es.primary} />
        </Pressable>
      ))}

      <Sheet visible={sheet === 'package'} title={t.changePackageTitle} onClose={() => setSheet(null)}>
        <View style={{ gap: space(2.5) }}>
          {packages.map((p) => (
            <OptionRow key={p.code} title={p.name} value={t.perMonth(maloti(p.premium[policy.cover]))} selected={p.code === code} onPress={() => setCode(p.code)} />
          ))}
          <Text style={esType.small}>{t.priceNote}</Text>
          <PrimaryButton label={t.changePackageTitle} loading={busy} disabled={code === policy.productCode}
            onPress={() => save({ productCode: code }, t.packageChanged(packages.find((p) => p.code === code)?.name ?? ''))} />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'beneficiary'} title={t.actions.changeBeneficiary} onClose={() => setSheet(null)}>
        <View style={{ gap: space(3) }}>
          <Text style={esType.small}>{t.beneficiaryHint}</Text>
          <Field label={t.beneficiaryName} value={benName} onChangeText={setBenName} autoCapitalize="words" />
          <Field label={t.beneficiaryMobile} placeholder="6200 0021" keyboardType="phone-pad" value={benMsisdn} onChangeText={setBenMsisdn} />
          <PrimaryButton label={t.save} loading={busy} disabled={!benName.trim() || (!!benMsisdn.trim() && !normaliseMsisdn(benMsisdn))}
            onPress={() => save({ beneficiaryName: benName.trim(), beneficiaryMsisdn: benMsisdn.trim() ? normaliseMsisdn(benMsisdn)! : undefined }, t.beneficiarySaved)} />
        </View>
      </Sheet>
    </EsScreen>
  )
}
