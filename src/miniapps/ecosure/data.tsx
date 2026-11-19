// Shared EcoSure data for the mini app's screens: the catalogue, my policies and sponsorships.
// Loaded when EcoSure opens and refreshed after every change, or when an EcoSure chat message arrives.
// A guest (the standalone EcoSure app before sign-in) gets the catalogue only: no policies or sponsorships.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EsContent, EsCover, EsPolicy, EsProduct, EsSponsorships } from '../../../shared/api'
import { useAppState } from '../../state/AppState'
import { useAuth } from '../../state/Auth'
import { ecosure } from './api'

interface EcoSureData {
  products: EsProduct[] | null
  /** Ts&Cs and the call centre number (portal); null until loaded. */
  content: EsContent | null
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
  const [content, setContent] = useState<EsContent | null>(null)
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
    ecosure.content().then((c) => { if (alive) setContent(c) }, () => {})
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
    content,
    policies,
    policy: policies?.find((p) => p.status !== 'cancelled') ?? null,
    sponsorships,
    error,
    refresh,
    setPolicy: (p) => setPolicies((list) => (list ? [p, ...list.filter((x) => x.id !== p.id)] : [p])),
  }), [products, content, policies, sponsorships, error, refresh])
  return <Ctx value={value}>{children}</Ctx>
}

export function useEcoSure() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEcoSure must be used inside EcoSureProvider')
  return ctx
}

/** Funeral packages from the catalogue, in EcoSure's order, with the premium for a cover type (0 when not offered). */
export function funeralPackages(products: EsProduct[] | null) {
  const premium = (p: EsProduct, cover: EsCover) => p.options.find((o) => o.cover === cover)?.monthlyPremium
  return (products ?? [])
    .filter((p) => p.line === 'funeral')
    .map((p) => ({
      code: p.code,
      name: p.name,
      premium: { family: premium(p, 'family') ?? 0, single: premium(p, 'single') ?? 0 },
      /** EcoSure's terms per cover: what it pays out, waiting period, beneficiary required. */
      terms: { family: p.options.find((o) => o.cover === 'family'), single: p.options.find((o) => o.cover === 'single') },
      tagline: p.tagline,
      popular: !!p.popular,
    }))
}

/** The packages that offer a cover (EcoSure may sell a tier as family or single only). */
export function packagesFor<T extends { terms: Record<EsCover, unknown> }>(packages: T[], cover: EsCover): T[] {
  return packages.filter((p) => p.terms[cover])
}

/** The package the app picks first: the one marked most popular in the portal, else the first. */
export function defaultPackage<T extends { code: string; popular?: boolean }>(packages: T[]): T | undefined {
  return packages.find((p) => p.popular) ?? packages[0]
}

/** The lowest monthly price for a funeral cover in the catalogue, or null before it loads. */
export function cheapestFuneral(products: EsProduct[] | null, cover: EsCover): number | null {
  const prices = (products ?? []).filter((p) => p.line === 'funeral').flatMap((p) => p.options.filter((o) => o.cover === cover).map((o) => o.monthlyPremium))
  return prices.length ? Math.min(...prices) : null
}
