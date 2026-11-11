import type { ReactNode } from 'react'
import { Image } from 'react-native'
import type { MiniAppIconId } from '../../shared/api'
import { assetUri } from '../lib/home'
import { useAppState } from '../state/AppState'

/** The mini app's icon uploaded in the portal (Branding › Mini app icons), or null for its built-in one. */
export function useMiniAppIcon(id: MiniAppIconId): string | null {
  const { state } = useAppState()
  const path = state.config?.branding.miniAppIcons?.[id]
  return path ? assetUri(path) : null
}

/**
 * The uploaded icon at `size`, rounded like the spot it fills (`radius`, default a circle), or `fallback` (the built-in
 * artwork) when none is uploaded. The same icon shows in EcoCash Super App and in the standalone app.
 */
export function MiniAppIcon({ id, size, radius = size / 2, fallback }: { id: MiniAppIconId; size: number; radius?: number; fallback: ReactNode }) {
  const uri = useMiniAppIcon(id)
  if (!uri) return fallback
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} resizeMode="cover" accessibilityIgnoresInvertColors />
}
