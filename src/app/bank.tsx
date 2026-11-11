import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Bank, BankAccount, BankAccountName, BankTransferResult, Tariff } from '../../shared/api'
import { Sheet, SheetOption } from '../components/Sheet'
import { Avatar, Button, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt, uid } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

type Target = { bankCode: string; bankName: string; accountNumber: string; accountName: string; save: boolean }
const masked = (n: string) => `••${n.slice(-4)}`

/**
 * Wallet to bank: a saved account, or a new one checked with the bank (the holder's name comes from the bank, so
 * the user can see it's the right person); then the amount and fee, and the PIN.
 */
export default function ToBank() {
  const t = useT()
  // ?amount=… when the EcoCash Assistant prepared it: the amount screen opens pre-filled.
  const preset = Number(useLocalSearchParams<{ amount?: string }>().amount) || undefined
  const { state, settled, fail, toast } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [tariff, setTariff] = useState<Tariff | null>(null)
  const [banks, setBanks] = useState<Bank[]>([])
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState(false)
  const [bank, setBank] = useState<Bank | null>(null)
  const [number, setNumber] = useState('')
  const [checked, setChecked] = useState<BankAccountName | null>(null)
  const [save, setSave] = useState(true)
  const [target, setTarget] = useState<Target | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([api<Tariff>('/v1/tariff'), api<Bank[]>('/v1/banks'), api<BankAccount[]>('/v1/bank-accounts')]).then(
      ([tf, b, a]) => { if (alive) { setTariff(tf); setBanks(b); setAccounts(a); setAdding(a.length === 0) } },
      (e) => { if (alive) { fail(e); setAccounts([]) } },
    )
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- load once

  const check = async () => {
    if (!bank) return setPicking(true)
    setBusy(true)
    try {
      setChecked(await api<BankAccountName>(`/v1/banks/lookup?bank=${bank.code}&account=${number}`))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const go = async (to: Target) => {
    if (!tariff) return
    const a = await askAmount({
      title: t.cash.sendTo(to.accountName), balance: state.balance, confirmLabel: t.cash.continue, initial: preset,
      recipient: { name: to.accountName, subtitle: `${to.bankName} ${masked(to.accountNumber)} · ${t.cash.bankMax(fmt(tariff.bankTransferMax))}`, icon: 'business' },
    })
    if (!a) return
    setTarget(to)
    setAmount(a)
  }

  const send = async () => {
    if (!target || !amount || !tariff) return
    const pin = await askPin({ amount: amount + tariff.bankTransferFee, label: t.cash.bankPin(target.accountName, target.bankName) })
    if (!pin) return
    setBusy(true)
    try {
      const res = await api<BankTransferResult>('/v1/bank-transfers', {
        body: { bankCode: target.bankCode, accountNumber: target.accountNumber, amount, pin, clientId: uid(), save: target.save },
      })
      settled(res.money)
      setAmount(null)
      toast(t.cash.bankDone(fmt(res.transfer.amount), res.transfer.accountName))
      router.back()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const remove = (a: BankAccount) =>
    Alert.alert(t.cash.removeAccount, t.cash.removeConfirm(`${a.accountName} · ${a.bankName} ${masked(a.accountNumber)}`), [
      { text: t.cash.cancel, style: 'cancel' },
      { text: t.cash.remove, style: 'destructive', onPress: () => api(`/v1/bank-accounts/${a.id}`, { method: 'DELETE' }).then(() => setAccounts((l) => (l ?? []).filter((x) => x.id !== a.id)), fail) },
    ])

  const fee = tariff?.bankTransferFee ?? 0
  return (
    <Screen>
      <Header title={t.cash.bankTitle} />
      {!accounts ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <View style={s.column}>
          {accounts.length > 0 && (
            <>
              <Text style={s.section}>{t.cash.savedAccounts}</Text>
              <Card style={{ paddingVertical: 4 }}>
                {accounts.map((a, i) => (
                  <ListRow key={a.id} last={i === accounts.length - 1}
                    onPress={() => go({ bankCode: a.bankCode, bankName: a.bankName, accountNumber: a.accountNumber, accountName: a.accountName, save: false })}
                    left={<Avatar name={a.bankName} icon="business" size={42} />}
                    title={a.accountName} subtitle={`${a.bankName} ${masked(a.accountNumber)}`}
                    right={
                      <Pressable accessibilityRole="button" accessibilityLabel={t.cash.removeAccount} onPress={() => remove(a)} hitSlop={8}>
                        <Icon name="trash-outline" size={20} color={colors.muted} />
                      </Pressable>
                    } />
                ))}
              </Card>
            </>
          )}

          {adding ? (
            <Card style={s.form}>
              <Text style={s.formTitle}>{t.cash.newAccount}</Text>
              <Text style={s.label}>{t.cash.bank}</Text>
              <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={[s.input, s.picker]}>
                <Text style={[s.pickerText, !bank && { color: colors.muted }]}>{bank?.name ?? t.cash.chooseBank}</Text>
                <Icon name="chevron-down" size={18} color={colors.muted} />
              </Pressable>
              <Text style={s.label}>{t.cash.accountNumber}{bank ? ` · ${t.cash.accountDigits(bank.accountLength)}` : ''}</Text>
              <TextInput style={s.input} value={number} onChangeText={(v) => { setNumber(v.replace(/\D/g, '').slice(0, bank?.accountLength ?? 16)); setChecked(null) }}
                keyboardType="number-pad" placeholder="00000000000" placeholderTextColor={colors.muted} accessibilityLabel={t.cash.accountNumber} />
              {checked ? (
                <>
                  <View style={s.holder}>
                    <Icon name="checkmark-circle" size={22} color={colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.holderLabel}>{t.cash.accountHolder}</Text>
                      <Text style={s.holderName}>{checked.accountName}</Text>
                    </View>
                  </View>
                  <Text style={s.warn}>{t.cash.rightPerson}</Text>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: save }} onPress={() => setSave(!save)} style={s.checkRow}>
                    <Icon name={save ? 'checkbox' : 'square-outline'} size={22} color={save ? colors.primary : colors.muted} />
                    <Text style={s.checkText}>{t.cash.saveAccount}</Text>
                  </Pressable>
                  <Button label={t.cash.continue} onPress={() => go({ bankCode: checked.bankCode, bankName: bank!.name, accountNumber: checked.accountNumber, accountName: checked.accountName, save })} />
                </>
              ) : (
                <Button label={t.cash.checkAccount} onPress={check} disabled={busy || !bank || number.length !== bank.accountLength} />
              )}
              {accounts.length > 0 && <Button label={t.cash.cancel} variant="ghost" onPress={() => { setAdding(false); setChecked(null) }} />}
            </Card>
          ) : (
            <Button label={t.cash.newAccount} icon="add" variant="ghost" onPress={() => setAdding(true)} />
          )}
          <Text style={s.note}>{t.cash.arrives}</Text>
        </View>
      )}

      <Sheet visible={picking} title={t.cash.chooseBank} onClose={() => setPicking(false)}>
        {banks.map((b) => (
          <SheetOption key={b.code} icon="business" color={colors.primary} title={b.name} subtitle={t.cash.accountDigits(b.accountLength)}
            selected={bank?.code === b.code} onPress={() => { setBank(b); setNumber(''); setChecked(null); setPicking(false) }} />
        ))}
      </Sheet>

      <Sheet visible={amount !== null} title={t.cash.summary} onClose={() => setAmount(null)}>
        {target && amount !== null && (
          <View style={{ gap: 10 }}>
            <View style={s.row}><Text style={s.rowLabel}>{t.cash.theyReceive}</Text><Text style={[s.rowValue, { fontSize: 20, fontWeight: '800' }]}>{fmt(amount)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>{t.cash.fee}</Text><Text style={s.rowValue}>{fmt(fee)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>{t.cash.total}</Text><Text style={s.rowValue}>{fmt(amount + fee)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>{t.cash.accountHolder}</Text><Text style={s.rowValue}>{target.accountName} · {target.bankName} {masked(target.accountNumber)}</Text></View>
            <Button label={t.cash.send(fmt(amount))} onPress={send} disabled={busy} />
          </View>
        )}
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  form: { marginTop: 14, gap: 6 },
  formTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, height: 54, paddingHorizontal: 14, fontSize: 17, fontWeight: '600', color: colors.text },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerText: { fontSize: 16, fontWeight: '600', color: colors.text },
  holder: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.successSoft, borderRadius: radius.md, padding: 12, marginTop: 12 },
  holderLabel: { fontSize: 12, color: colors.success, fontWeight: '600' },
  holderName: { fontSize: 17, color: colors.text, fontWeight: '800' },
  warn: { fontSize: 12.5, color: colors.muted, marginTop: 6, lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkText: { fontSize: 14, color: colors.text, flex: 1 },
  note: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
})
