import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import type { EsCover } from '../../../shared/api'
import { useMoqoqo } from '../../state/useMoqoqo'
import { ecosure } from '../../miniapps/ecosure/api'
import { funeralPackages, useEcoSure } from '../../miniapps/ecosure/data'
import { coverName, maloti } from '../../miniapps/ecosure/format'
import { useEsT } from '../../miniapps/ecosure/strings'
import { es, esRadius, esType, space } from '../../miniapps/ecosure/theme'
import { EsScreen, Loading, Notice, PrimaryButton } from '../../miniapps/ecosure/ui'

/** Migrate: Family ↔ Single on the same package. Continuity and waiting-period rules are TBC with the underwriter. */
export default function Migrate() {
  const t = useEsT()
  const { fail } = useMoqoqo()
  const { policy, policies, products, setPolicy } = useEcoSure()
  const [busy, setBusy] = useState(false)
  if (!policies) return <EsScreen title={t.migrateTitle}><Loading /></EsScreen>
  if (!policy) return <EsScreen title={t.migrateTitle}><Notice text={t.noPolicy} /></EsScreen>

  const pkg = funeralPackages(products).find((p) => p.code === policy.productCode)
  const to: EsCover = policy.cover === 'family' ? 'single' : 'family'
  const price = pkg?.terms[to] ? maloti(pkg.premium[to]) : '—'
  const dependants = policy.members.filter((m) => m.relationship !== 'main').length
  const option = to === 'single'
    ? { title: t.toSingle, sub: t.toSingleSub(price) }
    : { title: t.toFamily, sub: t.toFamilySub(price) }

  const go = async () => {
    setBusy(true)
    try {
      const p = await ecosure.migrate(policy.id, to)
      setPolicy(p)
      router.replace({ pathname: '/ecosure/done', params: { title: t.migrated, body: t.migratedBody(`${p.packageName} ${coverName(p.cover, t)}`, maloti(p.premium)) } })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EsScreen title={t.migrateTitle} cta={<PrimaryButton label={t.requestMigration} onPress={go} loading={busy} />}>
      <Text style={esType.body}>{t.currentCover}: <Text style={{ fontWeight: '700' }}>{policy.packageName} {coverName(policy.cover, t)}</Text></Text>
      <Pressable accessibilityRole="radio" accessibilityState={{ checked: true }}
        style={{ minHeight: 64, borderRadius: esRadius.md, borderWidth: 2, borderColor: es.primary, backgroundColor: es.lilac, padding: space(3.5), gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: es.primary }}>{option.title}</Text>
        <Text style={esType.small}>{option.sub}</Text>
      </Pressable>
      {to === 'single' && dependants > 0 ? <Notice tone="danger" text={t.willRemove(dependants)} /> : null}
      <Notice text={t.migrateNotice} />
    </EsScreen>
  )
}
