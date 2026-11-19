import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  CHURN_BAND_LABEL, CHURN_FEATURE_INFO, CHURN_FOLLOWUP_LABEL,
  type ChurnBand, type ChurnFollowupStatus, type ChurnSummary,
} from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { CountTabs, CsvButton, Dot, DotChip, fetchAll, FilterBar, FilterChip, SearchBox, TableCard, Tag, When, type Tone } from '../components/dataview'
import { useToast } from '../components/Toast'
import { Card, ErrorState, Field, ListState, Loading, PageHeader, Pagination, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn } from '../format'
import { useAsync } from '../useAsync'

const BANDS: { value: ChurnBand; tone: Tone }[] = [
  { value: 'high', tone: 'red' },
  { value: 'medium', tone: 'orange' },
  { value: 'quiet', tone: 'grey' },
  { value: 'low', tone: 'green' },
]
const BAND_TONE = Object.fromEntries(BANDS.map((b) => [b.value, b.tone])) as Record<ChurnBand, Tone>
const FOLLOWUP_TONE: Record<ChurnFollowupStatus, Tone> = { new: 'grey', contacted: 'blue', retained: 'green', lost: 'red' }
const FOLLOWUPS = Object.keys(CHURN_FOLLOWUP_LABEL) as ChurnFollowupStatus[]

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
      {hint && <dd className="stat-hint">{hint}</dd>}
    </div>
  )
}

const rate = (x: { scored: number; wentQuiet: number }) => (x.scored ? `${Math.round((x.wentQuiet / x.scored) * 100)}%` : '–')

/** Trend against a week ago: ▲ riskier, ▼ safer. */
function Trend({ now, weekAgo }: { now: number; weekAgo: number | null }) {
  if (weekAgo === null) return null
  const d = now - weekAgo
  if (Math.abs(d) < 5) return <span className="muted small"> · steady</span>
  return <span className="small" style={{ color: d > 0 ? 'var(--red, #DC2626)' : 'var(--green, #16A34A)' }}> {d > 0 ? '▲' : '▼'} {Math.abs(d)} in a week</span>
}

