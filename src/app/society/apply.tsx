import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { SocietyApplication, SocietyApplySettings, SocietyKind } from '../../../shared/api'
import { KIND_LOOK } from '../../components/icons'
import { Button, Card, Header, Icon, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

const KINDS: SocietyKind[] = ['society', 'motselo', 'burial']
const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}

/**
 * Register a new society: the applicant becomes its first executive. EcoCash approves it in the portal, the
 * executives collect its Mokhatlo SIM at an Econet shop, and it then opens in Mekhatlo.
 */
export default function ApplySociety() {
  const t = useT()
  const moqoqo = useMoqoqo()
  const [settings, setSettings] = useState<SocietyApplySettings | null>(null)
  const [kind, setKind] = useState<SocietyKind>('society')
  const [name, setName] = useState('')
  const [contribution, setContribution] = useState('')
  const [executives, setExecutives] = useState<string[]>([''])
  const [approvals, setApprovals] = useState(2)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<SocietyApplySettings>('/v1/society-apply-settings').then(setSettings).catch(moqoqo.fail)
    // Loaded once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const others = executives.map((x) => x.trim()).filter(Boolean)
  const total = others.length + 1
  const needed = Math.min(approvals, total)
  const amount = Number(contribution)
  const ready = name.trim().length >= 2 && (kind !== 'motselo' || amount > 0)

  const setExecutive = (i: number, v: string) => setExecutives((xs) => xs.map((x, j) => (j === i ? v : x)))
  const removeExecutive = (i: number) => setExecutives((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : ['']))

  const submit = async () => {
    setBusy(true)
    try {
      await api<SocietyApplication>('/v1/society-applications', {
        body: { name: name.trim(), kind, contribution: amount > 0 ? amount : undefined, approvalsRequired: needed, executives: others },
      })
      moqoqo.toast(t.society.sent)
      router.back()
    } catch (e) {
      // The server names the problem ("Thabo is listed twice", "not registered for EcoCash").
      if (e instanceof ApiFailure && ['VALIDATION', 'CONFLICT', 'NOT_REGISTERED', 'NOT_FOUND'].includes(e.code)) moqoqo.toast(e.message)
      else moqoqo.fail(e)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <Screen><Header title={t.society.register} /><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>
  if (!settings.enabled) {
    return (
      <Screen>
        <Header title={t.society.register} />
        <View style={s.closed}>
          <Icon name="storefront-outline" size={56} color={colors.muted} />
          <Text style={s.closedText}>{t.society.closed}</Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen footer={<View style={s.footer}><Button label={t.society.submit} disabled={busy || !ready} onPress={submit} /></View>}>
      <Header title={t.society.register} />
      <Text style={s.intro}>{t.society.applyIntro}</Text>

      <Text style={s.label}>{t.society.kindLabel}</Text>
      <View style={s.kinds} accessibilityRole="radiogroup">
        {KINDS.map((k) => (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: kind === k }} onPress={() => setKind(k)} style={[s.kind, kind === k && s.kindOn]}>
            <Icon name={KIND_LOOK[k].icon} size={22} color={kind === k ? '#fff' : KIND_LOOK[k].color} />
            <Text style={[s.kindText, kind === k && { color: '#fff' }]}>{t.society.kinds[k]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.label}>{t.society.nameLabel}</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={60} accessibilityLabel={t.society.nameLabel} />

      <Text style={s.label}>{kind === 'motselo' ? t.society.contributionLabel : t.society.contributionOptional}</Text>
      <TextInput style={s.input} value={contribution} onChangeText={(v) => setContribution(cleanAmount(v))} keyboardType="decimal-pad" maxLength={9}
        placeholder="M 0.00" placeholderTextColor={colors.muted} accessibilityLabel={t.society.contributionLabel} />

      <Text style={s.label}>{t.society.executivesLabel}</Text>
      <Text style={s.hint}>{t.society.executivesHint}</Text>
      {executives.map((x, i) => (
        <View key={i} style={s.execRow}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={x} onChangeText={(v) => setExecutive(i, v)} placeholder={t.society.to}
            placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel={`${t.society.executivesLabel} ${i + 1}`} />
          <Pressable accessibilityRole="button" accessibilityLabel={t.society.removeExecutive} onPress={() => removeExecutive(i)} hitSlop={10}>
            <Icon name="close-circle" size={24} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      {executives.length < 9 && (
        <Pressable accessibilityRole="button" onPress={() => setExecutives((xs) => [...xs, ''])} style={s.add}>
          <Icon name="person-add" size={20} color={colors.primary} />
          <Text style={s.addText}>{t.society.addExecutive}</Text>
        </Pressable>
      )}

      <Text style={s.label}>{t.society.approvalsLabel}</Text>
      <Card style={s.stepper}>
        <Pressable accessibilityRole="button" accessibilityLabel="−" disabled={needed <= 1} onPress={() => setApprovals(needed - 1)} hitSlop={8}>
          <Icon name="remove-circle" size={32} color={needed <= 1 ? colors.border : colors.primary} />
        </Pressable>
        <Text style={s.count}>{needed}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="+" disabled={needed >= total} onPress={() => setApprovals(needed + 1)} hitSlop={8}>
          <Icon name="add-circle" size={32} color={needed >= total ? colors.border : colors.primary} />
        </Pressable>
      </Card>
      <Text style={s.hint}>{t.society.approvalsHint(needed, total)}</Text>

      <Card style={s.sim}>
        <Icon name="card" size={22} color={colors.primary} />
        <Text style={s.simText}>{settings.collectInstructions}</Text>
      </Card>
    </Screen>
  )
}

const s = StyleSheet.create({
  intro: { fontSize: 14.5, color: colors.muted, lineHeight: 21, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 8 },
  kinds: { flexDirection: 'row', gap: 8 },
  kind: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kindOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { fontSize: 13, fontWeight: '600', color: colors.text },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text, marginBottom: 4 },
  execRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  addText: { fontSize: 14.5, fontWeight: '600', color: colors.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 10, marginBottom: 8 },
  count: { fontSize: 24, fontWeight: '800', color: colors.text },
  sim: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 16, marginBottom: 24 },
  simText: { flex: 1, fontSize: 13.5, color: colors.text, lineHeight: 20 },
  footer: { paddingHorizontal: 16, paddingBottom: 20 },
  closed: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24, gap: 16 },
  closedText: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
})
