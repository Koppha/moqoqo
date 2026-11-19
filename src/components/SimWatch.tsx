import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, Modal, StyleSheet, Text, View } from 'react-native'
import { airplaneMode, canReadSims, getSims, type Sim } from '../../modules/sim-info'
import { CONTACT_DEFAULTS, SIM_NO_SERVICE_MINUTES, type SimSignal, type SimSignalBody, type SimSignalResult } from '../../shared/api'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { getSimulateEconet, isEconetSim } from '../lib/device'
import { FORM_MAX } from '../lib/layout'
import { useAppState } from '../state/AppState'
import { useAuth } from '../state/Auth'
import { colors, radius } from '../theme'
import { Button, Icon } from './ui'

/**
 * SIM swap watch (Android). Each time the app comes to the front (and every few minutes while it is open) the phone
 * compares its SIMs with the one EcoCash was set up with on it:
 * - a different SIM card where the EcoCash SIM was, or no EcoCash SIM at all → warn, and report it (the server asks
 *   Econet and holds money leaving EcoCash until the SIM is back or staff check the owner);
 * - the EcoCash SIM in, but no network for SIM_NO_SERVICE_MINUTES (outside airplane mode) → warn and report: this is
 *   what the victim's phone sees after their number was moved to a fraudster's SIM.
 * Each change is reported once; when the same SIM is back it says so ('sim_ok'). iPhone can't read the SIM: there the
 * server's Econet checks do the work.
 */

type Base = { key: string; slot: number; mcc: string | null; mnc: string | null }
type Seen = Exclude<SimSignal, 'sim_ok'> | 'ok'

const CHECK_EVERY_MS = 5 * 60_000
const keyOf = (s: Sim) => (s.subId != null ? `id:${s.subId}` : `slot:${s.slot}|${s.mcc ?? ''}${s.mnc ?? ''}`)
const k = (name: string, userId: string) => `moqoqo.sim.${name}.${userId}`

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const v = await SecureStore.getItemAsync(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}
const writeJson = (key: string, v: unknown) => SecureStore.setItemAsync(key, JSON.stringify(v)).catch(() => {})

