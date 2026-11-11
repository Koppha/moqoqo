import { useState } from 'react'
import { RISK_RULE_INFO, type RiskAlert, type RiskAlertStatus, type RiskRule } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { CountTabs, CsvButton, Dot, DotChip, fetchAll, FilterBar, FilterChip, TableCard, Tag, ViewSwitch, When, type Tone } from '../components/dataview'
import { useToast } from '../components/Toast'
import { Card, ErrorState, ListState, Loading, PageHeader, Pagination, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn } from '../format'
import { useAsync } from '../useAsync'

const SEVERITY: { value: RiskAlert['severity']; label: string; tone: Tone }[] = [
  { value: 'high', label: 'High', tone: 'red' },
  { value: 'medium', label: 'Medium', tone: 'orange' },
  { value: 'low', label: 'Low', tone: 'blue' },
]
const SEV_TONE = Object.fromEntries(SEVERITY.map((s) => [s.value, s.tone])) as Record<RiskAlert['severity'], Tone>
const STATUS: { value: RiskAlertStatus; label: string }[] = [
  { value: 'open', label: 'To review' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'ok', label: 'Fine' },
]

export function RiskPage() {
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts')
  return (
    <>
      <PageHeader
        crumbs={['Security', 'Fraud and anomalies', tab === 'alerts' ? 'Alerts' : 'Rules']}
        title={tab === 'alerts' ? 'Risk alerts' : 'Risk rules'}
        subtitle="Fraud and anomaly rules run on every payment. Blocked payments never happen; flagged ones go through and wait for review here."
        views={<ViewSwitch label="View" value={tab} onChange={setTab} options={[{ value: 'alerts', label: 'Alerts' }, { value: 'rules', label: 'Rules' }]} />}
      />
      {tab === 'alerts' ? <Alerts /> : <Rules />}
    </>
  )
}

