import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { isApiError } from '../api'
import { useAuth } from '../auth'
import { Button } from '../components/ui'
import { Icon } from '../components/Icon'

function loginErrorText(e: unknown): string {
  if (isApiError(e)) {
    if (e.code === 'NETWORK') return "Can't reach the EcoCash Super App server. Check your connection or VPN and try again."
    if (e.code === 'UNAUTHORIZED' || e.code === 'VALIDATION') return 'That email and password combination is not right.'
    if (e.code === 'FORBIDDEN') return 'This account is not allowed to use the staff portal.'
    return e.message
  }
  return 'Sign-in failed. Please try again.'
}

export function LoginPage() {
  const { admin, login, expired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: string } | null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (admin) return <Navigate to={state?.from ?? '/'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate(state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(loginErrorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-hero" aria-hidden="true">
        <span className="brand-mark brand-mark-lg">E</span>
        <p className="login-hero-title">EcoCash Super App</p>
        <p className="login-hero-sub">Chat and pay with EcoCash · Staff portal</p>
      </div>
      <main className="login-card card">
        <h1>Sign in</h1>
        <p className="muted">For Econet Telecom Lesotho staff only.</p>
        {expired && !error && (
          <p className="notice notice-warn" role="status">
            Your session ended. Please sign in again.
          </p>
        )}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Work email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={16} /> {error}
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy} className="btn-block">
            Sign in
          </Button>
        </form>
      </main>
    </div>
  )
}
