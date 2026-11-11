import { useState, type FormEvent } from 'react'
import type { NotificationStatus, NotifyCategory, NotifyChannel } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../components/Toast'
import { Card, Field, ListState, PageHeader, Pagination, ReadOnlyNotice, WriteButton } from '../components/ui'
import { formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync, useDebounced } from '../useAsync'

export const CHANNEL_LABEL: Record<NotifyChannel, string> = { push: 'Push', sms: 'SMS', email: 'Email' }
export const CATEGORY_LABEL: Record<NotifyCategory, string> = {
  money: 'Money in & out',
  requests: 'Requests & bills',
  ecosure: 'EcoSure',
  chats: 'Chat messages',
  news: 'News & offers',
  security: 'Security alert',
}
const STATUS: Record<NotificationStatus, { label: string; chip: string }> = {
  sent: { label: 'Sent', chip: 'chip-ok' },
  mock: { label: 'Mock (not delivered)', chip: 'chip-neutral' },
  failed: { label: 'Failed', chip: 'chip-suspended' },
}

function Providers() {
  const p = useAsync(() => api.notifications.providers(), [])
  if (!p.data) return null
  const row = (label: string, real: boolean, hint: string) => (
    <li>
      <span className={`chip ${real ? 'chip-ok' : 'chip-warn'}`}>{real ? 'Connected' : 'Mock'}</span> <strong>{label}</strong> <span className="muted small">{hint}</span>
    </li>
  )
  return (
    <Card title="Providers">
      <ul className="plain-list">
        {row('Push', p.data.push, p.data.push ? 'Expo push service.' : 'Set PUSH_ENABLED=true on the server (the apps need an EAS project ID).')}
        {row('SMS', p.data.sms, p.data.sms ? '' : 'Nothing is sent yet; messages are recorded here only.')}
        {row('Email', p.data.email, p.data.email ? '' : 'Nothing is sent yet; emails (including confirmation codes) are recorded here only.')}
        {row('EcoCash Assistant', p.data.assistant, p.data.assistant ? 'Claude API.' : 'Set ANTHROPIC_API_KEY on the server to switch the assistant on.')}
      </ul>
    </Card>
  )
}

function NewsForm() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    if (!title.trim() || !body.trim()) return setError('Write a title and a message.')
    setBusy(true)
    setError(null)
    try {
      const r = await api.notifications.news({ title: title.trim(), body: body.trim() })
      toast.success(`Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'} who switched on news and offers.`)
      setTitle('')
      setBody('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Send news & offers">
      <p className="muted small">Only people who switched on “News & offers” get it, on the channels they chose. It's off for everyone until they opt in.</p>
      {!canWrite && <ReadOnlyNotice />}
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">News and offers</legend>
          <Field label="Title" hint="Up to 60 characters.">
            {(p) => <input {...p} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Message" hint="Up to 300 characters. SMS starts with “EcoCash Super App:”." error={error ?? undefined}>
            {(p) => <textarea {...p} rows={3} maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <WriteButton type="submit" variant="primary" busy={busy}>
            Send news
          </WriteButton>
        </fieldset>
      </form>
    </Card>
  )
}

export function NotificationsPage() {
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<NotifyChannel | ''>('')
  const [category, setCategory] = useState<NotifyCategory | ''>('')
  const [page, setPage] = useState(1)
  const q = useDebounced(query.trim(), 300)
  const list = useAsync(() => api.notifications.list({ query: q, channel, category, page }), [q, channel, category, page])

  return (
    <>
      <PageHeader title="Notifications" subtitle="Push, SMS and email sent to wallets, newest first. Each person chooses what they get; security alerts always go." />
      <div className="grid-2">
        <Providers />
        <NewsForm />
      </div>
      <Card>
        <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
          <div className="field field-grow">
            <label htmlFor="n-q">Search</label>
            <input id="n-q" type="search" placeholder="Name, number, email or text" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
          </div>
          <div className="field">
            <label htmlFor="n-channel">Channel</label>
            <select id="n-channel" value={channel} onChange={(e) => { setChannel(e.target.value as NotifyChannel | ''); setPage(1) }}>
              <option value="">All channels</option>
              {(Object.keys(CHANNEL_LABEL) as NotifyChannel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="n-category">Kind</label>
            <select id="n-category" value={category} onChange={(e) => { setCategory(e.target.value as NotifyCategory | ''); setPage(1) }}>
              <option value="">All kinds</option>
              {(Object.keys(CATEGORY_LABEL) as NotifyCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
        </form>
        <ListState
          loading={list.loading}
          error={list.error}
          data={list.data}
          onRetry={list.reload}
          isEmpty={(d) => d.items.length === 0}
          emptyTitle={q || channel || category ? 'No notifications match' : 'No notifications yet'}
        >
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Notifications</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time (Maseru)</th>
                      <th scope="col">To</th>
                      <th scope="col">Channel</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Message</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((n) => (
                      <tr key={n.id}>
                        <td className="nowrap">{formatMaseru(n.createdAt)}</td>
                        <td>
                          <div>{n.user ? n.user.businessName ?? n.user.name : <span className="muted">—</span>}</div>
                          <div className="muted small nowrap">{n.channel === 'sms' ? formatMsisdn(n.recipient) : n.recipient}</div>
                        </td>
                        <td>{CHANNEL_LABEL[n.channel]}</td>
                        <td><span className="chip chip-neutral">{CATEGORY_LABEL[n.category]}</span></td>
                        <td className="cell-message">
                          <strong>{n.title}</strong>
                          <div>{n.body}</div>
                        </td>
                        <td>
                          <span className={`chip ${STATUS[n.status].chip}`}>{STATUS[n.status].label}</span>
                          {n.error && <div className="muted small">{n.error}</div>}
                        </td>
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
    </>
  )
}
