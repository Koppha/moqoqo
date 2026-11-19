import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  AdminEsCatalogue, AdminEsProduct, EsClaimStatus, EsContent, EsOption, EsPolicy, EsPolicyStatus, EsRelationship, LocalizedText,
} from '../../../shared/api'
import { api, errorMessage, type AdminEsClaim, type AdminEsQuote, type EsQuoteStatus } from '../api'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { Button, Card, Field, ListState, PageHeader, Pagination, ReadOnlyNotice, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn, parseAmount } from '../format'
import { formatMaseru } from '../time'
import { useAsync, useDebounced } from '../useAsync'

// ---------- labels ----------

export const CLAIM_STATUS: Record<EsClaimStatus, { label: string; chip: string }> = {
  submitted: { label: 'Submitted', chip: 'chip-scheduled' },
  documents_verified: { label: 'Documents verified', chip: 'chip-scheduled' },
  under_assessment: { label: 'Under assessment', chip: 'chip-warn' },
  approved: { label: 'Approved', chip: 'chip-ok' },
  rejected: { label: 'Rejected', chip: 'chip-suspended' },
}

export const POLICY_STATUS: Record<EsPolicyStatus, { label: string; chip: string }> = {
  active: { label: 'Active', chip: 'chip-ok' },
  grace: { label: 'Grace period', chip: 'chip-warn' },
  lapsed: { label: 'Lapsed', chip: 'chip-suspended' },
  cancelled: { label: 'Cancelled', chip: 'chip-cancelled' },
}

export const QUOTE_STATUS: Record<EsQuoteStatus, { label: string; chip: string }> = {
  submitted: { label: 'Waiting for price', chip: 'chip-warn' },
  priced: { label: 'Priced', chip: 'chip-ok' },
  accepted: { label: 'Accepted', chip: 'chip-ok' },
  expired: { label: 'Expired', chip: 'chip-ended' },
  declined: { label: 'Declined', chip: 'chip-cancelled' },
}

const RELATIONSHIP: Record<EsRelationship, string> = {
  main: 'Main member',
  spouse: 'Spouse',
  child: 'Child',
  parent: 'Parent',
  extended: 'Extended family',
}

const CAUSE = { natural: 'Natural', unnatural: 'Unnatural', undetermined: 'Undetermined' } as const
const OPEN_CLAIM: EsClaimStatus[] = ['submitted', 'documents_verified', 'under_assessment']

function Chip({ map, status }: { map: Record<string, { label: string; chip: string }>; status: string }) {
  const s = map[status] ?? { label: status, chip: 'chip-neutral' }
  return <span className={`chip ${s.chip}`}>{s.label}</span>
}

/** "2026-11-16" → "16 Nov 2026" */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`
}

/**
 * Opens a document fetched with the admin token. The tab is opened before the download starts so popup blockers
 * allow it; it then shows the file from an object URL.
 */
export async function openDocument(load: () => Promise<Blob>) {
  const tab = window.open('about:blank', '_blank')
  try {
    const blob = await load()
    const url = URL.createObjectURL(blob)
    if (tab) tab.location.href = url
    else window.location.assign(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    tab?.close()
    throw e
  }
}

function DocumentList({ documents, open }: { documents: { label: string; fileName: string }[]; open: (index: number) => Promise<Blob> }) {
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  if (!documents.length) return <p className="muted">No documents.</p>
  return (
    <ul className="mini-list">
      {documents.map((d, i) => (
        <li key={d.label}>
          <div>
            <span>{d.label}</span>
            <span className="muted small">{d.fileName}</span>
          </div>
          <Button
            size="sm"
            busy={busy === i}
            aria-label={`Open ${d.label}`}
            onClick={async () => {
              setBusy(i)
              try {
                await openDocument(() => open(i))
              } catch (e) {
                toast.error(`Couldn't open ${d.label}: ${errorMessage(e)}`)
              } finally {
                setBusy(null)
              }
            }}
          >
            <Icon name="file" size={16} />
            Open
          </Button>
        </li>
      ))}
    </ul>
  )
}

// ---------- page ----------

type Tab = 'claims' | 'quotes' | 'policies' | 'catalogue'
const TABS: { id: Tab; label: string }[] = [
  { id: 'claims', label: 'Claims' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'policies', label: 'Policies' },
  { id: 'catalogue', label: 'Catalogue' },
]

