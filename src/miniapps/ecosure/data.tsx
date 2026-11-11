// Shared EcoSure data for the mini app's screens: the catalogue, my policies and sponsorships.
// Loaded when EcoSure opens and refreshed after every change, or when an EcoSure chat message arrives.
// A guest (the standalone EcoSure app before sign-in) gets the catalogue only: no policies or sponsorships.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EsCover, EsPolicy, EsProduct, EsSponsorships } from '../../../shared/api'
import { useAppState } from '../../state/AppState'
import { useAuth } from '../../state/Auth'
import { ecosure } from './api'

interface EcoSureData {
  products: EsProduct[] | null
  policies: EsPolicy[] | null
  /** My funeral policy (one per customer for now), if any. */
  policy: EsPolicy | null
  sponsorships: EsSponsorships | null
  error: boolean
  refresh(): Promise<void>
  setPolicy(p: EsPolicy): void
}

const Ctx = createContext<EcoSureData | null>(null)

export function EcoSureProvider({ children }: { children: ReactNode }) {
  const { state } = useAppState()
  const [products, setProducts] = useState<EsProduct[] | null>(null)
  const [policies, setPolicies] = useState<EsPolicy[] | null>(null)
  const [sponsorships, setSponsorships] = useState<EsSponsorships | null>(null)
  const [error, setError] = useState(false)
  const guest = useAuth().status === 'signedOut'
  const load = useCallback(
    () => Promise.all([ecosure.products(), guest ? Promise.resolve([]) : ecosure.policies(), guest ? Promise.resolve(null) : ecosure.sponsorships()]),
    [guest],
  )

  const refresh = useCallback(async () => {
    try {
      const [p, pol, sp] = await load()
      setProducts(p)
      setPolicies(pol)
      setSponsorships(sp)
      setError(false)
    } catch {
      setError(true)
    }
  }, [load])

  useEffect(() => {
    let alive = true
    load().then(
      ([p, pol, sp]) => { if (alive) { setProducts(p); setPolicies(pol); setSponsorships(sp); setError(false) } },
      () => { if (alive) setError(true) },
    )
    return () => { alive = false }
  }, [load])

  // Staff decisions, sponsorship requests and payments by others arrive as EcoSure chat messages: reload then.
  const ecosureChat = Object.values(state.chats).find((c) => c.kind === 'official' && c.members.some((u) => u.businessName === 'EcoSure' || u.name === 'EcoSure'))
  const lastSeen = useRef(ecosureChat?.lastMessage?.id)
  useEffect(() => {
    const id = ecosureChat?.lastMessage?.id
    if (id && id !== lastSeen.current) {
      lastSeen.current = id
      ecosure.policies().then(setPolicies, () => {})
      ecosure.sponsorships().then(setSponsorships, () => {})
    }
  }, [ecosureChat?.lastMessage?.id])

  const value = useMemo<EcoSureData>(() => ({
    products,
    policies,
    policy: policies?.find((p) => p.status !== 'cancelled') ?? null,
    sponsorships,
    error,
    refresh,
    setPolicy: (p) => setPolicies((list) => (list ? [p, ...list.filter((x) => x.id !== p.id)] : [p])),
  }), [products, policies, sponsorships, error, refresh])
  return <Ctx value={value}>{children}</Ctx>
}

export function useEcoSure() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEcoSure must be used inside EcoSureProvider')
  return ctx
}

/** Funeral packages from the catalogue, cheapest first, with the premium for a cover type. */
export function funeralPackages(products: EsProduct[] | null) {
  const premium = (p: EsProduct, cover: EsCover) => p.options.find((o) => o.cover === cover)?.monthlyPremium
  return (products ?? [])
    .filter((p) => p.line === 'funeral')
    .map((p) => ({ code: p.code, name: p.name, premium: { family: premium(p, 'family') ?? 0, single: premium(p, 'single') ?? 0 } }))
    .sort((a, b) => a.premium.family - b.premium.family)
}