export function RetentionPage() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [role, setRole] = useState<'agent' | 'merchant' | ''>('')
  const [band, setBand] = useState<ChurnBand | ''>('')
  const [followup, setFollowup] = useState<ChurnFollowupStatus | ''>('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const list = useAsync(() => api.churn.list({ role, band, followup, q: query, page }), [role, band, followup, query, page])
  const counts = list.data?.counts ?? {}
  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const r = await api.churn.run()
      toast.success(r.scored ? `${r.scored} agents and merchants scored.` : 'The churn model is off in AI governance, so nothing was scored.')
      list.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <PageHeader
        crumbs={['Business', 'Retention']}
        title="Agent & merchant retention"
        subtitle={<>Every agent and merchant is scored once a day for how likely they are to stop using EcoCash, from their own activity over the last 8 weeks. Call or visit the high-risk ones first and record what you did. The model, its thresholds and its version history are in <Link to="/ai-governance">AI governance</Link>.</>}
        actions={canWrite ? <WriteButton onClick={runNow} busy={running}>Score now</WriteButton> : undefined}
      />
      {list.data && <Overview s={list.data.summary} />}
      <FilterBar>
        <CountTabs
          label="Who"
          value={role || 'all'}
          onChange={(v) => pick(setRole)(v === 'all' ? '' : (v as 'agent' | 'merchant'))}
          options={[
            { value: 'agent', label: 'Agents', count: counts['role:agent'] ?? 0 },
            { value: 'merchant', label: 'Merchants', count: counts['role:merchant'] ?? 0 },
            { value: 'all', label: 'All', count: counts['role:all'] },
          ]}
        />
        {BANDS.map((b) => (
          <DotChip key={b.value} tone={b.tone} label={CHURN_BAND_LABEL[b.value]} count={counts[`band:${b.value}`] ?? 0} active={band === b.value}
            onClick={() => pick(setBand)(band === b.value ? '' : b.value)} />
        ))}
        <FilterChip id="c-followup" label="Follow-up" value={followup} onChange={pick(setFollowup)}
          options={FOLLOWUPS.map((f) => ({ value: f, label: CHURN_FOLLOWUP_LABEL[f], count: counts[`followup:${f}`] ?? 0 }))} />
        <SearchBox id="c-q" label="Search" placeholder="Name, number or code…" value={query} onChange={pick(setQuery)} />
      </FilterBar>
      <TableCard
        title="Churn risk"
        count={list.data?.total}
        unit={['agent or merchant', 'agents and merchants']}
        actions={
          <CsvButton
            filename="moqoqo-churn-risk.csv"
            rows={async () => [
              ['Name', 'Business', 'Role', 'Code', 'Number', 'Score', 'Band', 'Score a week ago', 'Days since last transaction', 'Transactions/week now', 'Transactions/week before', 'Value/week now (M)', 'Value/week before (M)', 'Top reason', 'Follow-up', 'Note', 'By'],
              ...(await fetchAll((p) => api.churn.list({ role, band, followup, q: query, page: p, pageSize: 100 }))).map((r) => [
                r.user.name, r.user.businessName, r.user.role, r.user.code, r.user.msisdn, r.score, CHURN_BAND_LABEL[r.band], r.scoreWeekAgo,
                r.activity.daysSinceLast, r.activity.txPerWeekNow, r.activity.txPerWeekBefore, r.activity.valuePerWeekNow, r.activity.valuePerWeekBefore,
                r.reasons[0]?.detail, CHURN_FOLLOWUP_LABEL[r.followup.status], r.followup.note, r.followup.by,
              ]),
            ]}
          />
        }
      >
        <ListState
          loading={list.loading}
          error={list.error}
          data={list.data}
          onRetry={list.reload}
          isEmpty={(d) => d.items.length === 0}
          emptyTitle={list.data?.summary.lastRun ? 'Nobody matches' : 'Not scored yet'}
          emptyHint={list.data?.summary.lastRun ? 'Try another filter.' : 'Scores appear after the first daily run, or press "Score now".'}
        >
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Agents and merchants by churn risk</caption>
                  <thead>
                    <tr>
                      <th scope="col">Agent or merchant</th>
                      <th scope="col">Risk ▾</th>
                      <th scope="col">Why</th>
                      <th scope="col">Activity per week</th>
                      <th scope="col">Follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((r) => (
                      <tr key={r.user.id}>
                        <td>
                          <button type="button" className="link-button" onClick={() => setOpen(r.user.id)}><strong>{r.user.businessName ?? r.user.name}</strong></button>
                          <div className="muted small nowrap">{r.user.role === 'agent' ? 'Agent' : 'Merchant'}{r.user.code ? ` ${r.user.code}` : ''} · {formatMsisdn(r.user.msisdn)}</div>
                        </td>
                        <td className="nowrap"><Dot tone={BAND_TONE[r.band]}>{CHURN_BAND_LABEL[r.band]}</Dot><div className="small">Score {r.score}<Trend now={r.score} weekAgo={r.scoreWeekAgo} /></div></td>
                        <td className="cell-message">{r.reasons.length ? r.reasons.slice(0, 2).map((x) => <div key={x.feature} className="small">{x.detail}</div>) : <span className="muted small">Nothing unusual</span>}</td>
                        <td className="small nowrap">
                          {r.activity.txPerWeekNow} now · {r.activity.txPerWeekBefore} before
                          <div className="muted">{formatMoney(r.activity.valuePerWeekNow)} · {formatMoney(r.activity.valuePerWeekBefore)}</div>
                        </td>
                        <td>
                          <Tag tone={FOLLOWUP_TONE[r.followup.status]}>{CHURN_FOLLOWUP_LABEL[r.followup.status]}</Tag>
                          {r.followup.at && <div className="muted small">{r.followup.by} · <When iso={r.followup.at} /></div>}
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
      </TableCard>
      {open && <ChurnDialog userId={open} onClose={() => setOpen(null)} onSaved={() => list.reload()} />}
    </>
  )
}

function Overview({ s }: { s: ChurnSummary }) {
  const both = (b: ChurnBand) => s.byBand.agent[b] + s.byBand.merchant[b]
  const bt = s.backtest
  return (
    <div className="grid-2">
      <Card title="Who is at risk" icon="alert">
        <dl className="stats">
          <Stat label="High risk" value={both('high')} hint={`${s.byBand.agent.high} agents · ${s.byBand.merchant.high} merchants`} />
          <Stat label="Medium risk" value={both('medium')} hint={`${s.byBand.agent.medium} agents · ${s.byBand.merchant.medium} merchants`} />
          <Stat label="Gone quiet" value={both('quiet')} hint="No transaction in the quiet period" />
          <Stat label="At stake per week" value={formatMoney(s.weeklyValueAtRisk)} hint="Through high and medium risk, before their slowdown" />
        </dl>
        <div className="muted small" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <span>Model</span>{s.modelMode === 'off' ? <Tag tone="grey">Off</Tag> : <Tag tone="green">Active</Tag>}<span>version {s.modelVersion} ·</span>
          {s.lastRun ? <><span>last scored</span><When iso={s.lastRun} /></> : <span>not scored yet</span>}
        </div>
      </Card>
      <Card title="Is it right? Track record" icon="trend">
        {bt.scoredOn ? (
          <>
            <dl className="stats">
              <Stat label="High risk went quiet" value={rate(bt.high)} hint={`${bt.high.wentQuiet} of ${bt.high.scored}`} />
              <Stat label="Medium risk went quiet" value={rate(bt.medium)} hint={`${bt.medium.wentQuiet} of ${bt.medium.scored}`} />
              <Stat label="Low risk went quiet" value={rate(bt.low)} hint={`${bt.low.wentQuiet} of ${bt.low.scored}`} />
            </dl>
            <p className="muted small">Of the agents and merchants scored on {bt.scoredOn}, how many have gone quiet since. A useful model shows a much higher rate for high risk than for low. Those your team retained count as not quiet, so good follow-up lowers the high-risk rate.</p>
          </>
        ) : (
          <p className="muted">Shown once the model has a month of daily scores: it then compares what it said a month ago with what happened.</p>
        )}
      </Card>
    </div>
  )
}

function ChurnDialog({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const d = useAsync(() => api.churn.get(userId), [userId])
  const [status, setStatus] = useState<ChurnFollowupStatus | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const r = d.data
  const save = async () => {
    if (!r) return
    setBusy(true)
    try {
      const next = await api.churn.followup(userId, { status: status ?? r.followup.status, note: note ?? r.followup.note ?? '' })
      d.setData((x) => (x ? { ...x, followup: next.followup } : x))
      toast.success('Follow-up saved.')
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const maxScore = 100
  return (
    <Dialog title={r ? r.user.businessName ?? r.user.name : 'Agent or merchant'} description={r ? `${r.user.role === 'agent' ? 'Agent' : 'Merchant'}${r.user.code ? ` ${r.user.code}` : ''} · ${formatMsisdn(r.user.msisdn)}` : undefined}
      onClose={onClose} variant="panel" size="lg">
      {d.error ? <ErrorState error={d.error} onRetry={d.reload} /> : !r ? <Loading /> : (
        <div className="stack">
          <Card title={<>Score {r.score} <Dot tone={BAND_TONE[r.band]}>{CHURN_BAND_LABEL[r.band]}</Dot></>}>
            {r.reasons.length === 0 ? <p className="muted">Nothing unusual in their activity.</p> : (
              <table className="table">
                <caption className="sr-only">Why</caption>
                <thead><tr><th scope="col">Signal</th><th scope="col">What we saw</th><th scope="col">Points</th></tr></thead>
                <tbody>
                  {r.reasons.map((x) => (
                    <tr key={x.feature}><td className="small">{CHURN_FEATURE_INFO[x.feature]}</td><td>{x.detail}</td><td>{x.points}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Activity">
            <dl className="stats">
              <Stat label="Days since last transaction" value={r.activity.daysSinceLast ?? 'Never'} hint={`Active ${r.activity.activeDays28} of the last 28 days`} />
              <Stat label="Transactions a week" value={r.activity.txPerWeekNow} hint={`${r.activity.txPerWeekBefore} in the 6 weeks before`} />
              <Stat label="Money a week" value={formatMoney(r.activity.valuePerWeekNow)} hint={`${formatMoney(r.activity.valuePerWeekBefore)} before`} />
              <Stat label="Customers a week" value={r.activity.customersPerWeekNow} hint={`${r.activity.customersPerWeekBefore} before`} />
              <Stat label={r.user.role === 'agent' ? 'Float' : 'Balance'} value={formatMoney(r.activity.balance)} hint={`With EcoCash ${r.activity.tenureDays} days`} />
            </dl>
          </Card>
          {r.history.length > 1 && (
            <Card title="Score, last 90 days">
              <svg viewBox={`0 0 ${Math.max(1, r.history.length - 1) * 10} 100`} preserveAspectRatio="none" style={{ width: '100%', height: 80 }} role="img"
                aria-label={`Score from ${r.history[0].score} on ${r.history[0].day} to ${r.score} today`}>
                <polyline fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"
                  points={r.history.map((h, i) => `${i * 10},${maxScore - h.score}`).join(' ')} />
              </svg>
              <p className="muted small">{r.history[0].day} to {r.history[r.history.length - 1].day}</p>
            </Card>
          )}
          <Card title="Follow-up">
            <Field label="What happened">
              {(p) => (
                <select {...p} value={status ?? r.followup.status} disabled={!canWrite} onChange={(e) => setStatus(e.target.value as ChurnFollowupStatus)}>
                  {FOLLOWUPS.map((f) => <option key={f} value={f}>{CHURN_FOLLOWUP_LABEL[f]}</option>)}
                </select>
              )}
            </Field>
            <Field label="Note" hint="What they said, what you agreed, when to check again.">
              {(p) => <textarea {...p} rows={3} maxLength={1000} disabled={!canWrite} value={note ?? r.followup.note ?? ''} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {r.followup.at && <div className="muted small">Last updated by {r.followup.by} · <When iso={r.followup.at} /></div>}
            <WriteButton variant="primary" busy={busy} onClick={save}>Save follow-up</WriteButton>
          </Card>
        </div>
      )}
    </Dialog>
  )
}
