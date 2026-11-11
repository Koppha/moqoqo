import { router, useFocusEffect, type Href } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking } from 'react-native'
import { HOME_SECTIONS, type HomeContent, type Offer } from '../../shared/api'
import { api } from './api'
import { apiUrl } from './server'
import { appModeNow } from '../state/Auth'

// Home layout and banners come from the portal (Home & offers); refreshed whenever Home comes into view.

const FALLBACK: HomeContent = { layout: { sections: HOME_SECTIONS.map((key) => ({ key, visible: true })) }, offers: [] }
let cache: HomeContent | null = null

export function useHomeContent(): HomeContent {
  const [content, setContent] = useState<HomeContent>(cache ?? FALLBACK)
  useFocusEffect(useCallback(() => {
    let live = true
    api<HomeContent>('/v1/home').then((c) => {
      cache = c
      if (live) setContent(c)
    }, () => {})
    return () => {
      live = false
    }
  }, []))
  return content
}

/** Full URL of an uploaded picture (/v1/assets/…). */
export const assetUri = (path: string) => apiUrl() + path

const SCREEN: Record<string, Href> = {
  ecosure: '/ecosure',
  ecosure_funeral: '/ecosure/quote/funeral',
  ecosure_short_term: '/ecosure/quotes',
  send: '/send',
  topup: '/topup',
  bank: '/bank',
  remit: '/remit',
  atm: '/atm',
  money: '/money',
  receive_money: '/receive-money',
  split: '/split',
  lec: '/lec',
  news: '/news',
}

/** Where tapping a banner goes. Screens the business app doesn't have do nothing there. */
export function openOffer(o: Offer) {
  const t = o.target
  if (!t) return
  if (t.startsWith('url:')) return void Linking.openURL(t.slice(4))
  if (t.startsWith('service:')) return router.push({ pathname: '/service/[id]', params: { id: t.slice(8) } })
  if (t === 'kyc') return router.push('/me')
  const to = SCREEN[t]
  if (to && (appModeNow() === 'customer' || t === 'news')) router.push(to)
}
