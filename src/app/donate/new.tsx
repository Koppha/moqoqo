import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { Cause } from '../../../shared/api'
import { Button, Header, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { api, ApiFailure } from '../../lib/api'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

const cleanAmount = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}

/** Start a cause: title, what it is for, and a target. It opens on its own page, ready to share. */
export default function NewCause() {
  const t = useT()
  const moqoqo = useMoqoqo()
  const [title, setTitle] = useState('')
  const [story, setStory] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = title.trim().length >= 3 && story.trim().length >= 10 && Number(target) > 0

  const create = async () => {
    setBusy(true)
    try {
      const c = await api<Cause>('/v1/causes', { body: { title: title.trim(), description: story.trim(), target: Number(target) } })
      router.replace({ pathname: '/donate/[code]', params: { code: c.code } })
    } catch (e) {
      // "Verify your ID first", "The target can be at most …": the server says exactly what to fix.
      if (e instanceof ApiFailure && ['VALIDATION', 'CONFLICT', 'FORBIDDEN'].includes(e.code)) moqoqo.toast(e.message)
      else moqoqo.fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen footer={<View style={s.footer}><Button label={t.donate.create} disabled={busy || !ready} onPress={create} /></View>}>
      <Header title={t.donate.newTitle} />
      <Text style={s.label}>{t.donate.titleLabel}</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={60} placeholder={t.donate.titlePlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={t.donate.titleLabel} />
      <Text style={s.label}>{t.donate.storyLabel}</Text>
      <TextInput style={[s.input, s.story]} value={story} onChangeText={setStory} maxLength={1000} multiline textAlignVertical="top"
        placeholder={t.donate.storyPlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={t.donate.storyLabel} />
      <Text style={s.label}>{t.donate.targetLabel}</Text>
      <TextInput style={s.input} value={target} onChangeText={(v) => setTarget(cleanAmount(v))} keyboardType="decimal-pad" maxLength={10} placeholder="M 0.00"
        placeholderTextColor={colors.muted} accessibilityLabel={t.donate.targetLabel} />
      <Text style={s.hint}>{t.donate.createHint}</Text>
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.text },
  story: { minHeight: 120 },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 16 },
  footer: { paddingHorizontal: 16, paddingBottom: 20 },
})
