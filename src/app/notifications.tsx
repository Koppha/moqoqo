import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import {
  NOTIFY_CHANNELS,
  NOTIFY_MATRIX,
  type ChoosableCategory,
  type NotificationSettings,
  type NotifyChannel,
  type PushTestResult,
} from '../../shared/api'
import { Sheet } from '../components/Sheet'
import { Button, Card, Header, Icon, Screen } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { maskMsisdn } from '../lib/format'
import { enableNotifications, getPushProblem, previewPush, pushPermission, type PushPermission } from '../lib/notifications'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors, radius } from '../theme'

const ROWS: ChoosableCategory[] = ['money', 'requests', 'ecosure', 'chats', 'news']

/** Push on this phone: on, off or blocked in the phone's settings, and a test that goes through the real server push. */
function PhonePush() {
  const t = useT()
  const { toast } = useMoqoqo()
  const [permission, setPermission] = useState<PushPermission | null>(null)
  const [testing, setTesting] = useState(false)
  const refresh = useCallback(() => {
    pushPermission().then(setPermission, () => setPermission('blocked'))
  }, [])
  useEffect(() => {
    refresh()
    // Back from the phone's settings: show what changed.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh())
    return () => sub.remove()
  }, [refresh])

  const onRow = async () => {
    if (permission === 'blocked') return Linking.openSettings()
    if (permission === 'off') {
      await enableNotifications()
      refresh()
    }
  }
  const test = async () => {
    if (permission !== 'on') return toast(t.notifications.testNeedsOn)
    setTesting(true)
    try {
      const r = await api<PushTestResult>('/v1/devices/test', { body: {} })
      if (r.status === 'sent') toast(t.notifications.testSent)
      else if (r.status === 'failed') toast(t.notifications.testFailed(r.error ?? getPushProblem() ?? '?'))
      else {
        // No real push from this server yet: show how one looks, from the phone itself.
        toast(t.notifications.testPreview)
        await previewPush(t.notifications.testTitle, t.notifications.testBody, 5)
      }
    } catch {
      toast(t.notifications.testFailed(t.common.offline))
    } finally {
      setTesting(false)
    }
  }

  const sub = permission === 'on' ? t.notifications.phoneOn : permission === 'blocked' ? t.notifications.phoneBlocked : t.notifications.phoneOff
  // The technical reason (e.g. no Firebase in this build) is for support; people get a plain sentence.
  const problem = permission === 'on' && getPushProblem() ? t.notifications.noPushYet : null
  return (
    <Card style={{ marginTop: 16, paddingVertical: 4 }}>
      <Pressable accessibilityRole="button" onPress={onRow} disabled={permission === 'on'} style={[n.row, { gap: 12 }]}>
        <Icon name={permission === 'on' ? 'notifications' : 'notifications-off-outline'} size={22} color={permission === 'on' ? colors.success : colors.muted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={n.title}>{t.notifications.phoneTitle}</Text>
          <Text style={n.sub}>{sub}</Text>
          {problem && <Text style={[n.sub, { marginTop: 2 }]}>{problem}</Text>}
        </View>
        {permission !== 'on' && <Icon name="chevron-forward" size={18} color={colors.muted} />}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={test} disabled={testing} style={[n.row, { gap: 12, borderBottomWidth: 0 }]}>
        <Icon name="paper-plane-outline" size={22} color={colors.primary} />
        <Text style={[n.title, { flex: 1, color: colors.primary }]}>{t.notifications.test}</Text>
        {testing && <ActivityIndicator color={colors.primary} />}
      </Pressable>
    </Card>
  )
}

/** Me › Notifications: which kinds of notification come by push, SMS and email. Security alerts always come. */
export default function NotificationsScreen() {
  const t = useT()
  const { state, fail, toast } = useMoqoqo()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  useEffect(() => {
    api<NotificationSettings>('/v1/me/notifications').then(setSettings, () => setLoadError(true))
  }, [])

  /** Flip one switch straight away; put it back if the server refuses. */
  const flip = async (channel: NotifyChannel, category: ChoosableCategory, on: boolean) => {
    if (!settings) return
    if (channel === 'push' && on) await enableNotifications()
    const before = settings
    setSettings({ ...settings, prefs: { ...settings.prefs, [channel]: { ...settings.prefs[channel], [category]: on } } })
    try {
      setSettings(await api<NotificationSettings>('/v1/me/notifications', { method: 'PUT', body: { prefs: { [channel]: { [category]: on } } } }))
    } catch (e) {
      setSettings(before)
      fail(e)
    }
  }

  const removeEmail = async () => {
    try {
      setSettings(await api<NotificationSettings>('/v1/me/email', { method: 'DELETE' }))
      toast(t.notifications.emailRemoved)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Screen>
      <Header title={t.notifications.title} />
      {!settings ? (
        <View style={n.center}>{loadError ? <Text style={n.muted}>{t.notifications.loadFailed}</Text> : <ActivityIndicator color={colors.primary} />}</View>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          <Text style={n.intro}>{t.notifications.intro}</Text>

          <Card style={{ paddingVertical: 6 }}>
            <View style={n.headRow}>
              <View style={{ flex: 1 }} />
              {NOTIFY_CHANNELS.map((c) => <Text key={c} style={n.headCell}>{t.notifications.channels[c]}</Text>)}
            </View>
            {ROWS.map((category) => {
              const [title, sub] = t.notifications.categories[category]
              return (
                <View key={category} style={n.row}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={n.title}>{title}</Text>
                    <Text style={n.sub}>{sub}</Text>
                  </View>
                  {NOTIFY_CHANNELS.map((channel) => {
                    const offered = NOTIFY_MATRIX[channel].includes(category)
                    const needsEmail = channel === 'email' && !settings.emailVerified
                    const value = !!settings.prefs[channel][category]
                    return (
                      <View key={channel} style={n.cell}>
                        {offered ? (
                          <Switch value={value && !needsEmail} disabled={needsEmail} onValueChange={(on) => flip(channel, category, on)}
                            trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff"
                            accessibilityLabel={`${title}: ${t.notifications.channels[channel]}`} />
                        ) : <Text style={n.muted}>—</Text>}
                      </View>
                    )
                  })}
                </View>
              )
            })}
            <View style={[n.row, { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={n.title}>{t.notifications.security[0]}</Text>
                <Text style={n.sub}>{t.notifications.security[1]}</Text>
              </View>
              <View style={n.always}>
                <Icon name="lock-closed" size={14} color={colors.primary} />
                <Text style={n.alwaysText}>{t.notifications.alwaysOn}</Text>
              </View>
            </View>
          </Card>

          {state.me?.msisdn ? <Text style={n.note}>{t.notifications.smsTo(maskMsisdn(state.me.msisdn))}</Text> : null}
          <PhonePush />

          <Card style={{ marginTop: 16 }}>
            <Text style={n.title}>{t.notifications.emailTitle}</Text>
            {settings.email ? (
              <View style={n.emailRow}>
                <Text style={[n.sub, { flex: 1, color: colors.text, fontSize: 15 }]} numberOfLines={1}>{settings.email}</Text>
                {settings.emailVerified && <Text style={n.badge}>{t.notifications.emailVerified}</Text>}
              </View>
            ) : (
              <Text style={[n.sub, { marginTop: 4 }]}>{t.notifications.emailNone}</Text>
            )}
            {!settings.emailVerified && <Text style={[n.sub, { marginTop: 4 }]}>{t.notifications.emailNeeded}</Text>}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button label={settings.email ? t.notifications.emailChange : t.notifications.emailAdd} variant="ghost" onPress={() => setEmailOpen(true)} style={{ flex: 1 }} />
              {settings.email ? <Button label={t.notifications.emailRemove} variant="ghost" onPress={removeEmail} style={{ flex: 1 }} /> : null}
            </View>
          </Card>
        </View>
      )}
      <EmailSheet visible={emailOpen} initial={settings?.email ?? ''} onClose={() => setEmailOpen(false)} onDone={(s) => { setSettings(s); setEmailOpen(false); toast(t.notifications.emailConfirmed) }} />
    </Screen>
  )
}

/** Add or change the email address: send a 6-digit code to it, then type the code. */
function EmailSheet({ visible, initial, onClose, onDone }: { visible: boolean; initial: string; onClose: () => void; onDone: (s: NotificationSettings) => void }) {
  const t = useT()
  const { fail } = useMoqoqo()
  const [email, setEmail] = useState(initial)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    setSentTo(null)
    setCode('')
    onClose()
  }

  const sendCode = async () => {
    setBusy(true)
    try {
      await api<NotificationSettings>('/v1/me/email', { body: { email: email.trim() } })
      setSentTo(email.trim().toLowerCase())
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    try {
      const s = await api<NotificationSettings>('/v1/me/email/verify', { body: { code } })
      setSentTo(null)
      setCode('')
      onDone(s)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet typing visible={visible} title={t.notifications.emailTitle} onClose={close}>
      {!sentTo ? (
        <>
          <TextInput style={n.input} value={email} onChangeText={setEmail} placeholder={t.notifications.emailPlaceholder} placeholderTextColor={colors.muted}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
            accessibilityLabel={t.notifications.emailTitle} onSubmitEditing={sendCode} />
          <Button label={t.notifications.emailSendCode} disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} onPress={sendCode} />
        </>
      ) : (
        <>
          <Text style={[n.sub, { marginBottom: 10 }]}>{t.notifications.emailCodeSent(sentTo)}</Text>
          <TextInput style={[n.input, { letterSpacing: 6, textAlign: 'center', fontSize: 22 }]} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="000000" placeholderTextColor={colors.muted}
            accessibilityLabel={t.notifications.emailCode} onSubmitEditing={verify} />
          <Button label={t.notifications.emailVerify} disabled={busy || code.length !== 6} onPress={verify} />
          <Button label={t.notifications.emailChange} variant="ghost" onPress={() => setSentTo(null)} />
        </>
      )}
    </Sheet>
  )
}

const n = StyleSheet.create({
  center: { padding: 40, alignItems: 'center' },
  intro: { fontSize: 14, color: colors.muted, marginBottom: 12, marginTop: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6 },
  headCell: { width: 56, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cell: { width: 56, alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  muted: { color: colors.muted, fontSize: 14 },
  always: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  alwaysText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 10, paddingHorizontal: 4 },
  emailRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 },
  badge: { fontSize: 12, fontWeight: '700', color: colors.success },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 16, color: colors.text, marginBottom: 12 },
})
