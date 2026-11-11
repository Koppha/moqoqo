import { useState, type FormEvent } from 'react'
import type {
  AdminServiceRequest,
  LocalizedText,
  ServiceBody,
  ServiceDef,
  ServiceExecutor,
  ServiceField,
  ServiceFieldType,
  ServicePlacement,
  ServiceRequestStatus,
} from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Card, ListState, PageHeader, Pagination, ReadOnlyNotice, Segmented, WriteButton } from '../components/ui'
import { formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'
import { assetUrl, uploadPicture } from '../upload'
import { openDocument } from './EcoSure'
import { BillCategoryList } from './BillCategories'

export const PLACEMENT_LABEL: Record<ServicePlacement, string> = { send: 'Send money', services: 'Services tab', me: 'Me › Self service', bills: 'Pay bill only' }
export const EXECUTOR_LABEL: Record<ServiceExecutor, string> = {
  ecocash_transfer: 'Send out through EcoCash (other network or wallet)',
  airtime: 'Econet airtime',
  bundle: 'Econet bundle',
  request: 'Request to the back office (no money)',
  bill: 'Pay a biller through EcoCash (account or policy number)',
}
const FIELD_TYPES: { value: ServiceFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'phone', label: 'Phone number' },
  { value: 'amount', label: 'Amount (M)' },
  { value: 'select', label: 'List of choices' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Tick box' },
  { value: 'image', label: 'Photo (requests only)' },
]

const text = (en = '', st = ''): LocalizedText => ({ en, st })
const blankField = (n: number): ServiceField => ({ key: `field_${n}`, type: 'text', label: text(), required: true })
const blank = (): ServiceBody => ({
  code: '', name: text(), description: text(), icon: 'apps', color: '#5B2C9F', placement: 'send', sort: 100, enabled: false,
  executor: 'ecocash_transfer', fields: [blankField(1), { key: 'amount', type: 'amount', label: text('Amount', 'Chelete'), required: true }],
  fee: { fixed: 0, percent: 0 }, limits: { min: 1, max: 5000 }, confirmName: false,
})
const toBody = ({ id: _, ...rest }: ServiceDef): ServiceBody => structuredClone(rest)

/** Number input that keeps "" as undefined. */
function num(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function ServicesPage() {
  const [tab, setTab] = useState<'services' | 'bills' | 'requests'>('services')
  return (
    <>
      <PageHeader
        title="Services"
        subtitle="Build the services customers see: Send money to other networks, airtime, bundles and self-service requests. Changes reach the apps straight away."
      />
      <Segmented label="Show" name="svc-tab" hideLabel value={tab} onChange={setTab} options={[{ value: 'services', label: 'Services' }, { value: 'bills', label: 'Pay bill categories' }, { value: 'requests', label: 'Requests to review' }]} />
      <div style={{ height: 16 }} />
      {tab === 'services' ? <ServiceList /> : tab === 'bills' ? <BillCategoryList /> : <RequestList />}
    </>
  )
}

function ServiceList() {
  const list = useAsync(() => api.services.list(), [])
  const [editing, setEditing] = useState<{ id: string | null; body: ServiceBody } | null>(null)
  return (
    <Card actions={<WriteButton variant="primary" onClick={() => setEditing({ id: null, body: blank() })}>New service</WriteButton>}>
      <ListState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} isEmpty={(d) => d.length === 0} emptyTitle="No services yet">
        {(d) => (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Services</caption>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Where</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Fields</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {d.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div>{s.image ? <img className="svc-thumb" src={assetUrl(s.image)} alt="" /> : <span className="swatch" style={{ background: s.color }} />} <strong>{s.name.en}</strong> <span className="muted small mono">{s.code}</span></div>
                      <div className="muted small">{s.description.en}</div>
                    </td>
                    <td>{PLACEMENT_LABEL[s.placement]}{s.category && <div className="muted small">Pay bill › {s.category}</div>}</td>
                    <td className="small">{EXECUTOR_LABEL[s.executor]}</td>
                    <td className="small">{s.fields.map((f) => f.label.en).join(', ')}</td>
                    <td><span className={`chip ${s.enabled ? 'chip-ok' : 'chip-neutral'}`}>{s.enabled ? 'On' : 'Off'}</span></td>
                    <td><Button size="sm" onClick={() => setEditing({ id: s.id, body: toBody(s) })}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListState>
      {editing && <ServiceEditor id={editing.id} initial={editing.body} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload() }} />}
    </Card>
  )
}

function LangPair({ label, value, onChange, max, required }: { label: string; value: LocalizedText; onChange: (v: LocalizedText) => void; max: number; required?: boolean }) {
  return (
    <div className="grid-2">
      <label className="field">
        <span className="field-label">{label} (English)</span>
        <input value={value.en} maxLength={max} required={required} onChange={(e) => onChange({ ...value, en: e.target.value })} />
      </label>
      <label className="field">
        <span className="field-label">{label} (Sesotho)</span>
        <input lang="st" value={value.st} maxLength={max} required={required} onChange={(e) => onChange({ ...value, st: e.target.value })} />
      </label>
    </div>
  )
}

export function ServiceEditor({ id, initial, onClose, onSaved }: { id: string | null; initial: ServiceBody; onClose: () => void; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<ServiceBody>(initial)
  const categories = useAsync(() => api.billCategories.list(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const set = <K extends keyof ServiceBody>(k: K, value: ServiceBody[K]) => setV((x) => ({ ...x, [k]: value }))
  const setField = (i: number, f: ServiceField) => set('fields', v.fields.map((x, j) => (j === i ? f : x)))
  const move = (i: number, d: -1 | 1) => {
    const next = v.fields.slice()
    const [f] = next.splice(i, 1)
    next.splice(i + d, 0, f)
    set('fields', next)
  }
  const money = v.executor !== 'request'

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    setBusy(true)
    setError(null)
    try {
      if (id) await api.services.update(id, v)
      else await api.services.create(v)
      toast.success(`${v.name.en || 'Service'} saved. The apps show it on their next refresh.`)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!id || !window.confirm(`Delete ${v.name.en}? Customers will no longer see it. Past payments are kept.`)) return
    try {
      await api.services.remove(id)
      toast.success('Service deleted.')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog
      title={id ? `Edit ${initial.name.en}` : 'New service'}
      description="What the customer fills in, how it is checked, and what EcoCash Super App does with it."
      onClose={onClose}
      size="lg"
      variant="panel"
      footer={
        <>
          {id && <WriteButton variant="danger" onClick={remove}>Delete</WriteButton>}
          <Button onClick={onClose}>Cancel</Button>
          <WriteButton type="submit" variant="primary" busy={busy} form="service-form">Save</WriteButton>
        </>
      }
    >
      {!canWrite && <ReadOnlyNotice />}
      <form id="service-form" onSubmit={save} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">Service</legend>
          <h3 className="form-section">Basics</h3>
          <LangPair label="Name" value={v.name} onChange={(x) => set('name', x)} max={40} required />
          <LangPair label="Short description" value={v.description} onChange={(x) => set('description', x)} max={120} />
          <div className="grid-2">
            <label className="field">
              <span className="field-label">EcoCash product code</span>
              <input className="mono" value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="MPESA" maxLength={20} />
            </label>
            <label className="field">
              <span className="field-label">What it does</span>
              <select value={v.executor} onChange={(e) => set('executor', e.target.value as ServiceExecutor)}>
                {(Object.keys(EXECUTOR_LABEL) as ServiceExecutor[]).map((k) => <option key={k} value={k}>{EXECUTOR_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Where it appears</span>
              <select value={v.placement} onChange={(e) => set('placement', e.target.value as ServicePlacement)}>
                {(Object.keys(PLACEMENT_LABEL) as ServicePlacement[]).map((k) => <option key={k} value={k}>{PLACEMENT_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Pay bill category{v.placement === 'bills' ? '' : ' (optional)'}</span>
              <select value={v.category ?? ''} onChange={(e) => set('category', e.target.value || undefined)}>
                <option value="">{v.placement === 'bills' ? 'Choose a category' : 'Not in Pay bill'}</option>
                {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name.en}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Order (lower first)</span>
              <input type="number" value={v.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} />
            </label>
            <label className="field">
              <span className="field-label">Icon (Ionicons name)</span>
              <input value={v.icon} onChange={(e) => set('icon', e.target.value.trim())} placeholder="phone-portrait" />
            </label>
            <label className="field">
              <span className="field-label">Colour</span>
              <input type="color" value={v.color} onChange={(e) => set('color', e.target.value.toUpperCase())} />
            </label>
          </div>
          <div className="service-picture">
            {v.image ? <img src={assetUrl(v.image)} alt="Service picture" /> : <span className="swatch-lg" style={{ background: v.color }} />}
            <div>
              <span className="field-label">Picture (e.g. the partner's logo)</span>
              <p className="muted small">Shown instead of the icon. Square PNG or JPEG, at least 64 px.</p>
              <div className="row-gap">
                <label htmlFor="svc-picture" className={`btn btn-sm btn-secondary ${!canWrite || uploading ? 'is-readonly' : ''}`}>{uploading ? 'Uploading…' : 'Upload picture'}</label>
                <input id="svc-picture" type="file" accept="image/png,image/jpeg" className="sr-only" disabled={!canWrite || uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    setUploading(true)
                    try {
                      set('image', (await uploadPicture(file, 'service_icon')).path)
                    } catch (err) {
                      setError(err instanceof Error && !('status' in err) ? err.message : errorMessage(err))
                    } finally {
                      setUploading(false)
                    }
                  }} />
                {v.image && <Button size="sm" variant="ghost" onClick={() => set('image', undefined)}>Use the icon instead</Button>}
              </div>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} /> On (customers can see and use it)
          </label>
          {v.executor === 'ecocash_transfer' && (
            <label className="check">
              <input type="checkbox" checked={v.confirmName} onChange={(e) => set('confirmName', e.target.checked)} /> Show the account holder's name (from the other network) before the PIN
            </label>
          )}

          <h3 className="form-section">Fields the customer fills in</h3>
          {v.fields.map((f, i) => (
            <FieldEditor key={i} field={f} index={i} count={v.fields.length} onChange={(x) => setField(i, x)} onMove={(d) => move(i, d)}
              onRemove={() => set('fields', v.fields.filter((_, j) => j !== i))} />
          ))}
          <Button onClick={() => set('fields', [...v.fields, blankField(v.fields.length + 1)])}>Add field</Button>

          {money && (
            <>
              <h3 className="form-section">Fee and limits</h3>
              <p className="muted small">Fee = fixed + percent of the amount, kept between the minimum and maximum (leave empty for none).</p>
              <div className="grid-2">
                <label className="field"><span className="field-label">Fixed fee (M)</span>
                  <input type="number" min={0} step="0.01" value={v.fee.fixed} onChange={(e) => set('fee', { ...v.fee, fixed: num(e.target.value) ?? 0 })} /></label>
                <label className="field"><span className="field-label">Percent (%)</span>
                  <input type="number" min={0} step="0.1" value={v.fee.percent} onChange={(e) => set('fee', { ...v.fee, percent: num(e.target.value) ?? 0 })} /></label>
                <label className="field"><span className="field-label">Fee minimum (M)</span>
                  <input type="number" min={0} step="0.01" value={v.fee.min ?? ''} onChange={(e) => set('fee', { ...v.fee, min: num(e.target.value) })} /></label>
                <label className="field"><span className="field-label">Fee maximum (M)</span>
                  <input type="number" min={0} step="0.01" value={v.fee.max ?? ''} onChange={(e) => set('fee', { ...v.fee, max: num(e.target.value) })} /></label>
                <label className="field"><span className="field-label">Smallest amount (M)</span>
                  <input type="number" min={0} step="0.01" value={v.limits.min} onChange={(e) => set('limits', { ...v.limits, min: num(e.target.value) ?? 0 })} /></label>
                <label className="field"><span className="field-label">Largest amount (M)</span>
                  <input type="number" min={0} step="0.01" value={v.limits.max} onChange={(e) => set('limits', { ...v.limits, max: num(e.target.value) ?? 0 })} /></label>
              </div>
            </>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </fieldset>
      </form>
    </Dialog>
  )
}

function FieldEditor({ field: f, index, count, onChange, onMove, onRemove }: {
  field: ServiceField; index: number; count: number; onChange: (f: ServiceField) => void; onMove: (d: -1 | 1) => void; onRemove: () => void
}) {
  const set = <K extends keyof ServiceField>(k: K, value: ServiceField[K]) => onChange({ ...f, [k]: value })
  const options = f.options ?? []
  const setOption = (i: number, o: NonNullable<ServiceField['options']>[number]) => set('options', options.map((x, j) => (j === i ? o : x)))
  return (
    <div className="field-card">
      <div className="field-card-head">
        <strong>{index + 1}. {f.label.en || 'New field'}</strong>
        <span className="field-card-actions">
          <Button size="sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${f.label.en} up`}>↑</Button>
          <Button size="sm" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${f.label.en} down`}>↓</Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
        </span>
      </div>
      <LangPair label="Label" value={f.label} onChange={(x) => set('label', x)} max={80} required />
      <div className="grid-2">
        <label className="field"><span className="field-label">Type</span>
          <select value={f.type} onChange={(e) => set('type', e.target.value as ServiceFieldType)}>
            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Key (sent to EcoCash)</span>
          <input className="mono" value={f.key} onChange={(e) => set('key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} maxLength={40} />
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={f.required} onChange={(e) => set('required', e.target.checked)} /> Required</label>
      <label className="check"><input type="checkbox" checked={f.showOnReceipt !== false} onChange={(e) => set('showOnReceipt', e.target.checked ? undefined : false)} /> Show on the review screen and receipt</label>

      {(f.type === 'text' || f.type === 'number') && (
        <div className="grid-2">
          {f.type === 'text' && (
            <>
              <label className="field"><span className="field-label">Fewest characters</span>
                <input type="number" min={0} value={f.minLength ?? ''} onChange={(e) => set('minLength', num(e.target.value))} /></label>
              <label className="field"><span className="field-label">Most characters</span>
                <input type="number" min={1} value={f.maxLength ?? ''} onChange={(e) => set('maxLength', num(e.target.value))} /></label>
            </>
          )}
          <label className="field"><span className="field-label">Must match (regular expression)</span>
            <input className="mono" value={f.pattern ?? ''} placeholder="\d{6,12}" onChange={(e) => set('pattern', e.target.value || undefined)} /></label>
          <label className="field"><span className="field-label">Message when it doesn't match (English)</span>
            <input value={f.patternMessage?.en ?? ''} placeholder="6 to 12 digits" onChange={(e) => set('patternMessage', { en: e.target.value, st: f.patternMessage?.st ?? '' })} /></label>
        </div>
      )}
      {(f.type === 'amount' || f.type === 'number') && (
        <div className="grid-2">
          <label className="field"><span className="field-label">Minimum</span><input type="number" value={f.min ?? ''} onChange={(e) => set('min', num(e.target.value))} /></label>
          <label className="field"><span className="field-label">Maximum</span><input type="number" value={f.max ?? ''} onChange={(e) => set('max', num(e.target.value))} /></label>
        </div>
      )}
      {f.type === 'phone' && (
        <div className="checks">
          <span className="field-label">Networks accepted</span>
          {(['econet', 'vodacom'] as const).map((n) => (
            <label key={n} className="check">
              <input type="checkbox" checked={!f.networks?.length || f.networks.includes(n)}
                onChange={(e) => {
                  const now = new Set(f.networks?.length ? f.networks : ['econet', 'vodacom'])
                  if (e.target.checked) now.add(n)
                  else now.delete(n)
                  set('networks', now.size === 2 ? undefined : [...now] as ServiceField['networks'])
                }} /> {n === 'econet' ? 'Econet (6x)' : 'Vodacom (5x)'}
            </label>
          ))}
          <label className="check"><input type="checkbox" checked={!!f.ownNumber} onChange={(e) => set('ownNumber', e.target.checked || undefined)} /> Offer “My number”</label>
        </div>
      )}
      {f.type === 'select' && (
        <div>
          <span className="field-label">Choices (a price makes the choice set the amount, e.g. bundles)</span>
          {options.map((o, i) => (
            <div key={i} className="option-row">
              <input aria-label={`Choice ${i + 1} code`} className="mono" value={o.value} placeholder="W1GB" onChange={(e) => setOption(i, { ...o, value: e.target.value })} />
              <input aria-label={`Choice ${i + 1} English`} value={o.label.en} placeholder="Weekly 1 GB" onChange={(e) => setOption(i, { ...o, label: { ...o.label, en: e.target.value } })} />
              <input aria-label={`Choice ${i + 1} Sesotho`} lang="st" value={o.label.st} placeholder="Beke 1 GB" onChange={(e) => setOption(i, { ...o, label: { ...o.label, st: e.target.value } })} />
              <input aria-label={`Choice ${i + 1} price`} type="number" min={0} step="0.01" value={o.amount ?? ''} placeholder="Price M" onChange={(e) => setOption(i, { ...o, amount: num(e.target.value) })} />
              <Button size="sm" variant="ghost" onClick={() => set('options', options.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button size="sm" onClick={() => set('options', [...options, { value: '', label: text() }])}>Add choice</Button>
        </div>
      )}
    </div>
  )
}

// ---------- requests (e.g. Update KYC) ----------

const STATUS_CHIP: Record<ServiceRequestStatus, string> = { pending: 'chip-warn', approved: 'chip-ok', rejected: 'chip-suspended' }

function RequestList() {
  const [status, setStatus] = useState<ServiceRequestStatus | ''>('pending')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<AdminServiceRequest | null>(null)
  const list = useAsync(() => api.services.requests({ status, page }), [status, page])
  return (
    <Card>
      <div className="filters">
        <div className="field">
          <label htmlFor="sr-status">Status</label>
          <select id="sr-status" value={status} onChange={(e) => { setStatus(e.target.value as ServiceRequestStatus | ''); setPage(1) }}>
            <option value="pending">Waiting for review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <ListState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} isEmpty={(d) => d.items.length === 0} emptyTitle="Nothing here">
        {(d) => (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Service requests</caption>
                <thead><tr><th scope="col">Reference</th><th scope="col">Customer</th><th scope="col">Service</th><th scope="col">Sent (Maseru)</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {d.items.map((r) => (
                    <tr key={r.id}>
                      <td className="mono nowrap">{r.reference}</td>
                      <td><div>{r.user.name}</div><div className="muted small">{formatMsisdn(r.user.msisdn)}</div></td>
                      <td>{r.serviceName.en}</td>
                      <td className="nowrap">{formatMaseru(r.createdAt)}</td>
                      <td><span className={`chip ${STATUS_CHIP[r.status]}`}>{r.status}</span></td>
                      <td><Button size="sm" onClick={() => setOpen(r)}>Open</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} loading={list.loading} />
          </>
        )}
      </ListState>
      {open && <RequestPanel request={open} onClose={() => setOpen(null)} onDecided={() => { setOpen(null); list.reload() }} />}
    </Card>
  )
}

function RequestPanel({ request: r, onClose, onDecided }: { request: AdminServiceRequest; onClose: () => void; onDecided: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const decide = async (status: 'approved' | 'rejected') => {
    setBusy(true)
    try {
      await api.services.decide(r.id, { status, note: note.trim() || undefined })
      toast.success(`${r.reference} ${status}. The customer has been told.`)
      onDecided()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={`${r.serviceName.en} · ${r.reference}`} description={`${r.user.name} · ${formatMsisdn(r.user.msisdn)}`} onClose={onClose} variant="panel">
      <dl className="detail-list">
        {r.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{l.value}</dd></div>)}
      </dl>
      {r.files.length > 0 && (
        <p>
          {r.files.map((f) => (
            <Button key={f.key} size="sm" onClick={() => openDocument(() => api.services.file(r.id, f.key)).catch((e) => toast.error(errorMessage(e)))}>View {f.label}</Button>
          ))}
        </p>
      )}
      {r.status === 'pending' ? (
        <>
          <label className="field">
            <span className="field-label">Note to the customer (needed to reject)</span>
            <textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row-gap">
            <WriteButton variant="primary" busy={busy} onClick={() => decide('approved')}>Approve</WriteButton>
            <WriteButton variant="danger" busy={busy} onClick={() => decide('rejected')} disabled={!note.trim()}>Reject</WriteButton>
          </div>
        </>
      ) : (
        <p className="muted">{r.status === 'approved' ? 'Approved' : 'Rejected'}{r.note ? `: ${r.note}` : ''}</p>
      )}
    </Dialog>
  )
}