export function SimWatch() {
  const t = useT()
  const { status } = useAuth()
  const { state } = useAppState()
  const me = state.me
  const userId = status === 'unlocked' && me?.role === 'customer' ? me.id : null
  const contact = state.config?.contact ?? CONTACT_DEFAULTS
  const [warn, setWarn] = useState<{ seen: Exclude<Seen, 'ok'>; minutes: number; held: boolean; episode: string } | null>(null)
  const dismissed = useRef<string | null>(null)
  const running = useRef(false)

  const check = useCallback(async () => {
    if (!userId || !canReadSims || running.current) return
    running.current = true
    try {
      const [sims, simulated] = await Promise.all([getSims(), getSimulateEconet()])
      const candidates = simulated ? sims : sims.filter(isEconetSim)
      let base = await readJson<Base>(k('base', userId))
      if (!base) {
        // First check after sign-in on this phone (the server matched the SIM then): remember the EcoCash SIM.
        const first = candidates.find((s) => s.inService !== false) ?? candidates[0]
        if (!first) return
        base = { key: keyOf(first), slot: first.slot, mcc: first.mcc, mnc: first.mnc }
        await writeJson(k('base', userId), base)
      }
      const baseKey = base.key

      const match = sims.find((s) => keyOf(s) === baseKey)
      let seen: Seen = 'ok'
      let minutes = 0
      let since = new Date().toISOString()
      if (!match) {
        seen = candidates.length ? 'sim_changed' : 'sim_removed'
      } else if (match.inService === false && !airplaneMode()) {
        const first = (await readJson<string>(k('noService', userId))) ?? since
        if (first === since) await writeJson(k('noService', userId), first)
        since = first
        minutes = Math.floor((Date.now() - Date.parse(first)) / 60_000)
        if (minutes >= SIM_NO_SERVICE_MINUTES) seen = 'no_service'
      } else {
        await SecureStore.deleteItemAsync(k('noService', userId)).catch(() => {})
      }

      const last = await readJson<{ seen: Seen; since: string }>(k('reported', userId))
      const report = async (signal: SimSignal) => {
        const body: SimSignalBody = {
          signal,
          since,
          ...(signal === 'no_service' ? { minutes } : {}),
          sims: sims.map((s) => ({ slot: s.slot, mcc: s.mcc, mnc: s.mnc, carrier: s.carrier, inService: s.inService ?? null })),
        }
        return api<SimSignalResult>('/v1/me/sim-signal', { method: 'POST', body })
      }

      if (seen === 'ok') {
        if (last && (last.seen === 'sim_changed' || last.seen === 'sim_removed')) await report('sim_ok')
        if (last && last.seen !== 'ok') await writeJson(k('reported', userId), { seen: 'ok', since })
        setWarn(null)
        return
      }

      let held = false
      if (last?.seen !== seen) {
        held = (await report(seen)).held
        await writeJson(k('reported', userId), { seen, since })
      } else {
        const s = await api<SimSignalResult>('/v1/me/sim-swap')
        held = s.held
        // Staff checked the owner in person and cleared it: this new SIM is now the EcoCash SIM.
        if (seen === 'sim_changed' && !s.held && !s.deviceOpen) {
          const now = candidates[0]
          if (now) {
            await writeJson(k('base', userId), { key: keyOf(now), slot: now.slot, mcc: now.mcc, mnc: now.mnc })
            await writeJson(k('reported', userId), { seen: 'ok', since })
            setWarn(null)
            return
          }
        }
      }
      const episode = `${seen}|${last?.seen === seen ? last.since : since}`
      if (dismissed.current !== episode) setWarn({ seen, minutes: Math.max(minutes, SIM_NO_SERVICE_MINUTES), held, episode })
    } catch {
      // Offline or the server didn't answer: try again at the next check.
    } finally {
      running.current = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId || !canReadSims) return
    const start = setTimeout(check, 0)
    const timer = setInterval(() => { if (AppState.currentState === 'active') check() }, CHECK_EVERY_MS)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check() })
    return () => {
      clearTimeout(start)
      clearInterval(timer)
      sub.remove()
    }
  }, [userId, check])

  if (!warn) return null
  const title = warn.seen === 'sim_changed' ? t.simWatch.changedTitle : warn.seen === 'sim_removed' ? t.simWatch.removedTitle : t.simWatch.noServiceTitle
  const body = warn.seen === 'sim_changed' ? t.simWatch.changedBody : warn.seen === 'sim_removed' ? t.simWatch.removedBody : t.simWatch.noServiceBody(warn.minutes)
  // Shown again only for a new episode (or after the app is restarted).
  const close = () => {
    dismissed.current = warn.episode
    setWarn(null)
  }

  return (
    <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={s.frame}>
        <View style={s.column} accessibilityLiveRegion="assertive">
          <View style={s.icon}><Icon name="warning-outline" size={36} color={colors.danger} /></View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.body}>{body}</Text>
          {warn.held && <Text style={s.held}>{t.simWatch.held}</Text>}
          <Button label={t.simWatch.call(contact.phone)} icon="call" onPress={() => Linking.openURL(`tel:${contact.phone.replace(/\s/g, '')}`).catch(() => {})} style={s.full} />
          <Button label={t.simWatch.ok} variant="ghost" onPress={close} style={s.full} />
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  column: { width: '100%', maxWidth: FORM_MAX, alignSelf: 'center', alignItems: 'center' },
  icon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { fontSize: 15, color: colors.text, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  held: { fontSize: 13.5, color: colors.text, textAlign: 'center', marginTop: 12, lineHeight: 19, backgroundColor: colors.surface, padding: 12, borderRadius: radius.md, overflow: 'hidden' },
  full: { alignSelf: 'stretch', marginTop: 14 },
})
