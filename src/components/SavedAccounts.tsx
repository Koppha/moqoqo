import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native'
import { MAX_SAVED_PER_BILLER } from '../../shared/api'
import { useT } from '../i18n'
import { ApiFailure } from '../lib/api'
import { saveBill, useSavedBills } from '../lib/saved'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'
import { Sheet } from './Sheet'
import { Button, Icon } from './ui'

/**
 * Saved accounts for one biller ('lec', 'service:<id>'), as chips above its account field: a tap fills it in. When the
 * field holds an account that isn't saved yet, a "Save" chip keeps it with a nickname (up to 5 per biller).
 */
export function SavedAccounts({ target, value, onPick }: { target: string; value: string; onPick: (account: string) => void }) {
  const t = useT()
  const { toast } = useMoqoqo()
  const { bills, reload } = useSavedBills(target)
  const [naming, setNaming] = useState(false)
  const [nickname, setNickname] = useState('')
  const typed = value.trim()
  const canSave = typed.length >= 3 && !bills.some((b) => b.account === typed)

  const save = async () => {
    try {
      await saveBill(target, typed, nickname.trim())
      setNaming(false)
      setNickname('')
      reload()
      toast(t.saved.savedAs(nickname.trim()))
    } catch (e) {
      toast(e instanceof ApiFailure && e.message ? e.message : t.errors.UNKNOWN)
    }
  }

  if (bills.length === 0 && !canSave) return null
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} keyboardShouldPersistTaps="handled">
        {bills.map((b) => (
          <Pressable key={b.id} accessibilityRole="button" accessibilityState={{ selected: b.account === typed }} onPress={() => onPick(b.account)}
            style={[s.chip, b.account === typed && s.chipOn]}>
            <Icon name="bookmark" size={14} color={b.account === typed ? '#fff' : colors.primary} />
            <Text style={[s.chipText, b.account === typed && { color: '#fff' }]} numberOfLines={1}>{b.nickname}</Text>
          </Pressable>
        ))}
        {canSave && bills.length < MAX_SAVED_PER_BILLER && (
          <Pressable accessibilityRole="button" onPress={() => setNaming(true)} style={[s.chip, s.save]}>
            <Icon name="add" size={15} color={colors.primary} />
            <Text style={s.chipText}>{t.saved.save}</Text>
          </Pressable>
        )}
      </ScrollView>
      <Sheet typing visible={naming} title={t.saved.nameTitle} onClose={() => setNaming(false)}>
        <Text style={s.hint}>{t.saved.nameHint(typed)}</Text>
        <TextInput style={s.input} value={nickname} onChangeText={setNickname} maxLength={30} autoFocus placeholder={t.saved.namePlaceholder}
          placeholderTextColor={colors.muted} accessibilityLabel={t.saved.nameTitle} onSubmitEditing={() => nickname.trim() && save()} />
        <Button label={t.saved.save} icon="bookmark" disabled={!nickname.trim()} onPress={save} />
      </Sheet>
    </>
  )
}

const s = StyleSheet.create({
  row: { gap: 8, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 180 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  save: { borderStyle: 'dashed', borderColor: colors.primary },
  chipText: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, marginBottom: 12 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text },
})
