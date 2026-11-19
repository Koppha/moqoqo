import { useState } from 'react'
import { AUTH_EVENT_LABEL, type AuthEventKind } from '../../../shared/api'
import { api } from '../api'
import { Card, ErrorState, Loading, PageHeader } from '../components/ui'
import { formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

/** The columns of the daily table: the kinds staff watch (pin_ok is logged but too common to chart). */
const KINDS: AuthEventKind[] = ['login', 'login_failed', 'pin_wrong', 'pin_locked', 'unlock_failed', 'idle_signout', 'unusual_context', 'device_mismatch', 'reported_lost', 'auth_attack']
const WARN = new Set<AuthEventKind>(['login_failed', 'pin_locked', 'unusual_context', 'device_mismatch', 'reported_lost', 'auth_attack', 'rate_limited'])

/**
 * Sign-in monitoring (CBL/LCA DFS guidelines 3.2.5b-vi): every sign-in, PIN and unlock attempt is logged; this page
 * shows the trend, the addresses and wallets with the most refused attempts, and the latest events. Every 15 minutes
 * the server also looks for attacks (one address on many wallets, repeated locks, a phone unlike itself) and raises
 * alerts on the Risk page.
 */
export function SignInMonitorPage() {
  const [days, setDays] = useState(7)
  const m = useAsync(() => api.authMonitor(days), [days])
  const d = m.data
  return (
    <>
      <PageHeader title="Sign-in monitoring" subtitle="Sign-ins, wrong PINs, locks and unusual phones. Attacks found every 15 minutes appear as alerts on the Risk page." />
      <div className="row-gap" style={{ marginBottom: 12 }}>
        {[1, 7, 30].map((n) => (
          <label key={n} className="check"><input type="radio" name="days" checked={days === n} onChange={() => setDays(n)} /> {n === 1 ? 'Today' : `Last ${n} days`}</label>
        ))}
      </div>
      {m.error ? <ErrorState error={m.error} onRetry={m.reload} /> : !d ? <Loading /> : (
        <div className="stack">
          <div className="stat-grid">
            {KINDS.map((k) => (
              <Card key={k}>
                <div className="muted small">{AUTH_EVENT_LABEL[k]}</div>
                <div className={`stat-value${WARN.has(k) && (d.totals[k] ?? 0) > 0 ? ' text-warn' : ''}`}>{d.totals[k] ?? 0}</div>
              </Card>
            ))}
          </div>

          <Card title="By day">
            <div className="table-wrap">
              <table className="table" aria-label="Sign-in events by day">
                <thead><tr><th>Day</th>{KINDS.map((k) => <th key={k} className="num">{AUTH_EVENT_LABEL[k]}</th>)}</tr></thead>
                <tbody>
                  {d.byDay.length === 0 ? <tr><td colSpan={KINDS.length + 1} className="muted">Nothing recorded.</td></tr> : d.byDay.map((r) => (
                    <tr key={r.day}><td>{r.day}</td>{KINDS.map((k) => <td key={k} className="num">{r.counts[k] ?? 0}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid-2">
            <Card title="Addresses with the most refused sign-ins">
              <table className="table" aria-label="Addresses with the most refused sign-ins">
                <thead><tr><th>Address</th><th className="num">Refused</th><th className="num">Wallets tried</th><th>Last</th></tr></thead>
                <tbody>
                  {d.topAddresses.length === 0 ? <tr><td colSpan={4} className="muted">None.</td></tr> : d.topAddresses.map((a) => (
                    <tr key={a.ip} className={a.wallets >= 5 ? 'row-flagged' : undefined}><td>{a.ip}</td><td className="num">{a.failures}</td><td className="num">{a.wallets}</td><td>{formatMaseru(a.lastAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Wallets with the most wrong PINs">
              <table className="table" aria-label="Wallets with the most wrong PINs">
                <thead><tr><th>Wallet</th><th className="num">Wrong</th><th className="num">Locks</th><th>Last</th></tr></thead>
                <tbody>
                  {d.topWallets.length === 0 ? <tr><td colSpan={4} className="muted">None.</td></tr> : d.topWallets.map((w) => (
                    <tr key={w.user.id}><td>{w.user.name}<div className="muted small">{formatMsisdn(w.user.msisdn)}</div></td><td className="num">{w.failures}</td><td className="num">{w.locks}</td><td>{formatMaseru(w.lastAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card title="Latest events">
            <div className="table-wrap">
              <table className="table" aria-label="Latest sign-in events">
                <thead><tr><th>When</th><th>Event</th><th>Who</th><th>App</th><th>Address</th><th>Detail</th></tr></thead>
                <tbody>
                  {d.recent.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{formatMaseru(e.createdAt)}</td>
                      <td>{WARN.has(e.kind) ? <span className="chip chip-warn">{AUTH_EVENT_LABEL[e.kind]}</span> : AUTH_EVENT_LABEL[e.kind]}</td>
                      <td>{e.user ? <>{e.user.name}<div className="muted small">{formatMsisdn(e.user.msisdn)}</div></> : e.admin ? <>{e.admin}<div className="muted small">staff</div></> : '—'}</td>
                      <td>{e.app ?? ''}</td>
                      <td>{e.ip ?? ''}</td>
                      <td className="muted small">{e.detail ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
