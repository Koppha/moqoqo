import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { AppState, View } from 'react-native'
import { DEFAULT_DEVICE_SECURITY } from '../../shared/api'
import { useT } from '../i18n'
import { useAppState } from '../state/AppState'
import { useAuth } from '../state/Auth'

/**
 * Signs the person out after the portal's minutes without use (App settings › idleMinutes, at most 15: CBL/LCA DFS
 * guidelines 3.2.8a): no touch while the app is open, or that long away in the background. One timer, re-armed on
 * touch (at most every few seconds). The server ends idle sessions too; this makes it happen on screen at once.
 */
export function IdleSignOut({ children }: { children: ReactNode }) {
  const t = useT()
  const { status, signOut } = useAuth()
  const { state, dispatch } = useAppState()
  const minutes = state.config?.deviceSecurity?.idleMinutes ?? DEFAULT_DEVICE_SECURITY.idleMinutes
  const limit = minutes * 60_000
  const signedIn = status === 'locked' || status === 'unlocked'
  const last = useRef(0) // set on mount and on every touch
  const armedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const expire = useCallback(() => {
    clear()
    void signOut(true)
    dispatch({ type: 'toast', text: t.idle.signedOut(minutes) })
  }, [signOut, dispatch, t, minutes])
  const arm = useCallback(() => {
    clear()
    if (!signedIn) return
    armedAt.current = Date.now()
    timer.current = setTimeout(expire, Math.max(1_000, limit - (Date.now() - last.current)))
  }, [signedIn, limit, expire])

  useEffect(() => {
    last.current = Date.now()
    arm()
    return clear
  }, [arm])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return clear()
      if (signedIn && Date.now() - last.current >= limit) expire()
      else arm()
    })
    return () => sub.remove()
  }, [signedIn, limit, expire, arm])

  const touch = () => {
    last.current = Date.now()
    if (signedIn && Date.now() - armedAt.current > 5_000) arm()
  }

  return <View style={{ flex: 1 }} onTouchStart={touch}>{children}</View>
}
