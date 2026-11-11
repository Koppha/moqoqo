import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { Admin } from '../../shared/api'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'

const ADMIN_KEY = 'moqoqo.admin.profile'

interface AuthState {
  admin: Admin | null
  /** False for the read-only support role. */
  canWrite: boolean
  /** True after the server ended the session (401); shown on the login page. */
  expired: boolean
  login: (email: string, password: string) => Promise<Admin>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

function readCachedAdmin(): Admin | null {
  if (!getToken()) return null
  try {
    const raw = sessionStorage.getItem(ADMIN_KEY)
    return raw ? (JSON.parse(raw) as Admin) : null
  } catch {
    return null
  }
}

function cacheAdmin(admin: Admin | null) {
  try {
    if (admin) sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin))
    else sessionStorage.removeItem(ADMIN_KEY)
  } catch {
    // ignore
  }
}

export function AuthProvider({ children, initialAdmin }: { children: ReactNode; initialAdmin?: Admin | null }) {
  const [admin, setAdmin] = useState<Admin | null>(() => (initialAdmin !== undefined ? initialAdmin : readCachedAdmin()))
  const [expired, setExpired] = useState(false)
  const navigate = useNavigate()

  const clear = useCallback(() => {
    setToken(null)
    cacheAdmin(null)
    setAdmin(null)
  }, [])

  // Any 401 from the API: drop the session and go to the login page.
  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        clear()
        setExpired(true)
        navigate('/login', { replace: true })
      }),
    [clear, navigate],
  )

  // Refresh the profile once per load (role may have changed); a 401 here triggers the handler above.
  useEffect(() => {
    if (!getToken() || initialAdmin !== undefined) return
    let cancelled = false
    api
      .me()
      .then((a) => {
        if (cancelled) return
        cacheAdmin(a)
        setAdmin(a)
      })
      .catch(() => {
        // network errors keep the cached profile; pages show their own error states
      })
    return () => {
      cancelled = true
    }
  }, [initialAdmin])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password })
    setToken(res.token)
    setExpired(false)
    cacheAdmin(res.admin)
    setAdmin(res.admin)
    return res.admin
  }, [])

  const logout = useCallback(() => {
    // Best effort: revoke the token server-side, but sign out locally regardless.
    if (getToken()) api.logout().catch(() => {})
    clear()
    setExpired(false)
    navigate('/login', { replace: true })
  }, [clear, navigate])

  const value = useMemo<AuthState>(
    () => ({ admin, canWrite: admin?.role === 'admin', expired, login, logout }),
    [admin, expired, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export const READ_ONLY_REASON = 'Your support account is read-only. Ask an admin to make this change.'
