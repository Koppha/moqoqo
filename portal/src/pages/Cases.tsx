import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CASE_STATUS_LABEL, RISK_ALERT_TITLE, type CasePriority, type CaseStatus, type FraudCaseDetail } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { CountTabs, Dot, DotChip, FilterBar, TableCard, Tag, When, type Tone } from '../components/dataview'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorState, Field, ListState, Loading, PageHeader, Pagination, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

const PRIORITY: { value: CasePriority; label: string; tone: Tone }[] = [
  { value: 'high', label: 'High', tone: 'red' },
  { value: 'medium', label: 'Medium', tone: 'orange' },
  { value: 'low', label: 'Low', tone: 'blue' },
]
const PRIORITY_TONE = Object.fromEntries(PRIORITY.map((p) => [p.value, p.tone])) as Record<CasePriority, Tone>
const STATUS_TONE: Record<CaseStatus, Tone> = { open: 'amber', investigating: 'blue', escalated: 'purple', closed_fraud: 'red', closed_ok: 'green' }
const isClosed = (s: CaseStatus) => s === 'closed_fraud' || s === 'closed_ok'

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
      {hint && <dd className="stat-hint">{hint}</dd>}
    </div>
  )
}

export function CasesPage() {
  const { id } = useParams()
  return id ? <CaseView id={id} /> : <CaseList />
}

function CaseList() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<CaseStatus | 'active' | ''>('active')
  const [priority, setPriority] = useState<CasePriority | ''>('')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [opening, setOpening] = useState(false)
  const list = useAsync(() => api.cases.list({ status, priority, mine: mine ? '1' : '', page }), [status, priority, mine, page])
  const stats = useAsync(() => api.cases.stats(), [])
  const counts = list.data?.counts ?? {}
  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  return (
    <>
      <PageHeader
        crumbs={['Security', 'Financial crime', 'Cases']}
        title="Cases"
        subtitle="Alerts about one wallet are gathered in one case. Serious alerts open a case on their own; investigate, freeze, close and report to the FIU here."
        actions={<WriteButton variant="primary" onClick={() => setOpening(true)}>Open a case</WriteButton>}
      />
      {stats.data && (
        <Card>
          <dl className="stats">
            <Stat label="New" value={stats.data.open} hint={`${stats.data.unassigned} not assigned`} />
            <Stat label="Investigating" value={stats.data.investigating} />
            <Stat label="Escalated" value={stats.data.escalated} />
            <Stat label="Closed (30 days)" value={stats.data.closedLast30} hint={stats.data.avgDaysToClose == null ? undefined : `${stats.data.avgDaysToClose} days on average`} />
          </dl>
        </Card>
      )}
      <FilterBar>
        <CountTabs
          label="Status"
          value={status || 'all'}
          onChange={(v) => pick(setStatus)(v === 'all' ? '' : (v as CaseStatus | 'active'))}
          options={[
            { value: 'active', label: 'Active', count: counts['status:active'] ?? 0 },
            ...(['open', 'investigating', 'escalated', 'closed_fraud', 'closed_ok'] as CaseStatus[]).map((s) => ({ value: s, label: CASE_STATUS_LABEL[s], count: counts[`status:${s}`] ?? 0 })),
            { value: 'all', label: 'All', count: counts['status:all'] },
          ]}
        />
        {PRIORITY.map((o) => (
          <DotChip key={o.value} tone={o.tone} label={o.label} count={counts[`priority:${o.value}`] ?? 0} active={priority === o.value} onClick={() => pick(setPriority)(priority === o.value ? '' : o.value)} />
        ))}
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => pick(setMine)(e.target.checked)} /> Assigned to me</label>
      </FilterBar>
      <TableCard title="Cases" count={list.data?.total} unit={['case', 'cases']}>
        <ListState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} isEmpty={(d) => d.items.length === 0} emptyTitle="No cases here">
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Financial crime cases</caption>
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Wallet</th>
                      <th scope="col">Alerts</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col">Assigned</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => navigate(`/cases/${c.id}`)}>
                        <td><Link to={`/cases/${c.id}`} onClick={(e) => e.stopPropagation()}><strong>{c.ref}</strong></Link><div className="muted small">{c.title}</div></td>
                        <td><Dot tone={PRIORITY_TONE[c.priority]}>{PRIORITY.find((p) => p.value === c.priority)?.label}</Dot></td>
                        <td><div>{c.user.name}</div><div className="muted small nowrap">{formatMsisdn(c.user.msisdn)}</div></td>
                        <td>{c.alertCount}{c.openAlerts ? <div className="muted small">{c.openAlerts} to review</div> : null}</td>
                        <td className="nowrap">{formatMoney(c.amount)}</td>
                        <td>
                          <Tag tone={STATUS_TONE[c.status]}>{CASE_STATUS_LABEL[c.status]}</Tag>
                          {c.frozen && <div><Tag tone="red">Frozen</Tag></div>}
                          {c.strRef && <div className="muted small">STR filed</div>}
                        </td>
                        <td className="small">{c.assignedTo ?? <span className="muted">Nobody</span>}</td>
                        <td><When iso={c.updatedAt} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} loading={list.loading} />
            </>
          )}
        </ListState>
      </TableCard>
      {opening && <OpenCaseDialog onClose={() => setOpening(false)} onOpened={(c) => navigate(`/cases/${c.id}`)} />}
    </>
  )
}

function OpenCaseDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (c: FraudCaseDetail) => void }) {
  const [msisdn, setMsisdn] = useState('+266')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      onOpened(await api.cases.open({ msisdn: msisdn.replace(/\s+/g, ''), title, note }))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Open a case"
      description="For a report from a customer, a bank or the police. The wallet's open alerts join the case."
      onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" busy={busy} disabled={title.trim().length < 3} onClick={submit}>Open case</Button></>}
    >
      <Field label="Wallet number">{(p) => <input {...p} value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" />}</Field>
      <Field label="What it is about">{(p) => <input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Customer reported a scam call" />}</Field>
      <Field label="Note">{(p) => <textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />}</Field>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Dialog>
  )
}

type Action = 'close' | 'freeze' | 'unfreeze' | 'str' | null

function CaseView({ id }: { id: string }) {
  const { admin, canWrite } = useAuth()
  const toast = useToast()
  const c = useAsync(() => api.cases.get(id), [id])
  const [note, setNote] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [summarising, setSummarising] = useState(false)

  const run = async (fn: () => Promise<FraudCaseDetail>, done: string) => {
    try {
      const next = await fn()
      c.setData(() => next)
      toast.success(done)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  if (c.error) return <ErrorState error={c.error} onRetry={c.reload} />
  if (!c.data) return <Loading />
  const d = c.data
  const closed = isClosed(d.status)

  return (
    <>
      <PageHeader
        crumbs={['Security', 'Financial crime', 'Cases', d.ref]}
        title={`${d.ref}: ${d.title}`}
        subtitle={<><Link to="/cases">← All cases</Link> · opened <When iso={d.createdAt} /></>}
        actions={
          <div className="row-gap">
            <Button onClick={() => printReport(d)}>Print STR draft</Button>
            {!closed && <WriteButton variant="danger" onClick={() => setAction('close')}>Close case</WriteButton>}
          </div>
        }
      />
      <div className="grid-2">
        <Card title="Wallet" icon="users">
          <dl className="stats">
            <Stat label={d.user.name} value={formatMoney(d.wallet.balance)} hint={formatMsisdn(d.user.msisdn)} />
            <Stat label="Status" value={d.wallet.status === 'suspended' ? <Tag tone="red">Frozen</Tag> : <Tag tone="green">Active</Tag>} hint={`KYC tier ${d.wallet.kycTier}`} />
            <Stat label="Opened" value={<span className="small">{formatMaseru(d.wallet.createdAt)}</span>} hint={`${d.wallet.phones} phone${d.wallet.phones === 1 ? '' : 's'} used`} />
            <Stat label="In alerts" value={formatMoney(d.amount)} hint={`${d.alertCount} alerts`} />
          </dl>
          {!closed && (
            <div className="row-gap" style={{ marginTop: 12 }}>
              {d.frozen || d.wallet.status === 'suspended'
                ? <WriteButton onClick={() => setAction('unfreeze')}>Unfreeze wallet</WriteButton>
                : <WriteButton variant="danger" onClick={() => setAction('freeze')}>Freeze wallet</WriteButton>}
            </div>
          )}
        </Card>
        <Card title="Case" icon="file">
          <dl className="stats">
            <Stat label="Status" value={<Tag tone={STATUS_TONE[d.status]}>{CASE_STATUS_LABEL[d.status]}</Tag>} />
            <Stat label="Priority" value={<Dot tone={PRIORITY_TONE[d.priority]}>{PRIORITY.find((p) => p.value === d.priority)?.label}</Dot>} />
            <Stat label="Assigned" value={<span className="small">{d.assignedTo ?? 'Nobody'}</span>} />
            <Stat label="STR" value={<span className="small">{d.strRef ?? 'Not filed'}</span>} hint={d.strFiledAt ? formatMaseru(d.strFiledAt) : undefined} />
          </dl>
          {!closed && (
            <div className="row-gap" style={{ marginTop: 12 }}>
              {d.assignedTo !== admin?.email && <WriteButton size="sm" onClick={() => run(() => api.cases.update(d.id, { assignedTo: admin!.email }), 'Assigned to you.')}>Assign to me</WriteButton>}
              {d.status !== 'investigating' && <WriteButton size="sm" onClick={() => run(() => api.cases.update(d.id, { status: 'investigating' }), 'Investigating.')}>Investigating</WriteButton>}
              {d.status !== 'escalated' && <WriteButton size="sm" onClick={() => run(() => api.cases.update(d.id, { status: 'escalated' }), 'Escalated.')}>Escalate</WriteButton>}
              {!d.strRef && <WriteButton size="sm" onClick={() => setAction('str')}>STR filed…</WriteButton>}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="AI summary"
        icon="info"
        actions={!closed && <WriteButton size="sm" busy={summarising} onClick={async () => {
          setSummarising(true)
          await run(() => api.cases.summary(d.id), 'Summary written.')
          setSummarising(false)
        }}>{d.summary ? 'Write again' : 'Summarise with AI'}</WriteButton>}
      >
        {d.summary ? (
          <>
            <p className="muted small">Written by AI (Claude) · {formatMaseru(d.summary.createdAt)} · a draft to check, never a finding. No names or numbers were sent.</p>
            <div className="ai-summary">{d.summary.text}</div>
          </>
        ) : (
          <p className="muted">A neutral first read of the alerts and payments, with red flags and what to check next. The AI sees no names, numbers or IDs.</p>
        )}
      </Card>

      <TableCard title="Alerts" count={d.alerts.length} unit={['alert', 'alerts']}>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Alerts in this case</caption>
            <thead><tr><th scope="col">Raised</th><th scope="col">What</th><th scope="col">Detail</th><th scope="col">Score</th><th scope="col">Action</th><th scope="col">Review</th></tr></thead>
            <tbody>
              {d.alerts.map((a) => (
                <tr key={a.id}>
                  <td><When iso={a.createdAt} /></td>
                  <td><strong>{RISK_ALERT_TITLE[a.rule]}</strong></td>
                  <td className="cell-message">{a.detail}{a.amount !== null && <div className="muted small">{formatMoney(a.amount)}{a.kind ? ` · ${a.kind}` : ''}</div>}</td>
                  <td>{a.score ?? <span className="muted">–</span>}</td>
                  <td>{a.action === 'blocked' ? <Tag tone="red">Blocked</Tag> : <Tag tone="amber">Let through</Tag>}</td>
                  <td>{a.status === 'open' ? <Tag tone="grey">To review</Tag> : a.status === 'fraud' ? <Tag tone="red">Fraud</Tag> : <Tag tone="green">Fine</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>

      <div className="grid-2">
        <TableCard title="Payments, last 30 days" count={d.transactions.length} unit={['payment', 'payments']}>
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="table">
              <caption className="sr-only">The wallet's payments</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Other side</th><th scope="col">Amount</th></tr></thead>
              <tbody>
                {d.transactions.map((t) => (
                  <tr key={t.reference} className={t.flagged ? 'row-flagged' : undefined}>
                    <td><When iso={t.createdAt} /><div className="muted small">{t.reference}</div></td>
                    <td>{t.kind}{t.flagged && <div><Tag tone="red">Alert</Tag></div>}</td>
                    <td className="small">{t.counterparty ?? <span className="muted">Outside EcoCash</span>}</td>
                    <td className={`nowrap ${t.direction === 'in' ? 'amount-in' : 'amount-out'}`}>{t.direction === 'in' ? '+' : '−'}{formatMoney(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCard>
        <Card title="History" icon="clock">
          <ol className="timeline">
            {d.events.map((e) => (
              <li key={e.id} className={`timeline-${e.kind}`}>
                <div className="small"><strong>{e.actor}</strong> · <span className="muted">{formatMaseru(e.createdAt)}</span></div>
                <div className="timeline-text">{e.kind === 'summary' ? 'AI summary written' : e.text}</div>
              </li>
            ))}
          </ol>
          {!closed && canWrite && (
            <div style={{ marginTop: 12 }}>
              <Field label="Add a note">{(p) => <textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked, who you called…" />}</Field>
              <WriteButton size="sm" disabled={!note.trim()} onClick={async () => {
                await run(() => api.cases.update(d.id, { note }), 'Note added.')
                setNote('')
              }}>Add note</WriteButton>
            </div>
          )}
        </Card>
      </div>

      {action && <ActionDialog c={d} action={action} onClose={() => setAction(null)} onDone={(next, msg) => { c.setData(() => next); toast.success(msg); setAction(null) }} />}
    </>
  )
}

function ActionDialog({ c, action, onClose, onDone }: { c: FraudCaseDetail; action: Exclude<Action, null>; onClose: () => void; onDone: (c: FraudCaseDetail, msg: string) => void }) {
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<'fraud' | 'ok'>('fraud')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cfg = {
    close: { title: `Close ${c.ref}`, label: 'What you found', button: 'Close case', danger: true, description: `Every open alert in the case is marked the same way. ${c.frozen ? 'The wallet stays frozen until you unfreeze it.' : ''}` },
    freeze: { title: `Freeze ${c.user.name}'s wallet`, label: 'Why', button: 'Freeze wallet', danger: true, description: 'They are signed out at once and can\'t pay or log in until unfrozen.' },
    unfreeze: { title: `Unfreeze ${c.user.name}'s wallet`, label: 'Why', button: 'Unfreeze wallet', danger: false, description: 'They can log in and pay again.' },
    str: { title: 'Suspicious transaction report filed', label: 'FIU reference', button: 'Save', danger: false, description: 'Record the reference after filing the report with the Financial Intelligence Unit. Use "Print STR draft" for the case facts.' },
  }[action]
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const next =
        action === 'close' ? await api.cases.close(c.id, { outcome, note: text })
        : action === 'str' ? await api.cases.fileStr(c.id, { reference: text })
        : await api.cases.freeze(c.id, { frozen: action === 'freeze', note: text })
      onDone(next, action === 'close' ? 'Case closed.' : action === 'str' ? 'STR recorded.' : action === 'freeze' ? 'Wallet frozen.' : 'Wallet unfrozen.')
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={cfg.title}
      description={cfg.description}
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant={cfg.danger ? 'danger' : 'primary'} busy={busy} disabled={text.trim().length < (action === 'str' ? 2 : 3)} onClick={submit}>{cfg.button}</Button></>}
    >
      {action === 'close' && (
        <div className="row-gap" style={{ marginBottom: 12 }} role="radiogroup" aria-label="Outcome">
          <label className="check"><input type="radio" name="outcome" checked={outcome === 'fraud'} onChange={() => setOutcome('fraud')} /> Fraud or money laundering</label>
          <label className="check"><input type="radio" name="outcome" checked={outcome === 'ok'} onChange={() => setOutcome('ok')} /> Fine, a false alarm</label>
        </div>
      )}
      <Field label={cfg.label}>{(p) => (action === 'str' ? <input {...p} value={text} onChange={(e) => setText(e.target.value)} /> : <textarea {...p} rows={3} value={text} onChange={(e) => setText(e.target.value)} />)}</Field>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Dialog>
  )
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/** A printable draft of the suspicious transaction report: the case facts in one page, for filing with the FIU. */
function printReport(c: FraudCaseDetail) {
  const w = window.open('', '_blank', 'noopener=no')
  if (!w) return
  const rows = (cells: string[][]) => cells.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.ref)} STR draft</title>
<style>body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:32px;max-width:900px}h1{font-size:20px}h2{font-size:15px;margin-top:24px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;font:inherit}.muted{color:#555}</style></head><body>
<h1>Suspicious transaction report: draft</h1>
<p class="muted">EcoCash Lesotho · case ${esc(c.ref)} · printed ${esc(formatMaseru(new Date().toISOString()))} (Maseru) · ${c.strRef ? `filed, FIU reference ${esc(c.strRef)}` : 'not filed yet'}</p>
<h2>Subject</h2><table>${rows([
    ['Name', c.user.name], ['Wallet number', c.user.msisdn], ['KYC tier', String(c.wallet.kycTier)], ['Wallet opened', formatMaseru(c.wallet.createdAt)],
    ['Balance', formatMoney(c.wallet.balance)], ['Wallet status', c.wallet.status],
  ])}</table>
<h2>Case</h2><table>${rows([['Title', c.title], ['Status', CASE_STATUS_LABEL[c.status]], ['Priority', c.priority], ['Assigned', c.assignedTo ?? ''], ['Opened', formatMaseru(c.createdAt)]])}</table>
<h2>Grounds for suspicion (alerts)</h2><table><tr><th>When</th><th>What</th><th>Detail</th><th>Amount</th><th>Review</th></tr>${rows(c.alerts.map((a) => [formatMaseru(a.createdAt), RISK_ALERT_TITLE[a.rule], a.detail, a.amount == null ? '' : formatMoney(a.amount), a.status]))}</table>
<h2>Payments, last 30 days</h2><table><tr><th>When</th><th>Reference</th><th>Kind</th><th>Other side</th><th>In / out</th><th>Amount</th></tr>${rows(c.transactions.map((t) => [formatMaseru(t.createdAt), t.reference, t.kind, t.counterparty ?? 'Outside EcoCash', t.direction, formatMoney(t.amount)]))}</table>
<h2>Investigation notes</h2><table>${rows(c.events.filter((e) => e.kind !== 'summary').map((e) => [formatMaseru(e.createdAt), e.actor, e.text]))}</table>
${c.summary ? `<h2>AI-written summary (draft, checked by staff)</h2><pre>${esc(c.summary.text)}</pre>` : ''}
</body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

