import { useState, type FormEvent } from 'react'
import type { SocietyApplication, SocietyApplicationStatus, SocietyApplySettings } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { Button, Card, Empty, ErrorState, Field, Loading, WriteButton } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatMoney, formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

const STATUS: Record<SocietyApplicationStatus, { label: string; chip: string }> = {
  pending: { label: 'To check', chip: 'chip-warn' },
  approved: { label: 'Collect SIM', chip: 'chip-scheduled' },
  active: { label: 'Open', chip: 'chip-ok' },
  rejected: { label: 'Rejected', chip: 'chip-suspended' },
  cancelled: { label: 'Cancelled', chip: 'chip-cancelled' },
}
const KIND = { society: 'Society', motselo: 'Motšelo', burial: 'Burial society' } as const

/** Checks the SIM form; returns the body to save, or the first problem in plain words. */
export function validateSim(simRaw: string, codeRaw: string) {
  const digits = simRaw.replace(/[\s-]/g, '').replace(/^\+?266/, '')
  if (!/^[56]\d{7}$/.test(digits)) return { body: null, error: 'Enter the SIM’s 8-digit Lesotho number, e.g. 63999001.' }
  const code = codeRaw.trim()
  if (code && !/^\d{4}$/.test(code)) return { body: null, error: 'The society code is 4 digits, or leave it empty to generate one.' }
  return { body: { simNumber: `+266${digits}`, code: code || undefined }, error: null }
}

