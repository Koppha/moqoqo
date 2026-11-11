import { useState } from 'react'
import type { ApiAreaPerf, PerfFlowKey, PerfPair, Performance } from '../../../shared/api'
import { api } from '../api'
import { BarChart, compact, PeriodChip } from '../components/charts'
import { CsvButton, Dot, TableCard, Tag, ViewSwitch } from '../components/dataview'
import { Icon } from '../components/Icon'
import { Card, ErrorState, Loading, PageHeader } from '../components/ui'
import { formatMoney } from '../format'
import { useAsync } from '../useAsync'
import { KIND_LABEL } from './Transactions'

const FLOW: Record<PerfFlowKey, { title: string; detail: string }> = {
  signup: { title: 'Sign-ups completed', detail: 'Phone sign-ups and new EcoSure profiles that reached the end' },
  atm: { title: 'ATM codes used', detail: 'Cash codes taken out at an ATM, of those used, expired or cancelled' },
  merchant: { title: 'Sale requests paid', detail: 'Merchant and agent requests paid, of those paid, expired or cancelled' },
  requests: { title: 'Money requests paid', detail: 'Requests paid, of those paid, declined or cancelled' },
  kyc: { title: 'KYC approved', detail: 'Tier 2 applications approved, of those decided' },
  claims: { title: 'EcoSure claims approved', detail: 'Claims approved, of those decided' },
  notifications: { title: 'Notifications delivered', detail: 'Push, SMS and email handed over (or recorded while mocked)' },
  risk: { title: 'Payments let through', detail: 'Payments not stopped by a risk rule' },
}

const AREA: Record<string, string> = {
  portal: 'Staff portal',
  assets: 'Images and icons',
  'app-config': 'App start-up',
  auth: 'Sign-in',
  me: 'Profile and settings',
  payments: 'Payments',
  chats: 'Chats',
  ecosure: 'EcoSure',
  onboarding: 'Sign-up',
  services: 'Services',
  atm: 'ATM cash',
  notifications: 'Notifications',
  home: 'Home and offers',
}
const areaName = (a: string) => AREA[a] ?? a.charAt(0).toUpperCase() + a.slice(1).replace(/-/g, ' ')

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`
const ms = (n: number | null) => (n === null ? '–' : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`)

/** Change against the period before: green up, red down (or the other way round when `lowerIsBetter`). */
function Delta({ pair, lowerIsBetter = false }: { pair: PerfPair; lowerIsBetter?: boolean }) {
  const { current, previous } = pair
  if (!previous) return <span className="delta delta-flat">{current ? 'New' : '–'}</span>
  const change = (current - previous) / previous
  if (Math.abs(change) < 0.005) return <span className="delta delta-flat">0%</span>
  const good = change > 0 !== lowerIsBetter
  return (
    <span className={`delta ${good ? 'delta-good' : 'delta-bad'}`} title={`Before: ${previous.toLocaleString('en')}`}>
      {change > 0 ? '▲' : '▼'} {pct(Math.abs(change), Math.abs(change) < 0.1 ? 1 : 0)}
    </span>
  )
}

function Kpi({ label, pair, format = (n) => n.toLocaleString('en') }: { label: string; pair: PerfPair; format?: (n: number) => string }) {
  return (
    <div className="kpi">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{format(pair.current)}</div>
      <div className="kpi-foot">
        <Delta pair={pair} />
        <span className="muted">vs {format(pair.previous)} before</span>
      </div>
    </div>
  )
}

/** ≥ 90% good, ≥ 70% fair, else poor. */
const rating = (rate: number) => (rate >= 0.9 ? 'good' : rate >= 0.7 ? 'fair' : 'poor')

