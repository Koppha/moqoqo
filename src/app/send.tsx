import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { localNumber, USERNAME_PATTERN } from '../../shared/api'
import { ContactPickButton } from '../components/ContactPickButton'
import { iconForChat } from '../components/icons'
import { Avatar, Card, Header, Icon, ListRow, Screen } from '../components/ui'
import { UssdFallback } from '../components/UssdFallback'
import { useT } from '../i18n'
import { maskMsisdn } from '../lib/format'
import { serviceIcon, useLocalized, useServices } from '../lib/services'
import { useChats } from '../state/AppState'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const VALID = /^[56]\d{7}$/
const isUsername = (v: string) => USERNAME_PATTERN.test(v.replace(/^@/, '').toLowerCase())

/**
 * Send money. EcoCash to EcoCash happens in the chat with that person. Other networks and wallets (C-Pay, Khetsi,
 * M-Pesa, …) are services defined in the portal: each has its own form, because they need different details.
 */
export default function Send() {
  const t = useT()
  const L = useLocalized()
  const chats = useChats()
  const { startChat } = useMoqoqo()
  const { services } = useServices('send')
  const [number, setNumber] = useState('')
  const ready = VALID.test(number) || isUsername(number)
  const offlineNumber = VALID.test(number) ? number : undefined
  const contacts = chats.filter((c) => c.kind === 'direct' && !!c.msisdn).slice(0, 8)

  const ecocash = async (chatId: string | null) => {
    if (chatId) router.push({ pathname: '/chat/[id]', params: { id: chatId, send: 'open' } })
  }

  return (
    <Screen>
      <Header title={t.svc.sendTitle} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <Text style={s.section}>EcoCash</Text>
        <Card>
          <Text style={s.hint}>{t.svc.ecocashHint}</Text>
          <View style={s.numberRow}>
            <View style={s.field}>
              {!number.startsWith('@') && /^\d/.test(number) && <Text style={s.prefix}>+266</Text>}
              <TextInput style={[s.input, !number && s.empty]} numberOfLines={1} value={number} onChangeText={(v) => setNumber(/^[\d+(]/.test(v.trim()) ? localNumber(v) : v.replace(/[^@A-Za-z0-9._]/g, '').slice(0, 21))}
                autoCapitalize="none" autoCorrect={false} placeholder={t.svc.numberOrUsername} placeholderTextColor={colors.muted} accessibilityLabel={t.svc.ecocashNumber} />
              <ContactPickButton onPick={(n) => setNumber(n)} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t.svc.next} accessibilityState={{ disabled: !ready }} disabled={!ready}
              onPress={async () => ecocash(await startChat(VALID.test(number) ? '+266' + number : '@' + number.replace(/^@/, '')))}
              style={({ pressed }) => [s.go, !ready && s.goOff, pressed && { opacity: 0.85 }]}>
              <Icon name="arrow-forward" size={24} color="#fff" />
            </Pressable>
          </View>
          {contacts.map((c, i) => (
            <ListRow key={c.id} last={i === contacts.length - 1} onPress={() => ecocash(c.id)} left={<Avatar name={c.name} icon={iconForChat(c)} size={40} photo={c.other?.photo} />}
              title={c.name} subtitle={c.msisdn ? maskMsisdn(c.msisdn) : ''} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
          ))}
        </Card>
        <UssdFallback fn="send" values={{ number: offlineNumber }} details={offlineNumber ? [t.ussd.number(offlineNumber)] : undefined} />
        <Card style={{ marginTop: 12, paddingVertical: 4 }}>
          <ListRow last onPress={() => router.push('/send-many')} left={<Avatar name={t.sendMany.title} icon="people" color={colors.primary} size={40} />}
            title={t.sendMany.title} subtitle={t.sendMany.entryHint} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
        </Card>

        {services.length > 0 && (
          <>
            <Text style={s.section}>{t.svc.otherNetworks}</Text>
            <Card style={{ paddingVertical: 4 }}>
              {services.map((sv, i) => (
                <ListRow key={sv.id} last={i === services.length - 1} onPress={() => router.push({ pathname: '/service/[id]', params: { id: sv.id } })}
                  left={<Avatar name={L(sv.name)} icon={serviceIcon(sv)} color={sv.color} size={40} />} title={L(sv.name)} subtitle={L(sv.description)}
                  right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
              ))}
            </Card>
          </>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 10 },
  numberRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 6 },
  // The field and the round arrow share one height, so they line up.
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, paddingLeft: 18, paddingRight: 12, backgroundColor: colors.surface },
  prefix: { fontSize: 16, fontWeight: '600', color: colors.text, marginRight: 8 },
  input: { flex: 1, fontSize: 17, color: colors.text, letterSpacing: 1 },
  // The placeholder fits beside the contacts icon without the digits' spacing.
  empty: { fontSize: 15, letterSpacing: 0 },
  go: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  goOff: { opacity: 0.4 },
})