function Alerts() {
  const toast = useToast()
  const [status, setStatus] = useState<RiskAlertStatus | ''>('open')
  const [severity, setSeverity] = useState<RiskAlert['severity'] | ''>('')
  const [action, setAction] = useState<RiskAlert['action'] | ''>('')
  const [page, setPage] = useState(1)
  const list = useAsync(() => api.risk.alerts({ status, severity, action, page }), [status, severity, action, page])
  const counts = list.data?.counts ?? {}
  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const review = async (a: RiskAlert, s: 'fraud' | 'ok', suspend = false) => {
    if (suspend && !window.confirm(`Suspend ${a.user.name}'s wallet? They are signed out at once.`)) return
    try {
      await api.risk.review(a.id, { status: s, suspend })
      toast.success(s === 'ok' ? 'Marked as fine.' : suspend ? 'Marked as fraud; wallet suspended.' : 'Marked as fraud.')
      list.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <>
      <FilterBar>
        <CountTabs
          label="Review status"
          value={status || 'all'}
          onChange={(v) => pick(setStatus)(v === 'all' ? '' : (v as RiskAlertStatus))}
          options={[...STATUS.map((o) => ({ ...o, count: counts[`status:${o.value}`] ?? 0 })), { value: 'all', label: 'All', count: counts['status:all'] }]}
        />
        {SEVERITY.map((o) => (
          <DotChip
            key={o.value}
            tone={o.tone}
            label={o.label}
            count={counts[`severity:${o.value}`] ?? 0}
            active={severity === o.value}
            onClick={() => pick(setSeverity)(severity === o.value ? '' : o.value)}
          />
        ))}
        <FilterChip
          id="r-action"
          label="Action"
          value={action}
          onChange={pick(setAction)}
          options={[
            { value: 'blocked', label: 'Blocked', count: counts['action:blocked'] ?? 0 },
            { value: 'flagged', label: 'Let through', count: counts['action:flagged'] ?? 0 },
          ]}
        />
      </FilterBar>
      <TableCard
        title={status === 'open' ? 'Alerts to review' : 'Risk alerts'}
        count={list.data?.total}
        unit={['alert', 'alerts']}
        actions={
          <CsvButton
            filename="moqoqo-risk-alerts.csv"
            rows={async () => [
              ['Raised (UTC)', 'Severity', 'Rule', 'Wallet', 'Number', 'What happened', 'Amount (M)', 'Kind', 'Action', 'Review', 'Reviewed by'],
              ...(await fetchAll((p) => api.risk.alerts({ status, severity, action, page: p, pageSize: 100 }))).map((a) => [
                a.createdAt, a.severity, RISK_RULE_INFO[a.rule].title, a.user.name, a.user.msisdn, a.detail, a.amount?.toFixed(2), a.kind,
                a.action, a.status, a.reviewedBy,
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
          emptyTitle={status === 'open' ? 'Nothing to review' : 'No alerts'}
          emptyHint={severity || action ? 'Try another severity or action.' : undefined}
        >
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Risk alerts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Raised ▾</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Rule</th>
                      <th scope="col">Wallet</th>
                      <th scope="col">What happened</th>
                      <th scope="col">Action</th>
                      <th scope="col">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((a) => (
                      <tr key={a.id}>
                        <td><When iso={a.createdAt} /></td>
                        <td><Dot tone={SEV_TONE[a.severity]}>{SEVERITY.find((x) => x.value === a.severity)?.label}</Dot></td>
                        <td><strong>{RISK_RULE_INFO[a.rule].title}</strong></td>
                        <td><div>{a.user.name}</div><div className="muted small nowrap">{formatMsisdn(a.user.msisdn)}</div></td>
                        <td className="cell-message">{a.detail}{a.amount !== null ? <div className="muted small">{formatMoney(a.amount)} · {a.kind}</div> : null}</td>
                        <td>{a.action === 'blocked' ? <Tag tone="red">Blocked</Tag> : <Tag tone="amber">Let through</Tag>}</td>
                        <td>
                          {a.status === 'open' ? (
                            <div className="row-gap">
                              <WriteButton size="sm" onClick={() => review(a, 'ok')}>Fine</WriteButton>
                              <WriteButton size="sm" variant="danger" onClick={() => review(a, 'fraud')}>Fraud</WriteButton>
                              <WriteButton size="sm" variant="danger" onClick={() => review(a, 'fraud', true)}>Fraud + suspend</WriteButton>
                            </div>
                          ) : (
                            <>
                              {a.status === 'fraud' ? <Tag tone="red">Fraud</Tag> : <Tag tone="green">Fine</Tag>}
                              <div className="muted small">{a.reviewedBy}</div>
                            </>
                          )}
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
    </>
  )
}

function Rules() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const current = useAsync(() => api.risk.rules(), [])
  const [v, setV] = useState<RiskRule[] | null>(null)
  const rules = v ?? current.data
  const set = (key: RiskRule['key'], patch: Partial<RiskRule>) => rules && setV(rules.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const save = async () => {
    if (!rules) return
    try {
      current.setData(() => rules)
      await api.risk.setRules(rules)
      setV(null)
      toast.success('Rules saved. They apply to the next payment.')
    } catch (err) {
      toast.error(errorMessage(err))
      current.reload()
    }
  }
  if (current.error) return <ErrorState error={current.error} onRetry={current.reload} />
  if (!rules) return <Loading />
  return (
    <>
      <div className="grid-2">
        {rules.map((r) => (
          <Card key={r.key} title={RISK_RULE_INFO[r.key].title}>
            <p className="muted small">{RISK_RULE_INFO[r.key].detail.replace(/\{(\w+)\}/g, (_, k) => String(r.params[k] ?? '?'))}</p>
            <fieldset className="plain-fieldset" disabled={!canWrite}>
              <legend className="sr-only">{RISK_RULE_INFO[r.key].title}</legend>
              <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => set(r.key, { enabled: e.target.checked })} /> On</label>
              <div className="row-gap" style={{ margin: '8px 0' }}>
                <label className="check"><input type="radio" name={`act-${r.key}`} checked={r.action === 'block'} onChange={() => set(r.key, { action: 'block' })} /> Block the payment</label>
                <label className="check"><input type="radio" name={`act-${r.key}`} checked={r.action === 'flag'} onChange={() => set(r.key, { action: 'flag' })} /> Let it through, flag it</label>
              </div>
              <div className="row-gap">
                {Object.entries(r.params).map(([k, n]) => (
                  <label key={k} className="field" style={{ width: 120 }}>
                    <span className="field-label">{k}</span>
                    <input type="number" min={0} value={n} onChange={(e) => set(r.key, { params: { ...r.params, [k]: Number(e.target.value) } })} />
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>
        ))}
      </div>
      <WriteButton variant="primary" disabled={!v} onClick={save}>Save rules</WriteButton>
      <p className="muted small" style={{ marginTop: 12 }}>
        Free today: these rules. Later the same alerts can come from an open-source engine (Marble, Jube) or an enterprise one (Featurespace, Feedzai).
      </p>
    </>
  )
}
