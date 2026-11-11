import { Fragment, useState, type FormEvent } from 'react'
import type { AdminSociety, SocietyDetail, SocietyKind } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Card, Empty, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatMoney, formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'
import { SocietyApplications } from './SocietyApplications'

/** Checks the form; returns the body to save, or the first problem in plain words. */
const KINDS: Record<SocietyKind, string> = { society: 'Society', motselo: 'Motšelo (monthly contribution)', burial: 'Burial society' }

export function validateSociety(name: string, code: string, signatoriesRaw: string, approvalsRaw: string, kind: SocietyKind = 'society', contributionRaw = '') {
  const signatories = signatoriesRaw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  const approvalsRequired = Number(approvalsRaw)
  if (name.trim().length < 2) return { body: null, error: 'Enter the society’s name.' }
  if (code.trim() && !/^\d{4}$/.test(code.trim())) return { body: null, error: 'The society code is 4 digits, or leave it empty to generate one.' }
  if (!Number.isInteger(approvalsRequired) || approvalsRequired < 1 || approvalsRequired > 10) return { body: null, error: 'Approvals needed: a whole number from 1 to 10.' }
  if (signatories.length < approvalsRequired) return { body: null, error: `Add at least ${approvalsRequired} executive numbers, one for each approval.` }
  const contribution = contributionRaw.trim() ? Number(contributionRaw) : undefined
  if (contribution !== undefined && !(contribution > 0)) return { body: null, error: 'The monthly contribution is an amount above M0.' }
  if (kind === 'motselo' && contribution === undefined) return { body: null, error: 'Enter what each member pays a month.' }
  return { body: { name: name.trim(), code: code.trim() || undefined, kind, contribution, signatories, approvalsRequired }, error: null }
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [signatories, setSignatories] = useState('')
  const [approvals, setApprovals] = useState('2')
  const [kind, setKind] = useState<SocietyKind>('society')
  const [contribution, setContribution] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateSociety(name, code, signatories, approvals, kind, contribution)
    setError(r.error)
    if (!r.body) return
    setBusy(true)
    try {
      const created = await api.societies.create(r.body)
      toast.success(`${created.name} created with code ${created.code}. Its executives see it in Society (Mekhatlo) now.`)
      setName('')
      setCode('')
      setSignatories('')
      setContribution('')
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
      toast.error(`Couldn't create: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Register a society" icon="users">
      <p className="muted small">
        The executives (signatories) manage members and approve payments from the society in the app. A payment moves once the number of
        approvals below is reached; the executive who asks counts as one.
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">New society</legend>
          <div className="grid-2">
            <Field label="Kind" hint="Motšelo and burial societies are societies in Society (Mekhatlo), not separate apps.">
              {(p) => (
                <select {...p} value={kind} onChange={(e) => setKind(e.target.value as SocietyKind)}>
                  {(Object.keys(KINDS) as SocietyKind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
                </select>
              )}
            </Field>
            <Field label="Monthly contribution (M)" hint={kind === 'motselo' ? 'What each member pays a month.' : 'Optional: a fixed amount each member pays a month.'}>
              {(p) => <input {...p} inputMode="decimal" value={contribution} onChange={(e) => setContribution(e.target.value)} />}
            </Field>
            <Field label="Society name">{(p) => <input {...p} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Society code" hint="4 digits. Leave empty to generate one.">
              {(p) => <input {...p} inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} />}
            </Field>
            <Field label="Executives' EcoCash numbers" hint="Separated by commas, e.g. 62000021, 62103401.">
              {(p) => <input {...p} value={signatories} onChange={(e) => setSignatories(e.target.value)} />}
            </Field>
            <Field label="Approvals needed for a payment">
              {(p) => <input {...p} inputMode="numeric" value={approvals} onChange={(e) => setApprovals(e.target.value)} />}
            </Field>
          </div>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <WriteButton type="submit" variant="primary" busy={busy}>Register society</WriteButton>
        </div>
      </form>
    </Card>
  )
}

function Detail({ id }: { id: string }) {
  const d = useAsync<SocietyDetail>(() => api.societies.get(id), [id])
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />
  if (!d.data) return <Loading />
  return (
    <div className="grid-2">
      <div>
        <h3 className="small">Members</h3>
        <ul className="plain-list">
          {d.data.members.map((m) => (
            <li key={m.user.id}>{m.user.name} · {formatMsisdn(m.user.msisdn)} · {m.role === 'signatory' ? 'Executive' : 'Member'}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="small">Payments</h3>
        {d.data.transfers.length === 0 ? <p className="muted small">None yet.</p> : (
          <ul className="plain-list">
            {d.data.transfers.map((t) => (
              <li key={t.id}>{t.reference} · {formatMoney(t.amount)} to {t.to.name} · {t.status} ({t.approvals.length}/{t.approvalsRequired})</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function SocietiesPage() {
  const list = useAsync<AdminSociety[]>(() => api.societies.list(), [])
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <PageHeader title="Society (Mekhatlo)" subtitle="Societies, Motšelo and burial societies: register them, choose their executives, and see their money." />
      <ReadOnlyNotice />
      <SocietyApplications onOpened={list.reload} />
      <div className="settings-section">
        <CreateForm onCreated={list.reload} />
      </div>
      <div className="settings-section">
        <Card title="Societies" icon="users">
          {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
            <Empty title="No societies yet">Registered societies appear here.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Societies</caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Balance</th>
                    <th scope="col">Members</th>
                    <th scope="col">Executives</th>
                    <th scope="col">Approvals</th>
                    <th scope="col">Registered (Maseru)</th>
                    <th scope="col"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((s) => (
                    <Fragment key={s.id}>
                      <tr>
                        <td className="mono">{s.code}</td>
                        <td>{s.name}</td>
                        <td>{KINDS[s.kind].split(' (')[0]}{s.contribution ? ` · ${formatMoney(s.contribution)}/month` : ''}</td>
                        <td>{formatMoney(s.balance)}</td>
                        <td>{s.memberCount}</td>
                        <td>{s.signatories}</td>
                        <td>{s.approvalsRequired}</td>
                        <td className="nowrap">{formatMaseru(s.createdAt)}</td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                            {open === s.id ? 'Hide' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {open === s.id && (
                        <tr>
                          <td colSpan={9}><Detail id={s.id} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
