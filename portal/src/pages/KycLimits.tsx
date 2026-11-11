import { useState, type FormEvent } from 'react'
import { LIMIT_GROUPS, type KycLimits, type LimitGroup } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../components/Toast'
import { Card, ErrorState, Loading, WriteButton } from '../components/ui'
import { useAsync } from '../useAsync'

export const GROUP_LABEL: Record<LimitGroup, string> = {
  send: 'Send money & requests',
  pay: 'Pay merchants (QR, code, tap)',
  bills: 'Bills (LEC, WASCO, …)',
  services: 'Services (other networks, airtime, bundles)',
  bank: 'Wallet to bank',
  ecosure: 'EcoSure premiums',
}

type Values = { per: Record<LimitGroup, string>; day: Record<LimitGroup, string>; total: string }
const toText = (n: number | null) => (n === null ? '' : String(n))
const toValues = (l: KycLimits): Values => ({
  per: Object.fromEntries(LIMIT_GROUPS.map((g) => [g, toText(l.perTransaction[g])])) as Values['per'],
  day: Object.fromEntries(LIMIT_GROUPS.map((g) => [g, toText(l.daily[g])])) as Values['day'],
  total: toText(l.dailyTotal),
})

/** Empty = no limit. Returns null when a value isn't a number ≥ 0. */
function parse(v: string): number | null | undefined {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Tier-1 limits (KYC not yet approved). Cash-out and ATM always need tier 2. */
export function KycLimitsCard() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const current = useAsync(() => api.kycLimits.get(), [])
  const [v, setV] = useState<Values | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const values = v ?? (current.data ? toValues(current.data) : null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!values || !canWrite) return
    const body: KycLimits = { perTransaction: {} as KycLimits['perTransaction'], daily: {} as KycLimits['daily'], dailyTotal: null }
    for (const g of LIMIT_GROUPS) {
      const p = parse(values.per[g])
      const d = parse(values.day[g])
      if (p === undefined || d === undefined) return setError(`${GROUP_LABEL[g]}: enter a number, or leave empty for no limit.`)
      body.perTransaction[g] = p
      body.daily[g] = d
    }
    const total = parse(values.total)
    if (total === undefined) return setError('Daily total: enter a number, or leave empty.')
    body.dailyTotal = total
    setBusy(true)
    setError(null)
    try {
      const saved = await api.kycLimits.put(body)
      current.setData(() => saved)
      setV(null)
      toast.success('Tier-1 limits saved. They apply to the next payment.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Limits until KYC is approved (tier 1)">
      <p className="muted small">
        Customers whose ID and selfie aren't approved yet (Services › Requests to review) are capped here. Cash-out at agents and ATM withdrawals always need tier 2.
        Empty = no limit; 0 = not allowed.
      </p>
      {current.error ? <ErrorState error={current.error} onRetry={current.reload} /> : !values ? <Loading /> : (
        <form onSubmit={save} noValidate>
          <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
            <legend className="sr-only">Tier-1 limits</legend>
            <table className="table limits-table">
              <thead><tr><th scope="col">Payments</th><th scope="col" className="num">Per payment (M)</th><th scope="col" className="num">Per day (M)</th></tr></thead>
              <tbody>
                {LIMIT_GROUPS.map((g) => (
                  <tr key={g}>
                    <td>{GROUP_LABEL[g]}</td>
                    <td className="num"><input aria-label={`${GROUP_LABEL[g]} per payment`} inputMode="decimal" value={values.per[g]} onChange={(e) => setV({ ...values, per: { ...values.per, [g]: e.target.value } })} /></td>
                    <td className="num"><input aria-label={`${GROUP_LABEL[g]} per day`} inputMode="decimal" value={values.day[g]} onChange={(e) => setV({ ...values, day: { ...values.day, [g]: e.target.value } })} /></td>
                  </tr>
                ))}
                <tr>
                  <td><strong>All money out together, per day</strong></td>
                  <td />
                  <td className="num"><input aria-label="Daily total" inputMode="decimal" value={values.total} onChange={(e) => setV({ ...values, total: e.target.value })} /></td>
                </tr>
              </tbody>
            </table>
            {error && <p className="field-error" role="alert">{error}</p>}
            <WriteButton type="submit" variant="primary" busy={busy}>Save limits</WriteButton>
          </fieldset>
        </form>
      )}
    </Card>
  )
}
