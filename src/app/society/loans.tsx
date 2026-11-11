import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { loanTotal, type MoneyResult, type SocietyLoan, type SocietyLoans, type SocietyLoanSettings } from '../../../shared/api'
import { Sheet } from '../../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Pill, Screen, SectionTitle } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { fmt, uid } from '../../lib/format'
import { useDialogs } from '../../state/Dialogs'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const addMonths = (months: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

/**
 * Loans from a society, on terms its executives set (interest a month, longest and largest loan). Members ask and
 * repay; executives approve, change the terms and see the report: what is owed, what is late, interest earned.
 */
export default function Loans() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const t = useT()
  const moqoqo = useMoqoqo()
  const { state, toast, settled } = moqoqo
  const { askAmount, askPin } = useDialogs()
  const [d, setD] = useState<SocietyLoans | null>(null)
  const [sheet, setSheet] = useState<'ask' | 'terms' | null>(null)
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState(1)
  const [purpose, setPurpose] = useState('')
  const [terms, setTerms] = useState({ enabled: false, interest: '', maxMonths: '', maxAmount: '' })
  const [busy, setBusy] = useState(false)
  const clientId = useRef(uid())
  const fail = (e: unknown) => (e instanceof ApiFailure && ['VALIDATION', 'CONFLICT', 'FORBIDDEN', 'LIMIT_EXCEEDED', 'INSUFFICIENT_FUNDS'].includes(e.code) ? toast(e.message) : moqoqo.fail(e))

  const load = useCallback(() => {
    api<SocietyLoans>(`/v1/societies/${id}/loans`).then(setD).catch(() => setD(null))
  }, [id])
  useFocusEffect(load)

  if (!d) return <Screen><Header title={t.society.loans} /><ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /></Screen>
  const exec = !!d.report
  const me = state.me?.id
  const s = d.settings
  const mine = d.loans.filter((l) => l.borrower.id === me)
  const open = mine.some((l) => l.status === 'pending' || l.status === 'active')
  const toDecide = d.loans.filter((l) => l.canDecide)
  const value = Number(amount)

  const openTerms = () => {
    setTerms({ enabled: s.enabled, interest: String(s.interestPercent), maxMonths: String(s.maxMonths), maxAmount: s.maxAmount ? String(s.maxAmount) : '' })
    setSheet('terms')
  }
  const saveTerms = async () => {
    const body: SocietyLoanSettings = {
      enabled: terms.enabled,
      interestPercent: Number(terms.interest) || 0,
      maxMonths: Math.round(Number(terms.maxMonths)) || 1,
      ...(Number(terms.maxAmount) > 0 ? { maxAmount: Number(terms.maxAmount) } : {}),
    }
    setBusy(true)
    try {
      const r = await api<SocietyLoans>(`/v1/societies/${id}/loan-settings`, { method: 'PUT', body })
      setD(r)
      setSheet(null)
      toast(r.pendingTerms ? t.loans.termsSent : t.loans.saved)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  // The other executives approve a change to the terms before it applies.
  const decideTerms = async (action: 'approve' | 'reject') => {
    if (!d.pendingTerms) return
    const pin = await askPin({ label: `${action === 'approve' ? t.loans.approve : t.loans.reject} · ${t.loans.termsTitle}` })
    if (!pin) return
    try {
      const r = await api<SocietyLoans>(`/v1/society-loan-terms/${d.pendingTerms.id}/${action}`, { body: { pin } })
      setD(r)
      toast(action === 'reject' ? t.loans.termsRejected : r.pendingTerms ? t.loans.approved : t.loans.termsApplied)
    } catch (e) {
      fail(e)
    }
  }

  const ask = async () => {
    setSheet(null)
    const pin = await askPin({ amount: value, label: t.loans.askTitle })
    if (!pin) return
    try {
      await api<SocietyLoan>(`/v1/societies/${id}/loans`, { body: { amount: value, months, purpose: purpose.trim() || undefined, pin, clientId: clientId.current } })
      clientId.current = uid()
      setAmount('')
      setPurpose('')
      toast(t.loans.sent)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const decide = async (l: SocietyLoan, action: 'approve' | 'reject') => {
    const pin = await askPin({ amount: l.amount, label: `${action === 'approve' ? t.loans.approve : t.loans.reject} · ${l.reference}` })
    if (!pin) return
    try {
      const r = await api<SocietyLoan>(`/v1/society-loans/${l.id}/${action}`, { body: { pin } })
      toast(r.status === 'active' ? t.loans.paidOut : action === 'approve' ? t.loans.approved : t.loans.rejectedDone)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const repay = async (l: SocietyLoan) => {
    const v = await askAmount({ title: t.loans.repayTitle(l.reference), balance: state.balance, recipient: { name: name ?? l.reference, subtitle: t.loans.owes(fmt(l.outstanding), fmt(l.total)), icon: 'cash' }, initial: l.outstanding, confirmLabel: t.dialogs.continue })
    if (!v) return
    const pin = await askPin({ amount: v, label: t.loans.repayTitle(l.reference) })
    if (!pin) return
    try {
      settled(await api<MoneyResult>(`/v1/society-loans/${l.id}/repay`, { body: { amount: v, pin } }))
      toast(t.loans.repaidDone)
      load()
    } catch (e) {
      fail(e)
    }
  }

  const status = (l: SocietyLoan) => (l.overdue ? t.loans.statuses.overdue : t.loans.statuses[l.status])
  const tone = (l: SocietyLoan): 'warn' | 'success' | 'primary' => (l.overdue || l.status === 'pending' ? 'warn' : l.status === 'active' || l.status === 'repaid' ? 'success' : 'primary')

  const loanCard = (l: SocietyLoan, mineCard: boolean) => (
    <Card key={l.id} style={s2.loan}>
      <View style={s2.row}>
        <Text style={s2.amount}>{fmt(l.amount)}</Text>
        <Pill label={l.status === 'pending' ? t.loans.approvalsOf(l.approvals.length, l.approvalsRequired) : status(l)} tone={tone(l)} />
      </View>
      <Text style={s2.text}>{mineCard ? l.reference : `${l.borrower.name} · ${l.reference}`}{l.purpose ? ` · ${l.purpose}` : ''}</Text>
      <Text style={s2.muted}>{t.loans.loanTerms(l.interestPercent, l.months)} · {fmt(l.total)}</Text>
      {l.status === 'active' && (
        <>
          <View style={s2.track}><View style={[s2.fill, { width: `${Math.round((l.repaid / l.total) * 100)}%` }, l.overdue && { backgroundColor: colors.danger }]} /></View>
          <Text style={[s2.muted, l.overdue && { color: colors.danger }]}>{t.loans.owes(fmt(l.outstanding), fmt(l.total))} · {t.loans.due(day(l.dueAt!))}</Text>
        </>
      )}
      {l.canDecide && (
        <View style={s2.btns}>
          <Button label={t.loans.reject} variant="ghost" onPress={() => decide(l, 'reject')} style={{ flex: 1 }} />
          <Button label={t.loans.approve} onPress={() => decide(l, 'approve')} style={{ flex: 1 }} />
        </View>
      )}
      {mineCard && l.status === 'active' && <Button label={t.loans.repay} onPress={() => repay(l)} style={{ marginTop: 12 }} />}
    </Card>
  )

  return (
    <Screen>
      <Header title={name ? t.loans.title(name) : t.society.loans} />

      <Card style={s2.terms}>
        <Icon name="cash-outline" size={24} color={colors.primary} />
        <Text style={s2.termsText}>{s.enabled ? t.loans.terms(s.interestPercent, s.maxMonths, s.maxAmount ? fmt(s.maxAmount) : null) : exec ? t.loans.offExec : t.loans.off}</Text>
      </Card>
      <View style={s2.actions}>
        {s.enabled && !open && <Button label={t.loans.ask} onPress={() => { setMonths(1); setSheet('ask') }} style={{ flex: 1 }} />}
        {exec && !d.pendingTerms && <Button label={t.loans.changeTerms} variant="ghost" onPress={openTerms} style={{ flex: 1 }} />}
      </View>

      {d.pendingTerms && (
        <Card style={s2.pending}>
          <View style={s2.row}>
            <Text style={s2.pendingTitle}>{t.loans.pendingTerms}</Text>
            <Pill label={t.loans.approvalsOf(d.pendingTerms.approvals.length, d.pendingTerms.approvalsRequired)} tone="warn" />
          </View>
          <Text style={s2.text}>
            {d.pendingTerms.settings.enabled
              ? t.loans.terms(d.pendingTerms.settings.interestPercent, d.pendingTerms.settings.maxMonths, d.pendingTerms.settings.maxAmount ? fmt(d.pendingTerms.settings.maxAmount) : null)
              : t.loans.termsOff}
          </Text>
          <Text style={s2.muted}>{t.loans.proposedBy(d.pendingTerms.proposedBy.name)}</Text>
          {d.pendingTerms.canDecide ? (
            <View style={s2.btns}>
              <Button label={t.loans.reject} variant="ghost" onPress={() => decideTerms('reject')} style={{ flex: 1 }} />
              <Button label={t.loans.approve} onPress={() => decideTerms('approve')} style={{ flex: 1 }} />
            </View>
          ) : <Text style={[s2.muted, { marginTop: 8 }]}>{t.loans.waitingOthers}</Text>}
        </Card>
      )}

      {d.report && (d.report.lentTotal > 0 || d.report.activeCount > 0) && (
        <>
          <SectionTitle title={t.loans.report} />
          <Card style={s2.report}>
            <View style={s2.stat}><Text style={s2.statValue}>{fmt(d.report.outstanding)}</Text><Text style={s2.muted}>{t.loans.outstanding}</Text></View>
            {d.report.overdueCount > 0 && <Pill label={`${t.loans.overdue(d.report.overdueCount)} · ${fmt(d.report.overdue)}`} tone="warn" />}
            <View style={s2.statsRow}>
              <View style={s2.stat}><Text style={s2.small}>{fmt(d.report.lentTotal)}</Text><Text style={s2.muted}>{t.loans.lent}</Text></View>
              <View style={s2.stat}><Text style={s2.small}>{fmt(d.report.interestTotal)}</Text><Text style={s2.muted}>{t.loans.interestTotal}</Text></View>
              <View style={s2.stat}><Text style={s2.small}>{fmt(d.report.repaidTotal)}</Text><Text style={s2.muted}>{t.loans.repaidTotal}</Text></View>
            </View>
          </Card>
        </>
      )}

      {toDecide.length > 0 && <><SectionTitle title={t.loans.toApprove} />{toDecide.map((l) => loanCard(l, false))}</>}
      {mine.length > 0 && <><SectionTitle title={t.loans.mine} />{mine.map((l) => loanCard(l, true))}</>}
      {exec && (
        <>
          <SectionTitle title={t.loans.all} />
          <Card style={{ paddingVertical: 4 }}>
            {d.loans.length === 0 ? <Text style={[s2.muted, { padding: 16 }]}>{t.loans.none}</Text> : d.loans.map((l, i) => (
              <ListRow key={l.id} last={i === d.loans.length - 1} left={<Avatar name={l.borrower.name} size={36} />}
                title={`${l.borrower.name} · ${fmt(l.amount)}`}
                subtitle={l.status === 'active' ? `${t.loans.owes(fmt(l.outstanding), fmt(l.total))} · ${t.loans.due(day(l.dueAt!))}` : `${l.reference} · ${day(l.createdAt)}`}
                right={<Pill label={status(l)} tone={tone(l)} />} />
            ))}
          </Card>
        </>
      )}

      <Sheet typing visible={sheet === 'ask'} title={t.loans.askTitle} onClose={() => setSheet(null)}>
        <TextInput style={s2.input} value={amount} onChangeText={(v) => setAmount(cleanAmount(v))} placeholder={t.loans.amount} placeholderTextColor={colors.muted}
          keyboardType="decimal-pad" maxLength={9} accessibilityLabel={t.loans.amount} />
        <Text style={s2.label}>{t.loans.months}</Text>
        <View style={s2.chips}>
          {Array.from({ length: s.maxMonths }, (_, i) => i + 1).map((m) => (
            <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: months === m }} onPress={() => setMonths(m)} style={[s2.chip, months === m && s2.chipOn]}>
              <Text style={[s2.chipText, months === m && { color: '#fff' }]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={s2.input} value={purpose} onChangeText={setPurpose} placeholder={t.loans.purpose} placeholderTextColor={colors.muted} maxLength={60} accessibilityLabel={t.loans.purpose} />
        {value > 0 && <Text style={s2.preview}>{t.loans.preview(fmt(loanTotal(value, s.interestPercent, months)), day(addMonths(months)))}</Text>}
        <Text style={[s2.muted, { marginBottom: 12 }]}>{t.loans.approversHint}</Text>
        <Button label={t.dialogs.continue} disabled={!(value > 0)} onPress={ask} />
      </Sheet>

      <Sheet typing visible={sheet === 'terms'} title={t.loans.termsTitle} onClose={() => setSheet(null)}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: terms.enabled }} onPress={() => setTerms((x) => ({ ...x, enabled: !x.enabled }))} style={s2.check}>
          <Icon name={terms.enabled ? 'checkbox' : 'square-outline'} size={22} color={terms.enabled ? colors.primary : colors.muted} />
          <Text style={s2.text}>{t.loans.enabled}</Text>
        </Pressable>
        <Text style={s2.label}>{t.loans.interest}</Text>
        <TextInput style={s2.input} value={terms.interest} onChangeText={(v) => setTerms((x) => ({ ...x, interest: cleanAmount(v) }))} keyboardType="decimal-pad" maxLength={6} accessibilityLabel={t.loans.interest} />
        <Text style={s2.label}>{t.loans.maxMonths}</Text>
        <TextInput style={s2.input} value={terms.maxMonths} onChangeText={(v) => setTerms((x) => ({ ...x, maxMonths: v.replace(/\D/g, '') }))} keyboardType="number-pad" maxLength={2} accessibilityLabel={t.loans.maxMonths} />
        <Text style={s2.label}>{t.loans.maxAmount}</Text>
        <TextInput style={s2.input} value={terms.maxAmount} onChangeText={(v) => setTerms((x) => ({ ...x, maxAmount: cleanAmount(v) }))} keyboardType="decimal-pad" maxLength={9} accessibilityLabel={t.loans.maxAmount} />
        <Text style={[s2.muted, { marginBottom: 12 }]}>{t.loans.termsHint}</Text>
        <Button label={t.loans.save} disabled={busy} onPress={saveTerms} />
      </Sheet>
    </Screen>
  )
}

const s2 = StyleSheet.create({
  terms: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  termsText: { flex: 1, fontSize: 14.5, color: colors.text, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  report: { gap: 10 },
  stat: { flex: 1 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  small: { fontSize: 15, fontWeight: '700', color: colors.text },
  loan: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 20, fontWeight: '800', color: colors.text },
  text: { fontSize: 15, color: colors.text, marginTop: 4, flex: 1 },
  muted: { fontSize: 13, color: colors.muted, marginTop: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', marginTop: 10 },
  fill: { height: '100%', backgroundColor: colors.success },
  btns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text, marginBottom: 12 },
  label: { fontSize: 13.5, fontWeight: '700', color: colors.text, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minWidth: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center' },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.text },
  preview: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  pending: { marginTop: 12, borderWidth: 1, borderColor: colors.warn },
  pendingTitle: { fontSize: 15.5, fontWeight: '700', color: colors.text, flex: 1 },
})