export function EcoSurePage() {
  const [tab, setTab] = useState<Tab>('claims')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const j = (next + TABS.length) % TABS.length
    setTab(TABS[j].id)
    refs.current[j]?.focus()
  }
  return (
    <>
      <PageHeader title="EcoSure" subtitle="Insurance mini app: funeral claims, short-term quotes, policies and the catalogue customers see. Customers are told in the EcoSure chat." />
      <ReadOnlyNotice />
      <div className="tabs" role="tablist" aria-label="EcoSure">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`es-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`es-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab${tab === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`es-panel-${tab}`} aria-labelledby={`es-tab-${tab}`}>
        {tab === 'claims' && <ClaimsTab />}
        {tab === 'quotes' && <QuotesTab />}
        {tab === 'policies' && <PoliciesTab />}
        {tab === 'catalogue' && <CatalogueTab />}
      </div>
    </>
  )
}

// ---------- claims ----------

function ClaimsTab() {
  const [status, setStatus] = useState<EsClaimStatus | ''>('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AdminEsClaim | null>(null)
  const list = useAsync(() => api.ecosure.claims({ status, page }), [status, page])

  const replace = (c: AdminEsClaim) => {
    list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === c.id ? c : x)) })
    setSelected(c)
  }

  return (
    <Card>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="es-claim-status">Status</label>
          <select
            id="es-claim-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as EsClaimStatus | '')
              setPage(1)
            }}
          >
            <option value="">Any status</option>
            {(Object.keys(CLAIM_STATUS) as EsClaimStatus[]).map((s) => (
              <option key={s} value={s}>
                {CLAIM_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
      </form>
      <ListState
        loading={list.loading}
        error={list.error}
        data={list.data}
        onRetry={list.reload}
        isEmpty={(d) => d.items.length === 0}
        emptyTitle={status ? 'No claims with this status' : 'No claims yet'}
      >
        {(d) => (
          <>
            <div className="table-wrap" aria-busy={list.loading}>
              <table className="table table-hover">
                <caption className="sr-only">Claims</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Policy</th>
                    <th scope="col">Deceased</th>
                    <th scope="col">Policy holder</th>
                    <th scope="col">Status</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((c) => (
                    <tr key={c.id} onClick={() => setSelected(c)}>
                      <td className="nowrap">
                        <button type="button" className="link-btn mono" onClick={(e) => (e.stopPropagation(), setSelected(c))}>
                          {c.reference}
                        </button>
                      </td>
                      <td className="mono nowrap">{c.policyNumber}</td>
                      <td>
                        <div>{c.member.name}</div>
                        <div className="muted small">{RELATIONSHIP[c.member.relationship]}</div>
                      </td>
                      <td>
                        <div>{c.holder.name}</div>
                        <div className="muted small nowrap">{formatMsisdn(c.holder.msisdn)}</div>
                      </td>
                      <td>
                        <Chip map={CLAIM_STATUS} status={c.status} />
                      </td>
                      <td className="nowrap">{formatMaseru(c.createdAt)}</td>
                      <td className="nowrap">{formatMaseru(c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} loading={list.loading} />
          </>
        )}
      </ListState>
      {selected && <ClaimPanel claim={selected} onClose={() => setSelected(null)} onChanged={replace} />}
    </Card>
  )
}

type ClaimDialog = 'approve' | 'reject' | 'request_info' | null

function ClaimPanel({ claim, onClose, onChanged }: { claim: AdminEsClaim; onClose: () => void; onChanged: (c: AdminEsClaim) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ClaimDialog>(null)
  const open = OPEN_CLAIM.includes(claim.status)

  const decide = async (action: 'verify_documents' | 'start_assessment', done: string) => {
    setBusy(action)
    try {
      const c = await api.ecosure.decide(claim.id, { action })
      onChanged({ ...c, holder: claim.holder })
      toast.success(done)
    } catch (e) {
      toast.error(`Couldn't update ${claim.reference}: ${errorMessage(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog title={`Claim ${claim.reference}`} description={`Policy ${claim.policyNumber} · ${claim.holder.name}`} onClose={onClose} variant="panel">
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <Chip map={CLAIM_STATUS} status={claim.status} />
          </dd>
        </div>
        <div>
          <dt>Deceased</dt>
          <dd>
            {claim.member.name} · {RELATIONSHIP[claim.member.relationship]}
          </dd>
        </div>
        <div>
          <dt>Date of death</dt>
          <dd>{formatDay(claim.dateOfDeath)}</dd>
        </div>
        <div>
          <dt>Cause</dt>
          <dd>{CAUSE[claim.cause]}</dd>
        </div>
        <div>
          <dt>Policy holder</dt>
          <dd>
            {claim.holder.name} · {formatMsisdn(claim.holder.msisdn)}
          </dd>
        </div>
        {claim.payout !== undefined && (
          <div>
            <dt>Payout</dt>
            <dd className="num">{formatMoney(claim.payout)}</dd>
          </div>
        )}
        {claim.reason && (
          <div>
            <dt>{claim.status === 'rejected' ? 'Reason' : 'Information requested'}</dt>
            <dd>{claim.reason}</dd>
          </div>
        )}
      </dl>

      {open && (
        <div className="panel-actions">
          {claim.status === 'submitted' && (
            <WriteButton variant="primary" busy={busy === 'verify_documents'} onClick={() => decide('verify_documents', `${claim.reference}: documents verified.`)}>
              Verify documents
            </WriteButton>
          )}
          {claim.status === 'documents_verified' && (
            <WriteButton variant="primary" busy={busy === 'start_assessment'} onClick={() => decide('start_assessment', `${claim.reference}: assessment started.`)}>
              Start assessment
            </WriteButton>
          )}
          {claim.status === 'under_assessment' && (
            <WriteButton variant="primary" onClick={() => setDialog('approve')}>
              Approve…
            </WriteButton>
          )}
          <WriteButton onClick={() => setDialog('request_info')}>Request info…</WriteButton>
          <WriteButton variant="danger" onClick={() => setDialog('reject')}>
            Reject…
          </WriteButton>
        </div>
      )}

      <h3 className="panel-subtitle">Progress</h3>
      <ol className="steps">
        {claim.steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="step-dot" aria-hidden="true">
              {s.done && <Icon name="check" size={12} />}
            </span>
            <span>
              {s.label}
              <span className="sr-only">{s.done ? ' (done)' : ' (not yet)'}</span>
            </span>
            {s.at && <span className="muted small">{formatMaseru(s.at)}</span>}
          </li>
        ))}
      </ol>

      <h3 className="panel-subtitle">Documents</h3>
      <DocumentList documents={claim.documents} open={(i) => api.ecosure.claimDocument(claim.id, i)} />

      {dialog === 'approve' && <ApproveDialog claim={claim} onClose={() => setDialog(null)} onDone={onChanged} />}
      {(dialog === 'reject' || dialog === 'request_info') && (
        <ReasonDialog claim={claim} action={dialog} onClose={() => setDialog(null)} onDone={onChanged} />
      )}
    </Dialog>
  )
}

function ApproveDialog({ claim, onClose, onDone }: { claim: AdminEsClaim; onClose: () => void; onDone: (c: AdminEsClaim) => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const payout = parseAmount(amount)
    setError(payout === null ? 'Enter the payout in maloti, e.g. 15000.' : undefined)
    if (payout === null) return
    setBusy(true)
    setServerError(null)
    try {
      const c = await api.ecosure.decide(claim.id, { action: 'approve', payout })
      onDone({ ...c, holder: claim.holder })
      toast.success(`${claim.reference} approved. ${formatMoney(payout)} paid to ${claim.holder.name}.`)
      onClose()
    } catch (err) {
      setServerError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Approve ${claim.reference}`}
      description={`The payout goes straight into ${claim.holder.name}'s EcoCash wallet and they are told in the EcoSure chat.`}
      onClose={busy ? () => {} : onClose}
      size="sm"
    >
      <form onSubmit={submit} noValidate>
        <Field label="Payout (M)" error={error}>
          {(p) => <input {...p} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus />}
        </Field>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Approve and pay
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function ReasonDialog({
  claim,
  action,
  onClose,
  onDone,
}: {
  claim: AdminEsClaim
  action: 'reject' | 'request_info'
  onClose: () => void
  onDone: (c: AdminEsClaim) => void
}) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const reject = action === 'reject'
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = reason.trim()
    setError(text ? undefined : reject ? 'Give the reason the customer will see.' : 'Say what the customer needs to send.')
    if (!text) return
    setBusy(true)
    setServerError(null)
    try {
      const c = await api.ecosure.decide(claim.id, { action, reason: text })
      onDone({ ...c, holder: claim.holder })
      toast.success(reject ? `${claim.reference} rejected.` : `Asked ${claim.holder.name} for more information.`)
      onClose()
    } catch (err) {
      setServerError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={reject ? `Reject ${claim.reference}` : `Request information for ${claim.reference}`}
      description={`${claim.holder.name} sees this message in the EcoSure chat.`}
      onClose={busy ? () => {} : onClose}
      size="sm"
    >
      <form onSubmit={submit} noValidate>
        <Field label={reject ? 'Reason' : 'What is needed'} error={error}>
          {(p) => <textarea {...p} rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}
        </Field>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={reject ? 'danger' : 'primary'} busy={busy}>
            {reject ? 'Reject claim' : 'Send request'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- quotes ----------

function QuotesTab() {
  const [status, setStatus] = useState<EsQuoteStatus | ''>('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AdminEsQuote | null>(null)
  const list = useAsync(() => api.ecosure.quotes({ status, page }), [status, page])

  const replace = (q: AdminEsQuote) => {
    list.setData((d) => d && { ...d, items: d.items.map((x) => (x.reference === q.reference ? q : x)) })
    setSelected(q)
  }

  return (
    <Card>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="es-quote-status">Status</label>
          <select
            id="es-quote-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as EsQuoteStatus | '')
              setPage(1)
            }}
          >
            <option value="">Any status</option>
            {(Object.keys(QUOTE_STATUS) as EsQuoteStatus[]).map((s) => (
              <option key={s} value={s}>
                {QUOTE_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
      </form>
      <ListState
        loading={list.loading}
        error={list.error}
        data={list.data}
        onRetry={list.reload}
        isEmpty={(d) => d.items.length === 0}
        emptyTitle={status ? 'No quotes with this status' : 'No quotes yet'}
      >
        {(d) => (
          <>
            <div className="table-wrap" aria-busy={list.loading}>
              <table className="table table-hover">
                <caption className="sr-only">Quotes</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Product</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Premium / month
                    </th>
                    <th scope="col">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((q) => (
                    <tr key={q.reference} onClick={() => setSelected(q)}>
                      <td className="nowrap">
                        <button type="button" className="link-btn mono" onClick={(e) => (e.stopPropagation(), setSelected(q))}>
                          {q.reference}
                        </button>
                      </td>
                      <td>
                        <div>{q.productName}</div>
                        {q.option && <div className="muted small">{q.option}</div>}
                      </td>
                      <td>
                        {q.contactName ? <div>{q.contactName}</div> : <span className="muted">—</span>}
                        {q.msisdn && <div className="muted small nowrap">{formatMsisdn(q.msisdn)}</div>}
                      </td>
                      <td>
                        <Chip map={QUOTE_STATUS} status={q.status} />
                      </td>
                      <td className="num nowrap">{q.monthlyPremium !== undefined ? formatMoney(q.monthlyPremium) : <span className="muted">—</span>}</td>
                      <td className="nowrap">{formatMaseru(q.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} loading={list.loading} />
          </>
        )}
      </ListState>
      {selected && <QuotePanel quote={selected} onClose={() => setSelected(null)} onChanged={replace} />}
    </Card>
  )
}

function QuotePanel({ quote, onClose, onChanged }: { quote: AdminEsQuote; onClose: () => void; onChanged: (q: AdminEsQuote) => void }) {
  const [pricing, setPricing] = useState(false)
  const answers = Object.entries(quote.answers)
  return (
    <Dialog title={`Quote ${quote.reference}`} description={`${quote.productName}${quote.option ? ` · ${quote.option}` : ''}`} onClose={onClose} variant="panel">
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <Chip map={QUOTE_STATUS} status={quote.status} />
          </dd>
        </div>
        {quote.contactName && (
          <div>
            <dt>Contact</dt>
            <dd>
              {quote.contactName}
              {quote.msisdn ? ` · ${formatMsisdn(quote.msisdn)}` : ''}
            </dd>
          </div>
        )}
        {quote.monthlyPremium !== undefined && (
          <div>
            <dt>Premium</dt>
            <dd className="num">{formatMoney(quote.monthlyPremium)} a month</dd>
          </div>
        )}
        {quote.expiresAt && (
          <div>
            <dt>Valid until</dt>
            <dd>{formatMaseru(quote.expiresAt)}</dd>
          </div>
        )}
        <div>
          <dt>Requested</dt>
          <dd>{formatMaseru(quote.createdAt)}</dd>
        </div>
      </dl>
      {quote.status === 'submitted' && (
        <div className="panel-actions">
          <WriteButton variant="primary" onClick={() => setPricing(true)}>
            Price quote…
          </WriteButton>
        </div>
      )}
      <h3 className="panel-subtitle">Answers</h3>
      {answers.length === 0 ? (
        <p className="muted">No answers.</p>
      ) : (
        <dl className="detail-list">
          {answers.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <h3 className="panel-subtitle">Documents</h3>
      <DocumentList documents={quote.documents} open={(i) => api.ecosure.quoteDocument(quote.reference, i)} />
      {pricing && <PriceDialog quote={quote} onClose={() => setPricing(false)} onDone={onChanged} />}
    </Dialog>
  )
}

function PriceDialog({ quote, onClose, onDone }: { quote: AdminEsQuote; onClose: () => void; onDone: (q: AdminEsQuote) => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const premium = parseAmount(amount)
    setError(premium === null ? 'Enter the monthly premium in maloti, e.g. 450.50.' : undefined)
    if (premium === null) return
    setBusy(true)
    setServerError(null)
    try {
      const q = await api.ecosure.price(quote.reference, premium)
      onDone({ ...quote, ...q })
      toast.success(`${quote.reference} priced at ${formatMoney(premium)} a month.`)
      onClose()
    } catch (err) {
      setServerError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Price ${quote.reference}`}
      description={`${quote.contactName ?? 'The customer'} is told the price in the EcoSure chat. It is valid for 30 days.`}
      onClose={busy ? () => {} : onClose}
      size="sm"
    >
      <form onSubmit={submit} noValidate>
        <Field label="Monthly premium (M)" error={error}>
          {(p) => <input {...p} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus />}
        </Field>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Send price
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- policies ----------

function PoliciesTab() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<EsPolicyStatus | ''>('')
  const [page, setPage] = useState(1)
  const q = useDebounced(query.trim(), 300)
  const list = useAsync(() => api.ecosure.policies({ query: q, status, page }), [q, status, page])

  return (
    <Card>
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field field-grow">
          <label htmlFor="es-policy-q">Search</label>
          <input
            id="es-policy-q"
            type="search"
            placeholder="Policy number, name, ID number or phone"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="es-policy-status">Status</label>
          <select
            id="es-policy-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as EsPolicyStatus | '')
              setPage(1)
            }}
          >
            <option value="">Any status</option>
            {(Object.keys(POLICY_STATUS) as EsPolicyStatus[]).map((s) => (
              <option key={s} value={s}>
                {POLICY_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
      </form>
      <ListState
        loading={list.loading}
        error={list.error}
        data={list.data}
        onRetry={list.reload}
        isEmpty={(d) => d.items.length === 0}
        emptyTitle={q || status ? 'No policies match' : 'No policies yet'}
        emptyHint={q || status ? 'Try another number, name or status.' : undefined}
      >
        {(d) => (
          <>
            <div className="table-wrap" aria-busy={list.loading}>
              <table className="table">
                <caption className="sr-only">Policies</caption>
                <thead>
                  <tr>
                    <th scope="col">Policy</th>
                    <th scope="col">Holder</th>
                    <th scope="col">Package</th>
                    <th scope="col" className="num">
                      Premium / month
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Paid up to</th>
                    <th scope="col" className="num">
                      Members
                    </th>
                    <th scope="col">Sponsor</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((p: EsPolicy) => (
                    <tr key={p.id}>
                      <td className="mono nowrap">{p.number}</td>
                      <td>
                        <div>{p.holder.name}</div>
                        <div className="muted small nowrap">{formatMsisdn(p.holder.msisdn)}</div>
                      </td>
                      <td>
                        <div>{p.packageName}</div>
                        <div className="muted small">{p.cover === 'family' ? 'Family cover' : 'Single cover'}</div>
                      </td>
                      <td className="num nowrap">{formatMoney(p.premium)}</td>
                      <td>
                        <Chip map={POLICY_STATUS} status={p.status} />
                      </td>
                      <td className="nowrap">{formatDay(p.nextDue)}</td>
                      <td className="num">{p.members.length}</td>
                      <td>{p.sponsoredBy ? p.sponsoredBy.name : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} loading={list.loading} />
          </>
        )}
      </ListState>
    </Card>
  )
}

// ---------- catalogue ----------
// Funeral packages, prices and cover terms come from EcoSure's package list (read only here). Staff set the words
// around them: taglines, the most popular package, the Ts&Cs and the call centre number.

const PRODUCT_STATUS: Record<AdminEsProduct['status'], { label: string; chip: string }> = {
  active: { label: 'On sale', chip: 'chip-ok' },
  draft: { label: 'Draft', chip: 'chip-neutral' },
  retired: { label: 'Off sale', chip: 'chip-cancelled' },
}

function CoverCell({ option }: { option?: EsOption }) {
  if (!option) return <span className="muted">Not offered</span>
  return (
    <>
      <strong>{formatMoney(option.monthlyPremium)}</strong> a month
      <div className="muted small">
        {option.sumAssured != null ? `Pays ${formatMoney(option.sumAssured)}` : 'Payout not set'}
        {option.waitingMonths ? ` · ${option.waitingMonths}-month wait` : ''}
        {option.beneficiaryRequired ? ' · beneficiary required' : ''}
      </div>
    </>
  )
}

function CatalogueTab() {
  const toast = useToast()
  const cat = useAsync(() => api.ecosure.catalogue(), [])
  const [data, setData] = useState<AdminEsCatalogue | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState<AdminEsProduct | null>(null)
  const view = data ?? cat.data

  const syncNow = async () => {
    setSyncing(true)
    try {
      const next = await api.ecosure.syncCatalogue()
      setData(next)
      if (next.sync?.ok) toast.success(next.sync.updated ? `${next.sync.updated} changes from EcoSure.` : 'Already up to date with EcoSure.')
      else toast.error(`EcoSure package list failed: ${next.sync?.error ?? 'unknown error'}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSyncing(false)
    }
  }
  const makePopular = async (p: AdminEsProduct) => {
    try {
      setData(await api.ecosure.productText(p.code, { popular: true }))
      toast.success(`${p.name} is now shown first.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <ListState loading={cat.loading && !view} error={cat.error} data={view} onRetry={cat.reload} isEmpty={(d) => d.products.length === 0} emptyTitle="No EcoSure products yet">
      {(d) => {
        const funeral = d.products.filter((p) => p.line === 'funeral')
        const other = d.products.filter((p) => p.line !== 'funeral')
        return (
          <>
            <Card
              title="EcoSure package list"
              actions={
                <WriteButton size="sm" busy={syncing} onClick={syncNow}>
                  Sync now
                </WriteButton>
              }
            >
              {d.sync ? (
                <p>
                  <span className={`chip ${d.sync.ok ? 'chip-ok' : 'chip-suspended'}`}>{d.sync.ok ? 'Connected' : 'Failed'}</span> Last checked{' '}
                  {formatMaseru(d.sync.at)}
                  {d.sync.ok ? ` · ${d.sync.packages} packages · ${d.sync.updated} changes` : ` · ${d.sync.error ?? ''} (the app keeps the last good prices)`}
                </p>
              ) : (
                <p className="muted">Not connected: set ECOSURE_PACKAGES_URL on the server. Prices below are the last ones saved.</p>
              )}
              {d.sync?.skipped.length ? <p className="muted small">Not in the app (they fit no package tier): {d.sync.skipped.join(', ')}</p> : null}
              <p className="muted small">
                Packages, prices, payouts, waiting periods and beneficiary rules come from EcoSure and are checked every hour. Policies already sold keep
                their premium.
              </p>
            </Card>

            <Card title="Funeral packages">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Package</th>
                      <th scope="col">Family cover</th>
                      <th scope="col">Single cover</th>
                      <th scope="col">Extended member</th>
                      <th scope="col">Shown to customers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funeral.map((p) => (
                      <tr key={p.code}>
                        <td>
                          <strong>{p.name}</strong> <span className={`chip ${PRODUCT_STATUS[p.status].chip}`}>{PRODUCT_STATUS[p.status].label}</span>
                          <div className="muted small">
                            {p.code}
                            {p.packageIds.length ? ` · EcoSure ${p.packageIds.join(', ')}` : ''}
                          </div>
                        </td>
                        <td>
                          <CoverCell option={p.options.find((o) => o.cover === 'family')} />
                        </td>
                        <td>
                          <CoverCell option={p.options.find((o) => o.cover === 'single')} />
                        </td>
                        <td>
                          {p.extendedMember ? (
                            <>
                              <strong>{formatMoney(p.extendedMember.monthlyPremium)}</strong> a month
                              <div className="muted small">Pays {formatMoney(p.extendedMember.sumAssured)}</div>
                            </>
                          ) : (
                            <span className="muted">Not offered</span>
                          )}
                        </td>
                        <td>
                          {p.tagline ? <div>{p.tagline.en}</div> : <div className="muted">No tagline</div>}
                          {p.popular ? <span className="chip chip-ok">Shown first</span> : null}
                          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <WriteButton size="sm" onClick={() => setEditing(p)}>
                              Edit tagline
                            </WriteButton>
                            {!p.popular && p.status === 'active' ? (
                              <WriteButton size="sm" onClick={() => makePopular(p)}>
                                Show first
                              </WriteButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {other.length ? (
              <Card title="Short-term products">
                <ul className="plain-list">
                  {other.map((p) => (
                    <li key={p.code}>
                      <strong>{p.name}</strong> <span className={`chip ${PRODUCT_STATUS[p.status].chip}`}>{PRODUCT_STATUS[p.status].label}</span>{' '}
                      <span className="muted small">
                        {p.pricing === 'quoted' ? 'Priced by staff for each quote' : p.options.map((o) => `${o.label} ${formatMoney(o.monthlyPremium)}`).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <ContentCard content={d.content} onSaved={setData} />
            {editing && <TaglineDialog product={editing} onClose={() => setEditing(null)} onSaved={setData} />}
          </>
        )
      }}
    </ListState>
  )
}

function TaglineDialog({ product, onClose, onSaved }: { product: AdminEsProduct; onClose: () => void; onSaved: (c: AdminEsCatalogue) => void }) {
  const toast = useToast()
  const [v, setV] = useState<LocalizedText>(product.tagline ?? { en: '', st: '' })
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setServerError(null)
    try {
      const tagline = v.en.trim() ? { en: v.en.trim(), st: v.st.trim() } : null
      onSaved(await api.ecosure.productText(product.code, { tagline }))
      toast.success(tagline ? `Tagline saved for ${product.name}.` : `Tagline removed from ${product.name}.`)
      onClose()
    } catch (err) {
      setServerError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Tagline · ${product.name}`}
      description="The line under the package name in the app. Leave English empty to show the name only."
      onClose={busy ? () => {} : onClose}
      size="sm"
    >
      <form onSubmit={save} noValidate>
        <Field label="English">{(p) => <input {...p} maxLength={120} value={v.en} onChange={(e) => setV({ ...v, en: e.target.value })} data-autofocus />}</Field>
        <Field label="Sesotho" hint="Empty: the app shows the English line.">
          {(p) => <input {...p} lang="st" maxLength={120} value={v.st} onChange={(e) => setV({ ...v, st: e.target.value })} />}
        </Field>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function ContentCard({ content, onSaved }: { content: EsContent; onSaved: (c: AdminEsCatalogue) => void }) {
  const toast = useToast()
  const [v, setV] = useState<EsContent>(content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!v.terms.en.trim()) return setError('The English Ts&Cs are required.')
    setError(undefined)
    setBusy(true)
    try {
      onSaved(await api.ecosure.content({ terms: { en: v.terms.en.trim(), st: v.terms.st.trim() }, callCentre: v.callCentre?.trim() || null }))
      toast.success('EcoSure texts saved. The app shows them the next time EcoSure opens.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Ts&Cs and call centre">
      <form onSubmit={save} noValidate>
        <Field label="Ts&Cs (English)" error={error} hint="Shown before a customer buys cover.">
          {(p) => <textarea {...p} rows={5} maxLength={2000} value={v.terms.en} onChange={(e) => setV({ ...v, terms: { ...v.terms, en: e.target.value } })} />}
        </Field>
        <Field label="Ts&Cs (Sesotho)" hint="Empty: the app shows the English text.">
          {(p) => <textarea {...p} lang="st" rows={5} maxLength={2000} value={v.terms.st} onChange={(e) => setV({ ...v, terms: { ...v.terms, st: e.target.value } })} />}
        </Field>
        <Field label="Call centre number" hint="Shown under Help in EcoSure. Empty: customers are pointed to the EcoSure chat.">
          {(p) => <input {...p} inputMode="tel" maxLength={40} value={v.callCentre ?? ''} onChange={(e) => setV({ ...v, callCentre: e.target.value })} />}
        </Field>
        <div className="dialog-foot">
          <WriteButton type="submit" variant="primary" busy={busy}>
            Save texts
          </WriteButton>
        </div>
      </form>
    </Card>
  )
}
