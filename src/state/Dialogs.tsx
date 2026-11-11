import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Keypad } from '../components/Keypad'
import { PinEntry } from '../components/PinEntry'
import { Avatar, Button, Icon, type IconName } from '../components/ui'
import { useT } from '../i18n'
import { fmt } from '../lib/format'
import { FORM_MAX } from '../lib/layout'
import { colors, radius } from '../theme'
import { useAuth } from './Auth'

// Promise-based amount and PIN prompts, so payment flows read top to bottom:
//   const amount = await askAmount(...); const pin = await askPin(...)

export interface Recipient { name: string; subtitle: string; icon?: IconName; color?: string }
/** `initial`: pre-filled amount (e.g. prepared by the EcoCash Assistant); the user can still change it. */
interface AmountOpts { title: string; balance: number; recipient: Recipient; confirmLabel?: string; quick?: number[]; initial?: number }
/** No `amount` when confirming something other than a payment (e.g. showing the payment code). */
interface PinOpts { label: string; amount?: number }

type Open =
  | { kind: 'amount'; opts: AmountOpts; resolve: (v: number | null) => void }
  | { kind: 'pin'; opts: PinOpts; resolve: (v: string | null) => void }

interface Dialogs {
  askAmount(opts: AmountOpts): Promise<number | null>
  askPin(opts: PinOpts): Promise<string | null>
}

const Ctx = createContext<Dialogs | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const askAmount = useCallback((opts: AmountOpts) => new Promise<number | null>((resolve) => setOpen({ kind: 'amount', opts, resolve })), [])
  const askPin = useCallback((opts: PinOpts) => new Promise<string | null>((resolve) => setOpen({ kind: 'pin', opts, resolve })), [])

  const finish = <T,>(resolve: (v: T) => void, v: T) => {
    setOpen(null)
    resolve(v)
  }

  return (
    <Ctx value={{ askAmount, askPin }}>
      {children}
      <Modal visible={!!open} animationType="slide" onRequestClose={() => open && finish(open.resolve as (v: null) => void, null)}>
        {open?.kind === 'amount' && <AmountScreen key="amount" opts={open.opts} onDone={(v) => finish(open.resolve, v)} />}
        {open?.kind === 'pin' && <PinScreen key="pin" opts={open.opts} onDone={(v) => finish(open.resolve, v)} />}
      </Modal>
    </Ctx>
  )
}

export function useDialogs() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDialogs must be used inside DialogProvider')
  return ctx
}

function DialogFrame({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const t = useT()
  return (
    <SafeAreaView style={d.frame}>
      <View style={d.column}>
        <View style={d.header}>
          <Pressable accessibilityLabel={t.common.close} onPress={onClose} style={d.close}><Icon name="arrow-back" size={20} /></Pressable>
          <Text style={d.title} numberOfLines={1}>{title}</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={{ flex: 1 }}>{children}</View>
        {footer}
      </View>
    </SafeAreaView>
  )
}

function AmountScreen({ opts, onDone }: { opts: AmountOpts; onDone: (v: number | null) => void }) {
  const [value, setValue] = useState(() => (opts.initial ? String(Math.round(opts.initial * 100) / 100) : ''))
  const t = useT()
  const onKey = (k: string) =>
    setValue((v) => {
      if (k === '⌫') return v.slice(0, -1)
      if (k === '.') return v.includes('.') ? v : (v || '0') + '.'
      if (v.length >= 7 || (v.includes('.') && v.split('.')[1].length >= 2)) return v
      return (v === '0' ? '' : v) + k
    })
  const amount = Number(value)
  const r = opts.recipient
  return (
    <DialogFrame
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <View style={d.footer}>
          <Button label={opts.confirmLabel ?? t.dialogs.continue} disabled={!(amount > 0)} onPress={() => onDone(amount)} style={d.footerBtn} />
        </View>
      }
    >
      <View style={d.recipient}>
        <Avatar name={r.name} icon={r.icon} color={r.color} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={d.rName}>{r.name}</Text>
          <Text style={d.rSub} numberOfLines={1}>{r.subtitle}</Text>
        </View>
      </View>
      <Text style={d.enter}>{t.dialogs.enterAmount}</Text>
      <Text style={d.amount} accessibilityLabel={t.dialogs.amount(value || '0')}>M {value || '0'}<Text style={d.cursor}>|</Text></Text>
      <Text style={d.balance}>{t.common.balance(fmt(opts.balance))}</Text>
      <View style={d.quick}>
        {(opts.quick ?? [50, 100, 200, 500]).map((q) => (
          <Pressable key={q} accessibilityRole="button" accessibilityLabel={`M${q}`} onPress={() => setValue(String(q))} style={d.quickChip}>
            <Text style={d.quickText}>M{q}</Text>
          </Pressable>
        ))}
      </View>
      <Keypad extra="." onKey={onKey} />
    </DialogFrame>
  )
}

function PinScreen({ opts, onDone }: { opts: PinOpts; onDone: (v: string | null) => void }) {
  const t = useT()
  const { biometrics, verifyBiometrics } = useAuth()
  const finish = async (pin: string) => {
    onDone(pin)
    return true
  }
  // The mock accepts any PIN, so a passed biometric check stands in for one here. The real
  // EcoCash API needs its own biometric-bound credential before this can replace the PIN.
  const bio = async () => {
    if (await verifyBiometrics()) onDone('1234')
  }
  return (
    <DialogFrame title={t.dialogs.enterPin} onClose={() => onDone(null)} footer={<Text style={d.demo}>{t.dialogs.pinDemo}</Text>}>
      <View style={d.lock}><Icon name="lock-closed" size={26} color={colors.primary} /></View>
      <Text style={d.pinLabel}>{opts.label}</Text>
      {opts.amount !== undefined && <Text style={d.pinAmount}>{fmt(opts.amount)}</Text>}
      <PinEntry onComplete={finish} onBiometrics={biometrics.enabled ? bio : undefined} />
    </DialogFrame>
  )
}

const d = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg },
  column: { flex: 1, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: radius.lg },
  rName: { fontSize: 16, fontWeight: '700', color: colors.text },
  rSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  enter: { textAlign: 'center', color: colors.muted, marginTop: 22, fontSize: 14 },
  amount: { textAlign: 'center', fontSize: 40, fontWeight: '700', color: colors.text, marginTop: 4 },
  cursor: { color: colors.primary, fontWeight: '300' },
  balance: { textAlign: 'center', color: colors.muted, fontSize: 12.5 },
  quick: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 14 },
  quickChip: { backgroundColor: colors.primarySoft, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill },
  quickText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  footer: { paddingHorizontal: 0 },
  footerBtn: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, height: 64, marginTop: 0 },
  lock: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  pinLabel: { textAlign: 'center', color: colors.muted, marginTop: 14, paddingHorizontal: 24 },
  pinAmount: { textAlign: 'center', fontSize: 30, fontWeight: '700', color: colors.text, marginTop: 4 },
  demo: { textAlign: 'center', color: colors.muted, fontSize: 12, paddingVertical: 14 },
})
