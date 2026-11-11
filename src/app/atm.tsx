import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ATM_NOTE, type AtmWithdrawal, type Tariff } from '../../shared/api'
import { Button, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { fmt, uid } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { dayLabel } from '../lib/mappers'
import { useDialogs } from '../state/Dialogs'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const QUICK = [100, 200, 500, 1000]

/**
 * Cardless ATM cash: choose the amount, confirm with the PIN, then type your number, the code and the amount at an
 * EcoCash ATM. The amount and fee are set aside at once; unused codes expire and the money comes back.
 */
export default function Atm() {
  const t = useT()
  const { state, fail, toast, dispatch } = useMoqoqo()
  const { askAmount, askPin } = useDialogs()
  const [tariff, setTariff] = useState<Tariff | null>(null)
  const [list, setList] = useState<AtmWithdrawal[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => {
    api<AtmWithdrawal[]>('/v1/atm/withdrawals').then(setList, () => setList([]))
  }, [])
  useFocusEffect(useCallback(() => {
    load()
    api<Tariff>('/v1/tariff').then(setTariff, () => {})
  }, [load]))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const active = list?.find((w) => w.status === 'active' && new Date(w.expiresAt).getTime() > now)
  const fee = tariff?.atmFee ?? 0

  const start = async (preset?: number) => {
    if (!tariff) return
    const amount = preset ?? (await askAmount({ title: t.atm.amountTitle, balance: state.balance, confirmLabel: t.dialogs.continue, recipient: { name: t.atm.title, subtitle: t.atm.notesHint(ATM_NOTE, fmt(tariff.atmMax)), icon: 'cash' } }))
    if (!amount) return
    if (amount % ATM_NOTE !== 0) return toast(t.atm.notes(ATM_NOTE))
    const pin = await askPin({ amount: amount + fee, label: t.atm.pinLabel(fmt(amount), fmt(fee)) })
    if (!pin) return
    try {
      const w = await api<AtmWithdrawal>('/v1/atm/withdrawals', { body: { amount, pin, clientId: uid() } })
      dispatch({ type: 'balance', balance: state.balance - amount - fee })
      setList((l) => [w, ...(l ?? [])])
      api<{ balance: number }>('/v1/me').then((me) => dispatch({ type: 'balance', balance: me.balance }), () => {})
    } catch (e) {
      fail(e)
    }
  }

  const cancel = async (w: AtmWithdrawal) => {
    try {
      const done = await api<AtmWithdrawal>(`/v1/atm/withdrawals/${w.id}/cancel`, { method: 'POST' })
      setList((l) => (l ?? []).map((x) => (x.id === done.id ? done : x)))
      toast(t.atm.cancelled(fmt(w.amount + w.fee)))
      api<{ balance: number }>('/v1/me').then((me) => dispatch({ type: 'balance', balance: me.balance }), () => {})
    } catch (e) {
      fail(e)
    }
  }

  const left = active ? Math.max(0, Math.floor((new Date(active.expiresAt).getTime() - now) / 1000)) : 0
  return (
    <Screen>
      <Header title={t.atm.title} />
      <View style={s.body}>
        {!list || !tariff ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : active ? (
          <Card style={s.codeCard}>
            <Text style={s.codeLbl}>{t.atm.yourCode}</Text>
            <Text style={s.code} selectable accessibilityLabel={active.code?.split('').join(' ')}>{active.code?.replace(/(\d{4})(\d{4})/, '$1 $2')}</Text>
            <Text style={s.codeAmt}>{fmt(active.amount)}</Text>
            <Text style={s.expires}>{t.atm.expiresIn(Math.floor(left / 60), left % 60)}</Text>
            <View style={s.steps}>
              {t.atm.steps(fmt(active.amount)).map((step, i) => (
                <View key={i} style={s.step}><Text style={s.stepNo}>{i + 1}</Text><Text style={s.stepText}>{step}</Text></View>
              ))}
            </View>
            <Text style={s.ref}>{active.reference} · {t.atm.feeLine(fmt(active.fee))}</Text>
            <Button label={t.atm.cancel} variant="ghost" onPress={() => cancel(active)} style={{ marginTop: 6 }} />
          </Card>
        ) : (
          <>
            <Text style={s.intro}>{t.atm.intro}</Text>
            <View style={s.quick}>
              {QUICK.filter((a) => a <= tariff.atmMax).map((a) => (
                <Pressable key={a} accessibilityRole="button" onPress={() => start(a)} style={({ pressed }) => [s.tile, pressed && { backgroundColor: colors.primarySoft }]}>
                  <Text style={s.tileAmt}>{fmt(a)}</Text>
                </Pressable>
              ))}
            </View>
            <Button label={t.atm.other} variant="ghost" onPress={() => start()} />
            <Text style={s.fee}>{t.atm.feeLine(fmt(fee))} · {t.atm.notesHint(ATM_NOTE, fmt(tariff.atmMax))}</Text>
          </>
        )}

        {list && list.filter((w) => w !== active).length > 0 && (
          <>
            <Text style={s.section}>{t.atm.history}</Text>
            <Card style={{ paddingVertical: 4 }}>
              {list.filter((w) => w !== active).slice(0, 10).map((w, i, arr) => (
                <ListRow key={w.id} last={i === arr.length - 1}
                  left={<Icon name={w.status === 'redeemed' ? 'cash-outline' : 'return-down-back-outline'} size={22} color={w.status === 'redeemed' ? colors.primary : colors.muted} />}
                  title={`${fmt(w.amount)} · ${t.atm.status[w.status]}`}
                  subtitle={`${w.reference} · ${dayLabel(w.redeemedAt ?? w.createdAt, t.common.weekdays)}${w.atm ? ` · ${w.atm}` : ''}`} />
              ))}
            </Card>
          </>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 16, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  intro: { fontSize: 14, color: colors.muted, marginBottom: 14 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  tile: { width: '47%', flexGrow: 1, height: 72, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border },
  tileAmt: { fontSize: 20, fontWeight: '800', color: colors.text },
  fee: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 6 },
  codeCard: { alignItems: 'center', paddingVertical: 22 },
  codeLbl: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  code: { fontSize: 40, fontWeight: '900', letterSpacing: 4, color: colors.primary, marginTop: 6, fontVariant: ['tabular-nums'] },
  codeAmt: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 4 },
  expires: { fontSize: 13, color: '#B45309', marginTop: 6, fontWeight: '600' },
  steps: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNo: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, color: colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 12.5, lineHeight: 22 },
  stepText: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
  ref: { fontSize: 12, color: colors.muted, marginTop: 14 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 22, marginBottom: 8 },
})