function Flows({ flows }: { flows: Performance['flows'] }) {
  return (
    <ul className="flow-list">
      {flows.map((f) => {
        const rate = f.total ? f.done / f.total : null
        return (
          <li key={f.key}>
            <div className="flow-head">
              <span className="row-name">{FLOW[f.key].title}</span>
              <span className={`flow-rate num ${rate === null ? 'muted' : `rate-${rating(rate)}`}`}>{rate === null ? 'No data' : pct(rate, 1)}</span>
            </div>
            <div className="meter" aria-hidden="true">
              <span className={rate === null ? '' : `rate-${rating(rate)}`} style={{ width: `${(rate ?? 0) * 100}%` }} />
            </div>
            <div className="flow-foot muted">
              <span>{FLOW[f.key].detail}</span>
              <span className="num">{f.done.toLocaleString('en')} of {f.total.toLocaleString('en')}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const change = (p: PerfPair) => (p.previous ? `${(((p.current - p.previous) / p.previous) * 100).toFixed(1)}%` : p.current ? 'new' : '')

function Matrix({ products, days }: { products: Performance['products']; days: number }) {
  return (
    <TableCard
      title="Performance matrix"
      count={products.length}
      unit={['product', 'products']}
      actions={
        <CsvButton
          filename={`moqoqo-performance-${days}d.csv`}
          rows={async () => [
            ['Product', 'Payments', 'Payments before', 'Change', 'Value (M)', 'Value before (M)', 'Change', 'Average (M)', 'People paying', 'Share of value'],
            ...products.map((p) => [
              KIND_LABEL[p.kind] ?? p.kind, p.count.current, p.count.previous, change(p.count), p.volume.current.toFixed(2), p.volume.previous.toFixed(2),
              change(p.volume), p.average.toFixed(2), p.users, pct(p.share, 1),
            ]),
          ]}
        />
      }
    >
      <p className="muted perf-note table-card-body">Each kind of payment in the last {days} days against the {days} days before, largest by value first.</p>
      {!products.length ? <p className="muted table-card-body">No payments in this period or the one before.</p> : (
        <div className="table-wrap">
          <table className="table perf-table">
            <caption className="sr-only">Performance per kind of payment, against the period before</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">Payments</th>
                <th scope="col" className="num">Change</th>
                <th scope="col" className="num">Value ▾</th>
                <th scope="col" className="num">Change</th>
                <th scope="col" className="num">Average</th>
                <th scope="col" className="num">People paying</th>
                <th scope="col">Share of value</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.kind}>
                  <th scope="row" className="perf-product">{KIND_LABEL[p.kind] ?? p.kind}</th>
                  <td className="num">{p.count.current.toLocaleString('en')}</td>
                  <td className="num"><Delta pair={p.count} /></td>
                  <td className="num"><strong>{formatMoney(p.volume.current)}</strong></td>
                  <td className="num"><Delta pair={p.volume} /></td>
                  <td className="num">{formatMoney(p.average)}</td>
                  <td className="num">{p.users.toLocaleString('en')}</td>
                  <td>
                    <div className="share">
                      <div className="meter meter-thin" aria-hidden="true"><span style={{ width: `${p.share * 100}%` }} /></div>
                      <span className="num">{pct(p.share, 1)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  )
}

const errorTone = (rate: number) => (rate <= 0.001 ? 'good' : rate <= 0.01 ? 'fair' : 'poor')

function ApiStats({ api: a }: { api: Performance['api'] }) {
  const errorRate = a.requests ? a.serverErrors / a.requests : 0
  const refusedRate = a.requests ? a.clientErrors / a.requests : 0
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi"><div className="stat-label">Requests</div><div className="stat-value">{compact(a.requests)}</div></div>
        <div className="kpi">
          <div className="stat-label">Server errors (5xx)</div>
          <div className={`stat-value ${a.requests ? `rate-${errorTone(errorRate)}` : ''}`}>{pct(errorRate, 2)}</div>
        </div>
        <div className="kpi"><div className="stat-label">Typical response</div><div className="stat-value">{ms(a.p50Ms)}</div></div>
        <div className="kpi"><div className="stat-label">Slowest 5% take over</div><div className="stat-value">{ms(a.p95Ms)}</div></div>
      </div>
      <p className="muted perf-note" style={{ marginTop: 14 }}>
        <Icon name="info" size={14} /> {pct(refusedRate, 1)} of requests were refused (4xx: wrong PIN, missing details, signed out). Those are normal; a rise can mean an app problem.
      </p>
    </>
  )
}

function ApiAreas({ areas, days }: { areas: ApiAreaPerf[]; days: number }) {
  return (
    <TableCard
      title="API speed and errors by area"
      count={areas.length}
      unit={['area', 'areas']}
      actions={
        <CsvButton
          filename={`moqoqo-api-${days}d.csv`}
          rows={async () => [
            ['Area', 'Requests', 'Refused (4xx)', 'Errors (5xx)', 'Average (ms)', '95% under (ms)'],
            ...areas.map((r) => [areaName(r.area), r.requests, r.clientErrors, r.serverErrors, r.avgMs, r.p95Ms]),
          ]}
        />
      }
    >
      {!areas.length ? <p className="muted table-card-body">No API traffic recorded in this period yet. Counts are saved about once a minute.</p> : (
        <div className="table-wrap">
          <table className="table perf-table">
            <caption className="sr-only">API speed and errors per area</caption>
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Health</th>
                <th scope="col" className="num">Requests ▾</th>
                <th scope="col" className="num">Refused (4xx)</th>
                <th scope="col" className="num">Errors (5xx)</th>
                <th scope="col" className="num">Average</th>
                <th scope="col" className="num">95% under</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((r) => {
                const slow = r.p95Ms !== null && r.p95Ms > 1000
                const health = r.serverErrors / r.requests > 0.01 ? 'poor' : r.serverErrors || slow ? 'fair' : 'good'
                return (
                  <tr key={r.area}>
                    <th scope="row" className="perf-product">{areaName(r.area)}</th>
                    <td>
                      {health === 'good' ? <Dot tone="green">Healthy</Dot> : health === 'fair' ? <Dot tone="amber">{slow ? 'Slow' : 'Some errors'}</Dot> : <Dot tone="red">Failing</Dot>}
                    </td>
                    <td className="num">{r.requests.toLocaleString('en')}</td>
                    <td className="num">{r.clientErrors.toLocaleString('en')} <span className="muted">· {pct(r.clientErrors / r.requests, 1)}</span></td>
                    <td className="num">{r.serverErrors ? <Tag tone="red">{r.serverErrors.toLocaleString('en')}</Tag> : '0'}</td>
                    <td className="num">{ms(r.avgMs)}</td>
                    <td className={`num ${slow ? 'rate-poor' : ''}`}>{ms(r.p95Ms)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  )
}

type View = 'business' | 'system'

export function PerformancePage() {
  const [days, setDays] = useState(30)
  const [view, setView] = useState<View>('business')
  const p = useAsync(() => api.performance(days), [days])
  const dayList = p.data?.api.perDay.map((x) => x.day) ?? []
  return (
    <>
      <PageHeader
        crumbs={['Insights', 'Performance', view === 'business' ? 'Business' : 'System']}
        title={view === 'business' ? 'Business performance' : 'System performance'}
        subtitle={
          view === 'business'
            ? 'Key numbers and every kind of payment against the period before, and how often each flow succeeds.'
            : 'How busy and how fast the EcoCash Super App API is, and where it fails.'
        }
        views={
          <>
            <PeriodChip id="period-performance" days={dayList} value={days} onChange={setDays} />
            <ViewSwitch label="View" value={view} onChange={setView} options={[{ value: 'business', label: 'Business' }, { value: 'system', label: 'System' }]} />
          </>
        }
      />
      {p.error ? <ErrorState error={p.error} onRetry={p.reload} /> : !p.data ? <Loading /> : view === 'business' ? (
        <>
          <Card title="Key numbers" icon="trend" tone="blue">
            <div className="kpi-grid">
              <Kpi label="Payments" pair={p.data.kpis.payments} />
              <Kpi label="Money moved" pair={p.data.kpis.volume} format={formatMoney} />
              <Kpi label="Average payment" pair={p.data.kpis.averagePayment} format={formatMoney} />
              <Kpi label="Fees earned" pair={p.data.kpis.fees} format={formatMoney} />
              <Kpi label="People paying" pair={p.data.kpis.payingUsers} />
              <Kpi label="Active people" pair={p.data.kpis.activeUsers} />
              <Kpi label="New wallets" pair={p.data.kpis.newWallets} />
            </div>
          </Card>
          <Matrix products={p.data.products} days={p.data.days} />
          <Card title="Completion rates" icon="check" tone="teal">
            <Flows flows={p.data.flows} />
          </Card>
        </>
      ) : (
        <>
          <div className="grid-2 card-grid">
            <Card title="API health" icon="clock" tone="blue">
              <ApiStats api={p.data.api} />
            </Card>
            <Card title="API traffic" icon="bars" tone="blue">
              {p.data.api.requests ? (
                <BarChart days={dayList} values={p.data.api.perDay.map((x) => x.requests)} color="purple" label="API requests per day" format={compact} />
              ) : (
                <p className="muted">Nothing recorded yet. Measuring started with this version of the server; counts are saved about once a minute.</p>
              )}
              <p className="muted perf-note">
                Server errors per day:{' '}
                {p.data.api.perDay.some((x) => x.serverErrors)
                  ? p.data.api.perDay.filter((x) => x.serverErrors).map((x) => `${x.day.slice(8)}: ${x.serverErrors}`).join(' · ')
                  : 'none'}
              </p>
            </Card>
          </div>
          <ApiAreas areas={p.data.api.areas} days={p.data.days} />
        </>
      )}
    </>
  )
}