function RejectDialog({ app, onClose, onDone }: { app: SocietyApplication; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return setError('Give the reason the applicant will see.')
    setBusy(true)
    try {
      await api.societyApplications.reject(app.id, reason.trim())
      toast.success(`${app.reference} rejected. ${app.applicant.name} is told why.`)
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Reject ${app.reference}`} description={`${app.applicant.name} sees this in the app.`} onClose={busy ? () => {} : onClose} size="sm">
      <form onSubmit={submit} noValidate>
        <Field label="Reason" error={error}>
          {(p) => <textarea {...p} rows={4} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}
        </Field>
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" busy={busy}>Reject</Button>
        </div>
      </form>
    </Dialog>
  )
}

function SimDialog({ app, onClose, onDone }: { app: SocietyApplication; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [sim, setSim] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const r = validateSim(sim, code)
    setError(r.error)
    if (!r.body) return
    setBusy(true)
    try {
      const done = await api.societyApplications.activate(app.id, r.body)
      toast.success(`${app.name} is open as society ${done.societyCode}. Its executives are told in the app.`)
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Record the Mokhatlo SIM for ${app.reference}`}
      description="Only once the executives have collected the SIM in person and their IDs were checked. The SIM's number becomes the society's wallet."
      onClose={busy ? () => {} : onClose}
      size="sm"
    >
      <form onSubmit={submit} noValidate>
        <Field label="Mokhatlo SIM number">
          {(p) => <input {...p} inputMode="tel" value={sim} onChange={(e) => setSim(e.target.value)} data-autofocus />}
        </Field>
        <Field label="Society code" hint="4 digits. Leave empty to generate one.">
          {(p) => <input {...p} inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>SIM issued, open society</Button>
        </div>
      </form>
    </Dialog>
  )
}

function SettingsForm({ settings, onSaved }: { settings: SocietyApplySettings; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [enabled, setEnabled] = useState(settings.enabled)
  const [maxOpen, setMaxOpen] = useState(String(settings.maxOpen))
  const [instructions, setInstructions] = useState(settings.collectInstructions)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const n = Number(maxOpen)
    if (!Number.isInteger(n) || n < 1 || n > 20) return setError('Open applications per person: a whole number from 1 to 20.')
    if (!instructions.trim()) return setError('Say where to collect the SIM and what to bring.')
    setError(null)
    setBusy(true)
    try {
      await api.societyApplications.saveSettings({ enabled, maxOpen: n, collectInstructions: instructions.trim() })
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
        <legend className="sr-only">Applying in the app</legend>
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> People can apply for a new society in the app.
        </label>
        <div className="grid-2">
          <Field label="Open applications per person" hint="Being checked or waiting for the SIM.">
            {(p) => <input {...p} inputMode="numeric" value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} />}
          </Field>
        </div>
        <Field label="SIM collection instructions" hint="Shown in the app once an application is approved: where to go and what to bring.">
          {(p) => <textarea {...p} rows={3} maxLength={600} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
        </Field>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <WriteButton type="submit" variant="primary" busy={busy}>Save</WriteButton>
      </div>
    </form>
  )
}

/**
 * Applications for new societies, sent from the app. Check and approve or reject them; once the executives collect
 * the Mokhatlo SIM at a shop, record it here and the society opens.
 */
export function SocietyApplications({ onOpened }: { onOpened: () => void }) {
  const toast = useToast()
  const list = useAsync<SocietyApplication[]>(() => api.societyApplications.list(), [])
  const settings = useAsync<SocietyApplySettings>(() => api.societyApplications.settings(), [])
  const [dialog, setDialog] = useState<{ kind: 'reject' | 'sim'; app: SocietyApplication } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const approve = async (a: SocietyApplication) => {
    setBusy(a.id)
    try {
      await api.societyApplications.approve(a.id)
      toast.success(`${a.reference} approved. The executives are told to collect the Mokhatlo SIM.`)
      list.reload()
    } catch (err) {
      toast.error(`Couldn't approve: ${errorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }
  const done = () => {
    list.reload()
    onOpened()
  }

  return (
    <>
      <Card title="Applications from the app" icon="users">
        <p className="muted small">
          People apply in the app and become the first executive. Approve to tell the executives to collect the society's Mokhatlo SIM at a shop;
          when they have it, record the SIM and the society opens with that number as its wallet.
        </p>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
          <Empty title="No applications yet">Applications sent from the app appear here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Society applications</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Society</th>
                  <th scope="col">Executives</th>
                  <th scope="col">Approvals</th>
                  <th scope="col">Sent (Maseru)</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.reference}</td>
                    <td>
                      {a.name}
                      <div className="muted small">{KIND[a.kind]}{a.contribution ? ` · ${formatMoney(a.contribution)}/month` : ''}</div>
                    </td>
                    <td className="small">
                      {a.executives.map((u) => <div key={u.id}>{u.name} · {formatMsisdn(u.msisdn)}</div>)}
                    </td>
                    <td>{a.approvalsRequired}</td>
                    <td className="nowrap">{formatMaseru(a.createdAt)}</td>
                    <td>
                      <span className={`chip ${STATUS[a.status].chip}`}>{STATUS[a.status].label}</span>
                      {a.reason && <div className="muted small">{a.reason}</div>}
                      {a.status === 'active' && <div className="muted small">Society {a.societyCode} · SIM {formatMsisdn(a.simNumber ?? '')}</div>}
                    </td>
                    <td className="nowrap">
                      {a.status === 'pending' && (
                        <>
                          <WriteButton size="sm" variant="primary" busy={busy === a.id} onClick={() => approve(a)}>Approve</WriteButton>{' '}
                          <WriteButton size="sm" onClick={() => setDialog({ kind: 'reject', app: a })}>Reject</WriteButton>
                        </>
                      )}
                      {a.status === 'approved' && <WriteButton size="sm" variant="primary" onClick={() => setDialog({ kind: 'sim', app: a })}>Record SIM</WriteButton>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="settings-section">
        <Card title="Applying in the app" icon="users">
          {settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} /> : !settings.data ? <Loading /> : (
            <SettingsForm settings={settings.data} onSaved={settings.reload} />
          )}
        </Card>
      </div>
      {dialog?.kind === 'reject' && <RejectDialog app={dialog.app} onClose={() => setDialog(null)} onDone={list.reload} />}
      {dialog?.kind === 'sim' && <SimDialog app={dialog.app} onClose={() => setDialog(null)} onDone={done} />}
    </>
  )
}
