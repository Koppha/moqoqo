import { useState, type FormEvent } from 'react'
import type { Message, SupportTicket, SupportTicketDetail, SupportTopic, TicketStatus } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorState, ListState, Loading, PageHeader, Pagination, Segmented, WriteButton } from '../components/ui'
import { formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

export const TOPIC_LABEL: Record<SupportTopic, string> = {
  payments: 'Payments', account: 'Account / PIN', kyc: 'KYC', ecosure: 'EcoSure', cards_banks: 'Cards & banks', fraud: 'Fraud', other: 'Other',
}
const STATUS: Record<TicketStatus, { label: string; chip: string }> = {
  open: { label: 'Needs an answer', chip: 'chip-warn' },
  waiting: { label: 'Waiting for customer', chip: 'chip-neutral' },
  closed: { label: 'Closed', chip: 'chip-ok' },
}

export function SupportPage() {
  const [tab, setTab] = useState<'inbox' | 'analytics'>('inbox')
  return (
    <>
      <PageHeader title="Help & support" subtitle="The EcoCash Assistant answers first; what it hands over to a person lands here, with the AI conversation." />
      <Segmented label="Show" name="support-tab" hideLabel value={tab} onChange={setTab} options={[{ value: 'inbox', label: 'Inbox' }, { value: 'analytics', label: 'Assistant analytics' }]} />
      <div style={{ height: 16 }} />
      {tab === 'inbox' ? <Inbox /> : <Analytics />}
    </>
  )
}

function Inbox() {
  const [status, setStatus] = useState<TicketStatus | ''>('open')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<SupportTicket | null>(null)
  const list = useAsync(() => api.support.tickets({ status, page }), [status, page])
  return (
    <Card>
      <div className="filters">
        <div className="field">
          <label htmlFor="t-status">Show</label>
          <select id="t-status" value={status} onChange={(e) => { setStatus(e.target.value as TicketStatus | ''); setPage(1) }}>
            <option value="open">Needs an answer</option>
            <option value="waiting">Waiting for customer</option>
            <option value="closed">Closed</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <ListState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} isEmpty={(d) => d.items.length === 0} emptyTitle="Nothing here">
        {(d) => (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Support tickets</caption>
                <thead><tr><th scope="col">Ticket</th><th scope="col">Customer</th><th scope="col">Topic</th><th scope="col">What they need</th><th scope="col">Updated</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {d.items.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => setOpen(t)}>
                      <td className="mono nowrap"><button type="button" className="link-button" onClick={() => setOpen(t)}>{t.reference}</button></td>
                      <td><div>{t.user.name}</div><div className="muted small">{formatMsisdn(t.user.msisdn)}</div></td>
                      <td>{TOPIC_LABEL[t.topic]}</td>
                      <td className="cell-message">{t.summary}</td>
                      <td className="nowrap">{formatMaseru(t.updatedAt)}</td>
                      <td><span className={`chip ${STATUS[t.status].chip}`}>{STATUS[t.status].label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} loading={list.loading} />
          </>
        )}
      </ListState>
      {open && <TicketPanel id={open.id} onClose={() => { setOpen(null); list.reload() }} />}
    </Card>
  )
}

function Bubble({ m, mine }: { m: Message; mine: boolean }) {
  return (
    <div className={`bubble ${mine ? 'bubble-me' : 'bubble-them'}`}>
      <div>{m.text ?? (m.kind === 'action' ? `[card] ${m.text ?? ''}` : `[${m.kind}]`)}</div>
      <div className="muted small">{formatMaseru(m.createdAt)}</div>
    </div>
  )
}

function TicketPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const detail = useAsync(() => api.support.ticket(id), [id])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const t = detail.data

  const run = async (fn: () => Promise<SupportTicketDetail>, done: string) => {
    setBusy(true)
    try {
      const next = await fn()
      detail.setData(() => next)
      toast.success(done)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    run(() => api.support.reply(id, text.trim()), 'Sent. The customer sees it in the EcoCash Support chat.').then(() => setText(''))
  }

  return (
    <Dialog title={t ? `${t.reference} · ${TOPIC_LABEL[t.topic]}` : 'Ticket'} description={t ? `${t.user.name} · ${formatMsisdn(t.user.msisdn)}` : undefined} onClose={onClose} variant="panel" size="lg">
      {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} /> : !t ? <Loading /> : (
        <>
          <p><span className={`chip ${STATUS[t.status].chip}`}>{STATUS[t.status].label}</span> <span className="muted small">Opened {formatMaseru(t.createdAt)}{t.assignedTo ? ` · ${t.assignedTo}` : ''}</span></p>
          <p className="ticket-summary">{t.summary}</p>
          <div className="grid-2">
            <div>
              <h3 className="panel-subtitle">With the EcoCash Assistant</h3>
              <div className="thread">{t.aiConversation.length ? t.aiConversation.map((m) => <Bubble key={m.id} m={m} mine={m.senderId === t.user.id} />) : <p className="muted">No assistant conversation.</p>}</div>
            </div>
            <div>
              <h3 className="panel-subtitle">EcoCash Support chat</h3>
              <div className="thread">{t.thread.map((m) => <Bubble key={m.id} m={m} mine={m.senderId === t.user.id} />)}</div>
              {t.status !== 'closed' && (
                <form onSubmit={send} noValidate>
                  <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
                    <legend className="sr-only">Reply</legend>
                    <label className="field"><span className="field-label">Reply (your first name is added)</span><textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></label>
                    <div className="row-gap">
                      <WriteButton type="submit" variant="primary" busy={busy}>Send reply</WriteButton>
                      <WriteButton onClick={() => run(() => api.support.close(id), 'Ticket closed.')}>Close ticket</WriteButton>
                    </div>
                  </fieldset>
                </form>
              )}
            </div>
          </div>
        </>
      )}
      <Button onClick={onClose} className="sr-only">Close</Button>
    </Dialog>
  )
}

function Analytics() {
  const [days, setDays] = useState(30)
  const s = useAsync(() => api.support.stats(days), [days])
  if (s.error) return <ErrorState error={s.error} onRetry={s.reload} />
  if (!s.data) return <Loading />
  const d = s.data
  const max = Math.max(1, ...d.perDay.map((p) => p.questions))
  return (
    <>
      <div className="filters">
        <div className="field">
          <label htmlFor="s-days">Period</label>
          <select id="s-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>
      <div className="stat-grid">
        <Stat label="People helped" value={d.people} />
        <Stat label="Questions" value={d.questions} />
        <Stat label="Solved by the assistant" value={`${Math.round(d.selfServiceRate * 100)}%`} />
        <Stat label="Handed to a person" value={d.handovers} />
        <Stat label="Declined (policy)" value={d.refusals} />
        <Stat label="Errors" value={d.errors} />
        <Stat label="Tickets open / waiting" value={`${d.tickets.open} / ${d.tickets.waiting}`} />
        <Stat label="Median first reply" value={d.medianFirstResponseMinutes === null ? '—' : `${d.medianFirstResponseMinutes} min`} />
      </div>
      <div className="grid-2">
        <Card title="Questions per day">
          {d.perDay.length === 0 ? <p className="muted">No questions in this period.</p> : (
            <div className="bars" role="img" aria-label="Questions per day">
              {d.perDay.map((p) => (
                <div key={p.day} className="bar" title={`${p.day}: ${p.questions} questions, ${p.handovers} handed over`}>
                  <div className="bar-fill" style={{ height: `${(p.questions / max) * 100}%` }} />
                  <span>{p.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="What it was used for">
          <ul className="mini-list">
            {d.tools.map((x) => <li key={x.name}><span>{x.name.replace(/_/g, ' ')}</span><span className="num">{x.count}</span></li>)}
            {d.topics.map((x) => <li key={x.topic}><span>Ticket: {TOPIC_LABEL[x.topic]}</span><span className="num">{x.count}</span></li>)}
            {!d.tools.length && !d.topics.length && <li className="muted">Nothing yet.</li>}
          </ul>
        </Card>
      </div>
    </>
  )
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
