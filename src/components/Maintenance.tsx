import Constants from 'expo-constants'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import type { AppConfig, LocalizedText, Maintenance } from '../../shared/api'
import { useLanguage, useT, type Lang } from '../i18n'
import { api } from '../lib/api'
import { FORM_MAX } from '../lib/layout'
import { hhmm } from '../lib/mappers'
import { canDialUssd, dialUssd, useUssd } from '../lib/ussd'
import { APP } from '../lib/variant'
import { useAppState } from '../state/AppState'
import { colors, gradients, radius } from '../theme'
import { Button, Icon } from './ui'

const pad = (n: number) => n.toString().padStart(2, '0')
const day = (iso: string, weekdays: string[]) => {
  const d = new Date(iso)
  return `${weekdays.at(d.getDay()) ?? ''} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()
const pick = (text: LocalizedText, lang: Lang) => text[lang] || text.en

/** a.b.c < x.y.z */
const older = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x.at(i) ?? 0) !== (y.at(i) ?? 0)) return (x.at(i) ?? 0) < (y.at(i) ?? 0)
  return false
}

export function useNotices() {
  const { state } = useAppState()
  const cfg = state.config
  const active: Maintenance | null = cfg?.maintenance?.active ? cfg.maintenance : state.maintenanceHit
  const upcoming = cfg?.maintenance && !cfg.maintenance.active ? cfg.maintenance : null
  const min = cfg?.minVersion[APP]
  const updateRequired = !!min && older(Constants.expoConfig?.version ?? '0.0.0', min)
  return { active, upcoming, announcement: cfg?.announcement ?? null, updateRequired }
}

/** Full-screen page while planned maintenance is on (or this build is too old). Sits above everything, login included. */
export function MaintenanceGate() {
  const t = useT()
  const { lang } = useLanguage()
  const { dispatch } = useAppState()
  const { active, updateRequired } = useNotices()
  // Money still moves on USSD while the app is down: point people to the code set in the portal.
  const ussd = useUssd()
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    try {
      dispatch({ type: 'config', config: await api<AppConfig>('/v1/app-config') })
    } catch {
      // Still unreachable; stay on this page.
    }
    setChecking(false)
  }

  // Look again on our own once the window should be over.
  const ends = active?.endsAt
  useEffect(() => {
    if (!ends) return
    const ms = Math.max(5_000, new Date(ends).getTime() - Date.now() + 5_000)
    const timer = setTimeout(async () => {
      try {
        dispatch({ type: 'config', config: await api<AppConfig>('/v1/app-config') })
      } catch {
        // Next poll will catch it.
      }
    }, ms)
    return () => clearTimeout(timer)
  }, [ends, dispatch])

  const visible = !!active || updateRequired
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <LinearGradient colors={gradients.hero} style={g.frame}>
        <View style={g.column} accessibilityLiveRegion="polite">
          <View style={g.icon}><Icon name={updateRequired && !active ? 'cloud-download' : 'construct'} size={40} color="#fff" /></View>
          {active ? (
            <>
              <Text style={g.title}>{t.maint.title}</Text>
              <Text style={g.body}>{pick(active.message, lang)}</Text>
              <View style={g.until}>
                <Icon name="time-outline" size={18} color={colors.heroMuted} />
                <Text style={g.untilText}>
                  {t.maint.backAt(sameDay(active.endsAt, new Date().toISOString()) ? hhmm(active.endsAt) : `${day(active.endsAt, t.common.weekdays)} ${hhmm(active.endsAt)}`)}
                </Text>
              </View>
              {ussd.enabled && (
                <View style={g.ussd}>
                  <Icon name="keypad" size={20} color="#fff" />
                  <Text style={g.ussdText}>{t.maint.ussd(ussd.code)}</Text>
                </View>
              )}
              {ussd.enabled && canDialUssd && (
                <Button label={t.maint.dial(ussd.code)} icon="call" onPress={() => dialUssd(ussd.code)} style={{ alignSelf: 'stretch', marginTop: 16 }} />
              )}
              <Button label={t.maint.checkAgain} variant="dark" disabled={checking} onPress={check} style={{ alignSelf: 'stretch', marginTop: ussd.enabled && canDialUssd ? 10 : 28 }} />
            </>
          ) : (
            <>
              <Text style={g.title}>{t.maint.updateTitle}</Text>
              <Text style={g.body}>{t.maint.updateBody}</Text>
            </>
          )}
        </View>
      </LinearGradient>
    </Modal>
  )
}

/** Upcoming maintenance and staff announcements, shown at the top of Home. */
export function NoticeBanners() {
  const t = useT()
  const { lang } = useLanguage()
  const { upcoming, announcement } = useNotices()
  if (!upcoming && !announcement) return null
  const when = upcoming
    ? sameDay(upcoming.startsAt, upcoming.endsAt)
      ? `${day(upcoming.startsAt, t.common.weekdays)} ${hhmm(upcoming.startsAt)}–${hhmm(upcoming.endsAt)}`
      : `${day(upcoming.startsAt, t.common.weekdays)} ${hhmm(upcoming.startsAt)} – ${day(upcoming.endsAt, t.common.weekdays)} ${hhmm(upcoming.endsAt)}`
    : ''
  return (
    <View style={{ gap: 10, marginTop: 16 }}>
      {upcoming && (
        <View style={[g.banner, { backgroundColor: colors.warnSoft }]} accessibilityRole="alert">
          <Icon name="construct-outline" size={20} color={colors.warn} />
          <Text style={[g.bannerText, { color: '#7C4A03' }]}>{t.maint.upcoming(when)}</Text>
        </View>
      )}
      {announcement && (
        <View style={[g.banner, { backgroundColor: colors.primarySoft }]}>
          <Icon name="megaphone-outline" size={20} color={colors.primary} />
          <Text style={[g.bannerText, { color: colors.primaryDark }]}>{pick(announcement, lang)}</Text>
        </View>
      )}
    </View>
  )
}

const g = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'center', padding: 24 },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', alignItems: 'center' },
  icon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { color: colors.heroText, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.heroMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12 },
  until: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  untilText: { color: colors.heroText, fontSize: 15, fontWeight: '600' },
  ussd: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.12)', padding: 14, borderRadius: radius.md },
  ussdText: { flex: 1, color: colors.heroText, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: radius.md },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: '500' },
})
