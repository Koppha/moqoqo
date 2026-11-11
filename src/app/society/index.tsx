import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { SocietyApplication, SocietyApplySettings, SocietySummary } from '../../../shared/api'
import { KIND_LOOK } from '../../components/icons'
import { Avatar, Button, Card, CircleIconButton, Header, Icon, ListRow, Pill, Screen, SectionTitle } from '../../components/ui'
import { Sheet, SheetOption } from '../../components/Sheet'
import { STRINGS, useLanguage, useT } from '../../i18n'
import { SOCIETY_NAMES, setSocietyNamePref, useSocietyNamePref, type SocietyNamePref } from '../../lib/societyName'
import { api } from '../../lib/api'
import { fmt } from '../../lib/format'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors } from '../../theme'
import { APP } from '../../lib/variant'

/**
 * Society (Mekhatlo), step 1: choose a society, a Motšelo or a burial society, or register a new one. Applications
 * in progress show what happens next (being checked, collect the Mokhatlo SIM, or why it wasn't approved).
 */
export default function Societies() {
  const t = useT()
  const { fail, toast } = useMoqoqo()
  const [list, setList] = useState<SocietySummary[] | null>(null)
  const [apps, setApps] = useState<SocietyApplication[]>([])
  const [settings, setSettings] = useState<SocietyApplySettings | null>(null)
  const [naming, setNaming] = useState(false)
  const namePref = useSocietyNamePref()
  const { lang } = useLanguage()
  const chooseName = (p: SocietyNamePref) => {
    setNaming(false)
    setSocietyNamePref(p)
    toast(t.society.nameSet(p === 'auto' ? STRINGS[lang].society.title : SOCIETY_NAMES[p]))
  }

  const load = useCallback(() => {
    let live = true
    Promise.all([
      api<SocietySummary[]>('/v1/societies'),
      api<SocietyApplication[]>('/v1/society-applications'),
      api<SocietyApplySettings>('/v1/society-apply-settings'),
    ])
      .then(([l, a, s]) => {
        if (!live) return
        setList(l)
        // Open societies are in the list already; cancelled ones need no reminder.
        setApps(a.filter((x) => x.status !== 'cancelled' && x.status !== 'active'))
        setSettings(s)
      })
      .catch((e) => {
        if (live) setList([])
        fail(e)
      })
    return () => {
      live = false
    }
    // fail is recreated each render; loading once per focus is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useFocusEffect(load)

  const cancel = async (a: SocietyApplication) => {
    try {
      await api(`/v1/society-applications/${a.id}/cancel`, { body: {} })
      toast(t.society.appCancelled)
      setApps((xs) => xs.filter((x) => x.id !== a.id))
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Screen>
      <Header title={t.society.title} back={APP !== 'society'} right={<CircleIconButton icon="text" label={t.society.nameTitle} onPress={() => setNaming(true)} />} />
      <Text style={s.intro}>{t.society.intro}</Text>
      {!list ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        : list.length === 0 ? (
          <View style={s.empty}>
            <Icon name="people-outline" size={56} color={colors.muted} />
            <Text style={s.emptyText}>{t.society.empty}</Text>
          </View>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {list.map((x, i) => (
              <ListRow key={x.id} last={i === list.length - 1} onPress={() => router.push(`/society/${x.id}`)}
                left={<Avatar name={x.name} icon={KIND_LOOK[x.kind].icon} color={KIND_LOOK[x.kind].color} size={42} />}
                title={x.name}
                subtitle={`${t.society.kinds[x.kind]} ${x.code} · ${t.society.roles[x.myRole]} · ${t.society.members(x.memberCount)}`}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={s.balance}>{fmt(x.balance)}</Text>
                    {x.awaitingMe > 0 && <Pill label={t.society.waitingYou(x.awaitingMe)} tone="warn" />}
                  </View>
                } />
            ))}
          </Card>
        )}

      {apps.length > 0 && (
        <>
          <SectionTitle title={t.society.applications} />
          {apps.map((a) => (
            <Card key={a.id} style={s.app}>
              <View style={s.appHead}>
                <Avatar name={a.name} icon={KIND_LOOK[a.kind].icon} color={KIND_LOOK[a.kind].color} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={s.appName}>{a.name}</Text>
                  <Text style={s.muted}>{t.society.kinds[a.kind]} · {a.reference}</Text>
                </View>
                <Pill label={t.society.appStatus[a.status]} tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'primary' : 'warn'} />
              </View>
              {a.status === 'pending' && <Text style={s.appText}>{t.society.pendingText}</Text>}
              {a.status === 'approved' && settings && <Text style={s.appText}>{settings.collectInstructions} {t.society.quote(a.reference)}</Text>}
              {a.status === 'rejected' && a.reason && <Text style={s.appText}>{a.reason}</Text>}
              {a.status === 'pending' && <Button label={t.society.cancelApp} variant="ghost" onPress={() => cancel(a)} />}
            </Card>
          ))}
        </>
      )}

      {settings?.enabled && (
        <Button label={t.society.register} variant="ghost" icon="add-circle" onPress={() => router.push('/society/apply')} style={{ marginTop: 16 }} />
      )}
      <Sheet visible={naming} title={t.society.nameTitle} onClose={() => setNaming(false)}>
        <SheetOption icon="language" color="#16A34A" title={t.society.nameAuto(STRINGS[lang].society.title)} subtitle={t.society.nameAutoHint}
          selected={namePref === 'auto'} onPress={() => chooseName('auto')} />
        {(['society', 'mekhatlo'] as const).map((p) => (
          <SheetOption key={p} icon="people" color="#0F766E" title={SOCIETY_NAMES[p]} subtitle={t.society.nameFixed}
            selected={namePref === p} onPress={() => chooseName(p)} />
        ))}
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  intro: { fontSize: 14.5, color: colors.muted, lineHeight: 21, marginBottom: 16 },
  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24, gap: 16 },
  emptyText: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  balance: { fontSize: 15, fontWeight: '700', color: colors.text },
  app: { marginBottom: 10 },
  appHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appName: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted, marginTop: 2 },
  appText: { fontSize: 13.5, color: colors.text, lineHeight: 20, marginTop: 10 },
})
