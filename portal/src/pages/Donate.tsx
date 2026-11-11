import { useState, type FormEvent } from 'react'
import type { AdminCause, CauseStatus, DonateSettings } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { Button, Card, Empty, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatMoney, formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

const STATUS: Record<CauseStatus, { label: string; chip: string }> = {
  open: { label: 'Open', chip: 'chip-ok' },
  suspended: { label: 'On hold', chip: 'chip-suspended' },
  closed: { label: 'Closed', chip: 'chip-cancelled' },
}

/** Checks the settings form; returns the body to save, or the first problem in plain words. */
export function validateDonate(form: { enabled: boolean; minKycTier: string; maxTarget: string; maxOpenPerUser: string }): { body: DonateSettings | null; error: string | null } {
  const maxTarget = Number(form.maxTarget)
  const maxOpen = Number(form.maxOpenPerUser)
  if (!(maxTarget > 0)) return { body: null, error: 'Largest target: an amount above M0.' }
  if (!Number.isInteger(maxOpen) || maxOpen < 1 || maxOpen > 50) return { body: null, error: 'Open causes per person: a whole number from 1 to 50.' }
  return { body: { enabled: form.enabled, minKycTier: form.minKycTier === '1' ? 1 : 2, maxTarget, maxOpenPerUser: maxOpen }, error: null }
}

function HoldDialog({ cause, onClose, onDone }: { cause: AdminCause; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return setError('Give the reason the organiser will see.')
    setBusy(true)
    try {
      await api.donate.suspend(cause.id, reason.trim())
      toast.success(`${cause.title} is on hold. Nobody can give or withdraw until you open it again.`)
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Put ${cause.code} on hold`} description={`${cause.organiser.name} sees this reason in the app.`} onClose={busy ? () => {} : onClose} size="sm">
      <form onSubmit={submit} noValidate>
        <Field label="Reason" error={error}>
          {(p) => <textarea {...p} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}
        </Field>
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" busy={busy}>Put on hold</Button>
        </div>
      </form>
    </Dialog>
  )
}

function SettingsForm({ settings, onSaved }: { settings: DonateSettings; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ enabled: settings.enabled, minKycTier: String(settings.minKycTier), maxTarget: String(settings.maxTarget), maxOpenPerUser: String(settings.maxOpenPerUser) })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateDonate(form)
    setError(r.error)
    if (!r.body) return
    setBusy(true)
    try {
      await api.donate.saveSettings(r.body)
      toast.success('Saved. The app uses it from now on.')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
        <legend className="sr-only">Donate limits</legend>
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> People can start new causes in the app.
        </label>
        <div className="grid-2">
          <Field label="KYC tier to start a cause" hint="Anyone may give.">
            {(p) => (
              <select {...p} value={form.minKycTier} onChange={(e) => setForm({ ...form, minKycTier: e.target.value })}>
                <option value="1">Tier 1</option>
                <option value="2">Tier 2 (ID verified)</option>
              </select>
            )}
          </Field>
          <Field label="Largest target (M)">
            {(p) => <input {...p} inputMode="decimal" value={form.maxTarget} onChange={(e) => setForm({ ...form, maxTarget: e.target.value })} />}
          </Field>
          <Field label="Open causes per person">
            {(p) => <input {...p} inputMode="numeric" value={form.maxOpenPerUser} onChange={(e) => setForm({ ...form, maxOpenPerUser: e.target.value })} />}
          </Field>
        </div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <WriteButton type="submit" variant="primary" busy={busy}>Save</WriteButton>
      </div>
    </form>
  )
}

/** Donate: every cause, what it raised and holds, and putting a cause on hold. Limits are set below. */
export function DonatePage() {
  const toast = useToast()
  const list = useAsync<AdminCause[]>(() => api.donate.list(), [])
  const settings = useAsync<DonateSettings>(() => api.donate.settings(), [])
  const [holding, setHolding] = useState<AdminCause | null>(null)

  const reopen = async (c: AdminCause) => {
    try {
      await api.donate.reopen(c.id)
      toast.success(`${c.title} is open again.`)
      list.reload()
    } catch (err) {
      toast.error(`Couldn't open it: ${errorMessage(err)}`)
    }
  }

  return (
    <>
      <PageHeader title="Donate" subtitle="Causes people raise money for: funerals, school fees, churches, neighbours in need." />
      <ReadOnlyNotice />
      <Card title="Causes" icon="users">
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
          <Empty title="No causes yet">Causes started in the app appear here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Causes</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Cause</th>
                  <th scope="col">Organiser</th>
                  <th scope="col">Raised</th>
                  <th scope="col">Holds</th>
                  <th scope="col">Started (Maseru)</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.code}</td>
                    <td>{c.title}</td>
                    <td className="small">{c.organiser.name}<div className="muted">{formatMsisdn(c.organiser.msisdn)}</div></td>
                    <td>{formatMoney(c.raised)} <span className="muted small">of {formatMoney(c.target)} · {c.donorCount} gave</span></td>
                    <td>{formatMoney(c.balance)}</td>
                    <td className="nowrap">{formatMaseru(c.createdAt)}</td>
                    <td>
                      <span className={`chip ${STATUS[c.status].chip}`}>{STATUS[c.status].label}</span>
                      {c.statusReason && <div className="muted small">{c.statusReason}</div>}
                    </td>
                    <td className="nowrap">
                      {c.status === 'open' && <WriteButton size="sm" onClick={() => setHolding(c)}>Put on hold</WriteButton>}
                      {c.status === 'suspended' && <WriteButton size="sm" variant="primary" onClick={() => reopen(c)}>Open again</WriteButton>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="settings-section">
        <Card title="Limits" icon="users">
          {settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} /> : !settings.data ? <Loading /> : <SettingsForm settings={settings.data} onSaved={settings.reload} />}
        </Card>
      </div>
      {holding && <HoldDialog cause={holding} onClose={() => setHolding(null)} onDone={list.reload} />}
    </>
  )
}
