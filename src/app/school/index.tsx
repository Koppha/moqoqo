import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen } from '../../components/ui'
import { OTHER_SCHOOL, SCHOOLS, currentTerm, schoolAccount, schoolName, type Term } from '../../data/schools'
import { useT } from '../../i18n'
import { fmt } from '../../lib/format'
import { addFeeDates } from '../../lib/schoolCalendar'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

/** A learner paid for before, kept on this phone (not secret, but SecureStore is what the app already uses). */
interface Learner { school: string; other: string; name: string; number: string; amount: string }
const KEY = 'moqoqo.school.learners'
const MAX_LEARNERS = 5

async function loadLearners(): Promise<Learner[]> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(KEY)) ?? '[]')
  } catch {
    return []
  }
}

async function rememberLearner(l: Learner) {
  const rest = (await loadLearners()).filter((x) => !(x.school === l.school && x.number === l.number))
  await SecureStore.setItemAsync(KEY, JSON.stringify([l, ...rest].slice(0, MAX_LEARNERS))).catch(() => {})
}

/**
 * School fees: pick the school and the learner, then pay now with the PIN, or ask someone to pay it for you
 * (Ntefelle: the money goes straight to the school). The term due dates can go in the phone's calendar.
 */
export default function SchoolFees() {
  const t = useT()
  const { paySchool, toast } = useMoqoqo()
  const [learners, setLearners] = useState<Learner[]>([])
  const [school, setSchool] = useState(SCHOOLS[0].code)
  const [other, setOther] = useState('')
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [term, setTerm] = useState<Term>(currentTerm())
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = (l: Learner) => {
    setSchool(l.school)
    setOther(l.other)
    setName(l.name)
    setNumber(l.number)
    setAmount(l.amount)
  }

  useEffect(() => {
    loadLearners().then((list) => {
      setLearners(list)
      if (list[0]) pick(list[0])
    })
  }, [])

  const value = Math.round(Number(amount) * 100) / 100
  const schoolLabel = schoolName(school, other)
  const reference = schoolAccount(school, other, number)
  const ready = name.trim().length >= 2 && /^[A-Za-z0-9-]{2,20}$/.test(number.trim()) && (school !== OTHER_SCHOOL || other.trim().length >= 3)
  const canPay = ready && value > 0
  const detail = t.school.detail(schoolLabel, name.trim(), term)
  const learner: Learner = { school, other: other.trim(), name: name.trim(), number: number.trim(), amount }

  const payNow = async () => {
    setBusy(true)
    if (await paySchool(value, reference, t.school.payLabel(name.trim(), schoolLabel))) {
      await rememberLearner(learner)
      setLearners(await loadLearners())
    }
    setBusy(false)
  }

  const ask = async () => {
    await rememberLearner(learner)
    router.push({ pathname: '/school/ask', params: { account: reference, detail, amount: String(value || '') } })
  }

  const toCalendar = async () => {
    setBusy(true)
    const r = await addFeeDates(name.trim(), schoolLabel, reference, (n) => t.school.termName(n))
    setBusy(false)
    if (r === 'denied') toast(t.school.calendarDenied)
    else if (r === 'no_calendar') toast(t.school.calendarNone)
    else if (r === 'unavailable') toast(t.school.calendarUnavailable)
    else toast(t.school.calendarAdded(r.added))
  }

  return (
    <Screen>
      <Header title={t.school.title} />

      {learners.length > 0 && (
        <>
          <Text style={s.label}>{t.school.recent}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
            {learners.map((l) => {
              const on = l.school === school && l.number === number
              return (
                <Pressable key={`${l.school}-${l.number}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => pick(l)} style={[s.chip, on && s.chipOn]}>
                  <Icon name="school" size={14} color={on ? '#fff' : colors.primary} />
                  <Text style={[s.chipText, on && { color: '#fff' }]} numberOfLines={1}>{l.name}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </>
      )}

      <Text style={s.label}>{t.school.school}</Text>
      <Card style={{ paddingVertical: 4 }}>
        {[...SCHOOLS.map((x) => ({ code: x.code, name: x.name })), { code: OTHER_SCHOOL, name: t.school.otherSchool }].map((x, i, all) => (
          <ListRow key={x.code} last={i === all.length - 1} onPress={() => setSchool(x.code)}
            left={<Avatar name={x.name} icon="school" color="#5B2C9F" size={36} />} title={x.name}
            right={<Icon name={school === x.code ? 'radio-button-on' : 'radio-button-off'} size={20} color={school === x.code ? colors.primary : colors.muted} />} />
        ))}
      </Card>
      {school === OTHER_SCHOOL && (
        <TextInput style={s.input} value={other} onChangeText={setOther} maxLength={40} placeholder={t.school.otherSchoolName}
          placeholderTextColor={colors.muted} accessibilityLabel={t.school.otherSchoolName} />
      )}

      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={40} placeholder={t.school.learner}
        placeholderTextColor={colors.muted} accessibilityLabel={t.school.learner} autoCapitalize="words" />
      <TextInput style={s.input} value={number} onChangeText={(v) => setNumber(v.replace(/[^A-Za-z0-9-]/g, ''))} maxLength={20}
        placeholder={t.school.studentNumber} placeholderTextColor={colors.muted} accessibilityLabel={t.school.studentNumber} autoCapitalize="characters" />

      <Text style={s.label}>{t.school.term}</Text>
      <View style={s.terms}>
        {([1, 2, 3] as Term[]).map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityState={{ selected: term === n }} onPress={() => setTerm(n)} style={[s.term, term === n && s.termOn]}>
            <Text style={[s.termText, term === n && { color: '#fff' }]}>{t.school.termName(n)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.label}>{t.school.amount}</Text>
      <View style={s.own}>
        <Text style={s.currency}>M</Text>
        <TextInput style={s.ownInput} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={9}
          placeholder="0.00" placeholderTextColor={colors.muted} accessibilityLabel={t.school.amount} />
      </View>
      {ready && <Text style={s.ref}>{t.school.reference(reference)}</Text>}

      <Button label={canPay ? `${t.school.payNow} ${fmt(value)}` : t.school.payNow} icon="school" disabled={!canPay || busy} onPress={payNow} style={{ marginTop: 16 }} />
      <Button label={t.school.askFamily} icon="people" variant="ghost" disabled={!ready || busy} onPress={ask} style={{ marginTop: 10 }} />
      <Text style={s.hint}>{t.school.hint}</Text>

      <Card style={{ marginTop: 18, paddingVertical: 4 }}>
        <ListRow last onPress={ready && !busy ? toCalendar : undefined} left={<Avatar name="calendar" icon="calendar" color="#0EA5E9" size={40} />}
          title={t.school.calendar} subtitle={t.school.calendarSub} right={<Icon name="add-circle-outline" size={22} color={ready ? colors.primary : colors.muted} />} />
      </Card>
      <Text style={s.hint}>{t.school.calendarNote}</Text>
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, maxWidth: 180 },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.text, marginTop: 10 },
  terms: { flexDirection: 'row', gap: 8 },
  term: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.surface },
  termOn: { backgroundColor: colors.primary },
  termText: { fontSize: 14, fontWeight: '700', color: colors.text },
  own: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16 },
  currency: { fontSize: 22, fontWeight: '800', color: colors.muted, marginRight: 6 },
  ownInput: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text, paddingVertical: 14 },
  ref: { fontSize: 13, color: colors.muted, marginTop: 8, textAlign: 'center' },
  hint: { textAlign: 'center', color: colors.muted, fontSize: 13, marginTop: 12, paddingHorizontal: 8 },
})
