import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button, Card, Header, Icon, Screen } from '../components/ui'
import { useLanguage, useT } from '../i18n'
import { api } from '../lib/api'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

type Preset = 'thisMonth' | 'lastMonth' | 'last3' | 'last6' | 'custom'
const PRESETS: Preset[] = ['thisMonth', 'lastMonth', 'last3', 'last6', 'custom']
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** A4 at 72 points per inch, as expo-print expects. */
const A4 = { width: 595, height: 842 }

/** Today in Maseru (UTC+2, no daylight saving) as YYYY-MM-DD. */
const maseruToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10)
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)

/** The period a preset covers, ending today at the latest. */
function range(p: Exclude<Preset, 'custom'>): [string, string] {
  const today = maseruToday()
  const [y, m] = today.split('-').map(Number)
  switch (p) {
    case 'thisMonth': return [ymd(y, m - 1, 1), today]
    case 'lastMonth': return [ymd(y, m - 2, 1), ymd(y, m - 1, 0)]
    case 'last3': return [ymd(y, m - 3, 1), today]
    case 'last6': return [ymd(y, m - 6, 1), today]
  }
}

/**
 * Me › Statements: the wallet's statement for a period as a PDF (shared to WhatsApp, email, Files…) or printed.
 * The server renders the page, so it matches what EcoCash staff print from the portal.
 */
export default function Statement() {
  const t = useT()
  const { lang } = useLanguage()
  const { fail, toast } = useMoqoqo()
  const [preset, setPreset] = useState<Preset>('thisMonth')
  const [from, setFrom] = useState(() => range('thisMonth')[0])
  const [to, setTo] = useState(maseruToday)
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null)

  const [start, end] = preset === 'custom' ? [from, to] : range(preset)
  const valid = DATE.test(start) && DATE.test(end) && start <= end && end <= maseruToday()

  const choose = (p: Preset) => {
    setPreset(p)
    // Custom starts from the period that was showing, so it only needs adjusting.
    if (p === 'custom') {
      setFrom(start)
      setTo(end)
    }
  }

  const page = () => api<string>(`/v1/me/statement?from=${start}&to=${end}&lang=${lang}`, { text: true })

  const download = async () => {
    setBusy('pdf')
    try {
      const html = await page()
      // Loaded only when needed; these native modules aren't used anywhere else at start-up.
      const [Print, Sharing, { File, Paths }] = await Promise.all([import('expo-print'), import('expo-sharing'), import('expo-file-system')])
      if (!(await Sharing.isAvailableAsync())) return toast(t.statement.noShare)
      const { uri } = await Print.printToFileAsync({ html, ...A4 })
      // A file name people recognise when it lands in WhatsApp or Downloads.
      const named = new File(Paths.cache, `EcoCash-statement-${start}-to-${end}.pdf`)
      await new File(uri).copy(named, { overwrite: true })
      await Sharing.shareAsync(named.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t.statement.shareTitle })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const print = async () => {
    setBusy('print')
    try {
      const html = await page()
      const Print = await import('expo-print')
      await Print.printAsync({ html, ...A4 })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen>
      <Header title={t.statement.title} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 14 }}>
        <Card style={{ gap: 12 }}>
          <Text style={s.label}>{t.statement.period}</Text>
          <View style={s.chips} accessibilityRole="radiogroup">
            {PRESETS.map((p) => (
              <Pressable key={p} accessibilityRole="radio" accessibilityState={{ checked: preset === p }} onPress={() => choose(p)} style={[s.chip, preset === p && s.chipOn]}>
                <Text style={[s.chipText, preset === p && s.chipTextOn]}>{t.statement.presets[p]}</Text>
              </Pressable>
            ))}
          </View>
          {preset === 'custom' ? (
            <View style={s.dates}>
              {([[t.statement.from, from, setFrom], [t.statement.to, to, setTo]] as const).map(([label, value, set]) => (
                <View key={label} style={{ flex: 1, gap: 6 }}>
                  <Text style={s.label}>{label}</Text>
                  <TextInput style={s.input} value={value} onChangeText={(v) => set(v.replace(/[^\d-]/g, '').slice(0, 10))} placeholder="2026-10-01"
                    placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" maxLength={10} accessibilityLabel={label} />
                </View>
              ))}
            </View>
          ) : null}
          <View style={s.range}>
            <Icon name="calendar-outline" size={18} color={colors.primary} />
            <Text style={s.rangeText}>{valid ? t.statement.range(start, end) : t.statement.badDates}</Text>
          </View>
          <Text style={s.hint}>{t.statement.hint}</Text>
        </Card>
        <Button label={busy === 'pdf' ? t.statement.preparing : t.statement.download} icon="document-text-outline" disabled={!valid || !!busy} onPress={download} />
        <Button label={busy === 'print' ? t.statement.preparing : t.statement.print} icon="print-outline" variant="ghost" disabled={!valid || !!busy} onPress={print} />
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 38, justifyContent: 'center', borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  chipTextOn: { color: '#fff' },
  dates: { flexDirection: 'row', gap: 10 },
  input: { height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 12, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  range: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 18 },
})
