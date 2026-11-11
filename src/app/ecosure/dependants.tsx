import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { ECOSURE_DEPENDANT_LIMIT, type EsAddMemberBody } from '../../../shared/api'
import { useMoqoqo } from '../../state/useMoqoqo'
import { ecosure } from '../../miniapps/ecosure/api'
import { useEcoSure } from '../../miniapps/ecosure/data'
import { maskDate, parseDate, relationName } from '../../miniapps/ecosure/format'
import { useEsT } from '../../miniapps/ecosure/strings'
import { es, esType, space } from '../../miniapps/ecosure/theme'
import { Card, EsIcon, EsScreen, Field, Loading, Notice, OutlineButton, PrimaryButton, Segmented } from '../../miniapps/ecosure/ui'

const RELATIONSHIPS: EsAddMemberBody['relationship'][] = ['spouse', 'child', 'parent', 'extended']

/** Who the policy covers: add spouse, children, parents or extended family (Family cover only). */
export default function Dependants() {
  const t = useEsT()
  const { toast, fail } = useMoqoqo()
  const { policy, policies, setPolicy } = useEcoSure()
  const [name, setName] = useState('')
  const [rel, setRel] = useState<EsAddMemberBody['relationship']>('child')
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)

  if (!policies) return <EsScreen title={t.dependantsTitle}><Loading /></EsScreen>
  if (!policy) {
    return (
      <EsScreen title={t.dependantsTitle}>
        <Notice text={t.noPolicy} />
        <PrimaryButton label={t.getCover} onPress={() => router.replace({ pathname: '/ecosure/quote/[product]', params: { product: 'funeral', cover: 'family' } })} />
      </EsScreen>
    )
  }
  const family = policy.cover === 'family'

  const add = async () => {
    if (!name.trim()) return Alert.alert(t.addDependant, t.nameNeeded)
    if (dob && !parseDate(dob)) return Alert.alert(t.addDependant, t.badDob)
    setBusy(true)
    try {
      setPolicy(await ecosure.addMember(policy.id, { name: name.trim(), relationship: rel, dob: dob ? parseDate(dob)! : undefined }))
      toast(t.added(name.trim()))
      setName('')
      setDob('')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string, who: string) =>
    Alert.alert(t.removeName(who), t.removeConfirm(who), [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.remove, style: 'destructive', onPress: async () => {
          try {
            setPolicy(await ecosure.removeMember(policy.id, id))
          } catch (e) {
            fail(e)
          }
        },
      },
    ])

  return (
    <EsScreen title={t.dependantsTitle} cta={family ? <PrimaryButton label={t.add} onPress={add} loading={busy} /> : undefined}>
      <Text style={esType.small}>{t.covered(policy.members.length, ECOSURE_DEPENDANT_LIMIT)}</Text>
      {policy.members.map((m) => (
        <Card key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: es.text }}>{m.name}</Text>
            <Text style={esType.small}>{relationName(m.relationship, t)}</Text>
          </View>
          {m.relationship !== 'main' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.removeName(m.name)} onPress={() => remove(m.id, m.name)}
              style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: es.border, alignItems: 'center', justifyContent: 'center' }}>
              <EsIcon name="close" size={18} color={es.danger} />
            </Pressable>
          ) : null}
        </Card>
      ))}
      {family ? (
        <>
          <Text style={[esType.h3, { marginTop: space(2) }]}>{t.addDependant}</Text>
          <Field label={t.fullName} placeholder={t.namePh} value={name} onChangeText={setName} autoCapitalize="words" />
          <Text style={esType.label}>{t.relationshipLabel}</Text>
          <Segmented options={RELATIONSHIPS.map((r) => ({ value: r, label: relationName(r, t) }))} value={rel} onChange={setRel} />
          <Field label={`${t.dob} ${t.optional}`} placeholder={t.dobPh} value={dob} onChangeText={(v) => setDob(maskDate(v))} keyboardType="number-pad" maxLength={10} />
        </>
      ) : (
        <>
          <Notice tone="info" text={t.familyOnly} />
          <OutlineButton label={t.switchToFamily} onPress={() => router.push('/ecosure/migrate')} />
        </>
      )}
    </EsScreen>
  )
}
