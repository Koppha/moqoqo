import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import type { LocalizedText, ServiceDef, ServicePlacement } from '../../shared/api'
import type { IconName } from '../components/ui'
import { useLanguage } from '../i18n'
import { api } from './api'

// Services defined in the portal (Send money to other networks, airtime, bundles, self service). Fetched from the
// server and refreshed whenever a screen that shows them comes into view, so portal changes appear without an update.

let cache: ServiceDef[] | null = null

export function useServices(placement?: ServicePlacement): { services: ServiceDef[]; loading: boolean; failed: boolean } {
  const [services, setServices] = useState<ServiceDef[] | null>(cache)
  const [failed, setFailed] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let live = true
      api<ServiceDef[]>('/v1/services').then(
        (list) => {
          cache = list
          if (live) {
            setServices(list)
            setFailed(false)
          }
        },
        () => live && setFailed(true),
      )
      return () => {
        live = false
      }
    }, []),
  )
  const all = services ?? []
  return { services: placement ? all.filter((s) => s.placement === placement) : all, loading: services === null && !failed, failed }
}

export const cachedService = (id: string) => cache?.find((s) => s.id === id)

/** Portal texts come in English and Sesotho; empty Sesotho falls back to English. */
export function useLocalized() {
  const { lang } = useLanguage()
  return (text: LocalizedText | undefined) => (text ? (lang === 'st' && text.st.trim() ? text.st : text.en) : '')
}

/** Icons are typed in the portal; an unknown name shows Ionicons' fallback. */
export const serviceIcon = (def: ServiceDef) => def.icon as IconName
