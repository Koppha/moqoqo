import { useState } from 'react'
import { Link } from 'react-router'
import { AI_MODEL_INFO, SCORE_FEATURE_INFO, type AiDecision, type AiModel, type AiModelKey, type AiModelMode, type AiOutcome, type ScoreReason } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { CountTabs, FilterBar, FilterChip, TableCard, Tag, ViewSwitch, When, type Tone } from '../components/dataview'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorState, Field, ListState, Loading, PageHeader, Pagination, Segmented, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

const MODE_LABEL: Record<AiModelMode, string> = { off: 'Off', shadow: 'Shadow (log only)', active: 'Active' }
const MODE_TONE: Record<AiModelMode, Tone> = { off: 'grey', shadow: 'blue', active: 'green' }
const OUTCOME: Record<AiOutcome, { label: string; tone: Tone }> = {
  allow: { label: 'Let through', tone: 'green' },
  flag: { label: 'Flagged', tone: 'amber' },
  block: { label: 'Blocked', tone: 'red' },
  info: { label: 'Written', tone: 'blue' },
}
const KIND_LABEL = { scoring: 'Explainable score', rules: 'Scenario rules', llm: 'Large language model' } as const

export function AiGovernancePage() {
  const [tab, setTab] = useState<'models' | 'decisions'>('models')
  return (
    <>
      <PageHeader
        crumbs={['Security', 'AI governance', tab === 'models' ? 'Models' : 'Decision log']}
        title={tab === 'models' ? 'AI models' : 'AI decision log'}
        subtitle="Every automated model: what it may decide, the data it uses, who oversees it, and how often staff agree with it. Each change is versioned and in the audit log."
        views={<ViewSwitch label="View" value={tab} onChange={setTab} options={[{ value: 'models', label: 'Models' }, { value: 'decisions', label: 'Decision log' }]} />}
      />
      {tab === 'models' ? <Models /> : <Decisions />}
    </>
  )
}

function Models() {
  const models = useAsync(() => api.ai.models(), [])
  if (models.error) return <ErrorState error={models.error} onRetry={models.reload} />
  if (!models.data) return <Loading />
  return (
    <div className="stack">
      {models.data.map((m) => <ModelCard key={m.key} m={m} onSaved={(next) => models.setData((all) => all!.map((x) => (x.key === next.key ? next : x)))} />)}
    </div>
  )
}

const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`)

function ModelCard({ m, onSaved }: { m: AiModel; onSaved: (m: AiModel) => void }) {
  const info = AI_MODEL_INFO[m.key]
  const { canWrite } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState<AiModelMode>(m.mode)
  const [params, setParams] = useState(m.params)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(false)
  const versions = useAsync(() => (history && info.modes.length ? api.ai.versions(m.key) : Promise.resolve(null)), [history, m.version])
  const dirty = mode !== m.mode || Object.entries(params).some(([k, v]) => m.params[k] !== v)
  const save = async () => {
    setBusy(true)
    try {
      const next = await api.ai.setModel(m.key, { mode, params, note })
      onSaved(next)
      setNote('')
      toast.success(`${info.title}: version ${next.version} saved.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const s = m.stats
  const drift = s.avgScore.lastWeek != null && s.avgScore.before != null && Math.abs(s.avgScore.lastWeek - s.avgScore.before) >= 10
  const maxBucket = Math.max(1, ...s.scoreBuckets)
  return (
    <Card
      title={info.title}
      icon={info.kind === 'llm' ? 'info' : 'shield'}
      actions={
        <div className="row-gap">
          <Tag tone={MODE_TONE[m.mode]}>{MODE_LABEL[m.mode]}</Tag>
          {!m.available && <Tag tone="red">Not available</Tag>}
          <span className="muted small">{KIND_LABEL[info.kind]} · {m.provider} · v{m.version}</span>
        </div>
      }
    >
      <p>{info.purpose}</p>
      <dl className="model-facts">
        <dt>Decides</dt><dd>{info.decides}</dd>
        <dt>Human oversight</dt><dd>{info.humanOversight}</dd>
        <dt>Data used</dt><dd>{info.dataUsed}</dd>
        <dt>Limits</dt><dd>{info.limitations}</dd>
        {m.changedAt && <><dt>Last change</dt><dd>v{m.version} by {m.changedBy} · {formatMaseru(m.changedAt)}{m.note ? ` · “${m.note}”` : ''}</dd></>}
      </dl>

      <dl className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><dt className="stat-label">Decisions (30 days)</dt><dd className="stat-value">{s.decisions}</dd>
          {info.kind !== 'llm' && <dd className="stat-hint">{s.byOutcome.flag} flagged · {s.byOutcome.block} blocked</dd>}</div>
        {m.key === 'churn_risk' ? (
          <div className="stat"><dt className="stat-label">Track record</dt><dd className="stat-value small"><Link to="/retention">In Retention</Link></dd>
            <dd className="stat-hint">How many it called high risk went quiet</dd></div>
        ) : (
          <div className="stat"><dt className="stat-label">Confirmed by staff</dt><dd className="stat-value">{pct(s.precision)}</dd>
            <dd className="stat-hint">{s.confirmedFraud} fraud · {s.falsePositives} false alarms</dd></div>
        )}
        {info.kind === 'scoring' && (
          <div className="stat"><dt className="stat-label">Average score</dt><dd className="stat-value">{s.avgScore.lastWeek ?? '–'}</dd>
            <dd className="stat-hint">{s.avgScore.before == null ? 'last 7 days' : `3 weeks before: ${s.avgScore.before}`}{drift ? ' · shifted, check for drift' : ''}</dd></div>
        )}
      </dl>
      {info.kind === 'scoring' && s.decisions > 0 && (
        <figure className="histogram" aria-label="Scores in the last 30 days, in steps of 10">
          {s.scoreBuckets.map((n, i) => (
            <div key={i} className="histogram-col" title={`${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${n}`}>
              <div className={`histogram-bar ${i * 10 >= (m.params.flagAt ?? 101) ? 'over' : ''}`} style={{ height: `${Math.max(2, (n / maxBucket) * 100)}%` }} />
              <span className="histogram-label">{i * 10}</span>
            </div>
          ))}
        </figure>
      )}

      {info.modes.length > 0 && (
        <fieldset className="plain-fieldset model-edit" disabled={!canWrite || busy}>
          <legend className="sr-only">Change {info.title}</legend>
          <Segmented label="Mode" name={`mode-${m.key}`} value={mode} onChange={setMode} options={info.modes.map((v) => ({ value: v, label: MODE_LABEL[v] }))} />
          {Object.keys(info.params).length > 0 && (
            <div className="row-gap" style={{ alignItems: 'flex-start' }}>
              {Object.entries(info.params).map(([k, p]) => (
                <Field key={k} label={p.label} hint={p.hint} className="field-narrow">
                  {(props) => <input {...props} type="number" min={p.min} max={p.max} step={p.step ?? 1} value={params[k] ?? ''} onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })} />}
                </Field>
              ))}
            </div>
          )}
          {dirty && (
            <Field label="Why are you changing it?" hint="Kept with the version and in the audit log.">
              {(props) => <input {...props} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Too many false alarms on cash-outs" />}
            </Field>
          )}
          <div className="row-gap">
            <WriteButton variant="primary" disabled={!dirty || note.trim().length < 3} busy={busy} onClick={save}>Save as version {m.version + 1}</WriteButton>
            {dirty && <Button onClick={() => { setMode(m.mode); setParams(m.params); setNote('') }}>Undo</Button>}
            <Button onClick={() => setHistory((h) => !h)}>{history ? 'Hide versions' : 'Versions'}</Button>
          </div>
          {info.modes.includes('shadow') && <p className="muted small">Try a change in Shadow first: it scores and logs without flagging or blocking anyone.</p>}
        </fieldset>
      )}
      {history && versions.data && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <caption className="sr-only">Versions of {info.title}</caption>
            <thead><tr><th scope="col">Version</th><th scope="col">Mode</th><th scope="col">Settings</th><th scope="col">Who</th><th scope="col">Why</th></tr></thead>
            <tbody>
              {versions.data.map((v) => (
                <tr key={v.version}>
                  <td>v{v.version}<div className="muted small">{formatMaseru(v.changedAt)}</div></td>
                  <td><Tag tone={MODE_TONE[v.mode]}>{MODE_LABEL[v.mode]}</Tag></td>
                  <td className="small">{Object.entries(v.params).map(([k, n]) => `${info.params[k]?.label ?? k}: ${n}`).join(' · ') || '–'}</td>
                  <td className="small">{v.changedBy}</td>
                  <td className="small">{v.note}</td>
                </tr>
              ))}
              {versions.data.length === 0 && <tr><td colSpan={5} className="muted">Never changed: running the built-in defaults (version 0).</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

const reasonTitle = (r: ScoreReason) => (r.feature in SCORE_FEATURE_INFO ? SCORE_FEATURE_INFO[r.feature as keyof typeof SCORE_FEATURE_INFO].title : null)

function Decisions() {
  const [model, setModel] = useState<AiModelKey | ''>('fraud_score')
  const [outcome, setOutcome] = useState<AiOutcome | ''>('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const list = useAsync(() => api.ai.decisions({ model, outcome, page }), [model, outcome, page])
  const counts = list.data?.counts ?? {}
  return (
    <>
      <FilterBar>
        <CountTabs
          label="Model"
          value={model || 'all'}
          onChange={(v) => { setModel(v === 'all' ? '' : (v as AiModelKey)); setPage(1) }}
          options={[
            ...(['fraud_score', 'aml_surveillance', 'case_summary'] as AiModelKey[]).map((k) => ({ value: k, label: AI_MODEL_INFO[k].title, count: counts[`model:${k}`] ?? 0 })),
            { value: 'all', label: 'All', count: counts['model:all'] },
          ]}
        />
        <FilterChip
          id="d-outcome"
          label="Outcome"
          value={outcome}
          onChange={(v) => { setOutcome(v); setPage(1) }}
          options={(Object.keys(OUTCOME) as AiOutcome[]).map((o) => ({ value: o, label: OUTCOME[o].label, count: counts[`outcome:${o}`] ?? 0 }))}
        />
      </FilterBar>
      <TableCard title="Decisions" count={list.data?.total} unit={['decision', 'decisions']}>
        <ListState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} isEmpty={(d) => d.items.length === 0} emptyTitle="No decisions yet">
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">AI decisions with their reasons</caption>
                  <thead><tr><th scope="col">When</th><th scope="col">Model</th><th scope="col">Wallet</th><th scope="col">Score</th><th scope="col">Outcome</th><th scope="col">Why</th><th scope="col">Staff found</th></tr></thead>
                  <tbody>
                    {d.items.map((x: AiDecision) => (
                      <tr key={x.id}>
                        <td><When iso={x.createdAt} />{x.transactionRef && <div className="muted small">{x.transactionRef}</div>}</td>
                        <td className="small">{AI_MODEL_INFO[x.model].title}<div className="muted">v{x.version}</div></td>
                        <td>{x.user ? <><div>{x.user.name}</div><div className="muted small nowrap">{formatMsisdn(x.user.msisdn)}</div></> : '–'}</td>
                        <td>{x.score ?? '–'}{x.amount != null && <div className="muted small nowrap">{formatMoney(x.amount)}{x.kind ? ` · ${x.kind}` : ''}</div>}</td>
                        <td><Tag tone={OUTCOME[x.outcome].tone}>{OUTCOME[x.outcome].label}</Tag>{x.shadow && <div><Tag tone="blue">Shadow</Tag></div>}</td>
                        <td className="cell-message">
                          {x.reasons.length > 0 ? (
                            <>
                              <button type="button" className="link-button" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>
                                {x.reasons.length} reason{x.reasons.length === 1 ? '' : 's'}
                              </button>
                              {open === x.id ? (
                                <ul className="reasons">
                                  {x.reasons.map((r, i) => (
                                    <li key={i}>{r.points > 0 && <strong>+{r.points} </strong>}{reasonTitle(r) && <span>{reasonTitle(r)}: </span>}{r.detail}</li>
                                  ))}
                                </ul>
                              ) : <div className="small muted">{x.summary}</div>}
                            </>
                          ) : <span className="small">{x.summary || '–'}</span>}
                        </td>
                        <td>{x.review === 'fraud' ? <Tag tone="red">Fraud</Tag> : x.review === 'ok' ? <Tag tone="green">Fine</Tag> : <span className="muted small">Not reviewed</span>}</td>
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
