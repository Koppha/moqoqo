import { useState } from 'react'
import { Link } from 'react-router'
import type { Transaction } from '../../../shared/api'
import { api } from '../api'
import { BarChart, compact, PeriodChip } from '../components/charts'
import { Icon, type IconName } from '../components/Icon'
import { Card, ErrorState, Loading, PageHeader } from '../components/ui'
import { formatMoney } from '../format'
import { useAsync } from '../useAsync'
import { AtmSimulator } from './Atm'
import { Stat } from './Support'
import { KIND_LABEL } from './Transactions'

/** An icon and colour per kind of money movement, so the list reads at a glance. */
const KIND_ICON: Record<Transaction['kind'], { icon: IconName; color: string }> = {
  send: { icon: 'send', color: '#4f46e5' },
  mpho: { icon: 'gift', color: '#db2777' },
  request: { icon: 'swap', color: '#0284c7' },
  bill: { icon: 'file', color: '#ea580c' },
  merchant: { icon: 'store', color: '#7c3aed' },
  tap: { icon: 'coin', color: '#d97706' },
  qr: { icon: 'qr', color: '#7c3aed' },
  cashin: { icon: 'cash', color: '#16a34a' },
  cashout: { icon: 'cash', color: '#dc2626' },
  float: { icon: 'mobile', color: '#2563eb' },
  register: { icon: 'userPlus', color: '#0891b2' },
  ecosure: { icon: 'shield', color: '#ea580c' },
  claim: { icon: 'shield', color: '#16a34a' },
  topup: { icon: 'card', color: '#2563eb' },
  withdraw: { icon: 'bank', color: '#1e3a8a' },
  fee: { icon: 'coin', color: '#1e3a8a' },
  service: { icon: 'share', color: '#7c3aed' },
  atm: { icon: 'atm', color: '#4338ca' },
  atm_refund: { icon: 'refund', color: '#4338ca' },
}

function KindIcon({ kind }: { kind: Transaction['kind'] }) {
  const k = KIND_ICON[kind] ?? { icon: 'swap' as IconName, color: '#6b6e79' }
  return (
    <span className="row-icon" style={{ color: k.color, background: `${k.color}24` }}>
      <Icon name={k.icon} size={17} />
    </span>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const a = useAsync(() => api.analytics(days), [days])
  return (
    <>
      <PageHeader title="Transaction dashboard" subtitle="Overview of recent transactions and services, per Maseru day." />
      {a.error ? <ErrorState error={a.error} onRetry={a.reload} /> : !a.data ? <Loading /> : (() => {
        const d = a.data
        const dayList = d.perDay.map((x) => x.day)
        const tx = d.perDay.reduce((s, x) => s + x.transactions, 0)
        const vol = d.perDay.reduce((s, x) => s + x.volume, 0)
        const peak = Math.max(0, ...d.perDay.map((x) => x.activeUsers))
        return (
          <>
            <div className="grid-2 card-grid">
              <Card title="Transaction volume" icon="bars" tone="purple" actions={<PeriodChip id="period-volume" days={dayList} value={days} onChange={setDays} />}>
                <BarChart days={dayList} values={d.perDay.map((x) => x.transactions)} color="purple" label="Payments per day" />
              </Card>
              <Card title="Transaction value" icon="trend" tone="teal" actions={<PeriodChip id="period-value" days={dayList} value={days} onChange={setDays} />}>
                <BarChart days={dayList} values={d.perDay.map((x) => x.volume)} color="teal" label="Money moved per day, in Maloti" format={(n) => formatMoney(n)} whole={false} />
              </Card>
            </div>

            <div className="grid-2 card-grid">
              <Card title="Transaction summary" icon="layers" tone="blue">
                <ul className="row-list">
                  {d.byKind.map((k) => (
                    <li key={k.kind}>
                      <KindIcon kind={k.kind} />
                      <span className="row-name">{KIND_LABEL[k.kind] ?? k.kind} <span className="count-badge">{k.count}</span></span>
                      <span className="row-value num">{formatMoney(k.volume)}</span>
                    </li>
                  ))}
                  {!d.byKind.length && <li className="muted">No payments in this period.</li>}
                </ul>
              </Card>
              <Card title="Services" icon="settings" tone="blue">
                <ul className="row-list">
                  {d.services.map((s) => (
                    <li key={s.name}>
                      <Link to="/services" className="row-link">
                        <span className="row-icon row-icon-square" style={{ color: '#7c3aed', background: '#7c3aed14' }}><Icon name="mobile" size={16} /></span>
                        <span className="row-name">{s.name} <span className="count-badge">{s.count}</span></span>
                        <span className="row-value num">{formatMoney(s.volume)}</span>
                        <Icon name="chevronRight" size={16} className="row-chevron" />
                      </Link>
                    </li>
                  ))}
                  {!d.services.length && <li className="muted">No services used in this period.</li>}
                </ul>
              </Card>
            </div>

            <AtmSimulator wide />

            <div className="stat-grid">
              <Stat label="Wallets" value={d.users.total.toLocaleString('en')} />
              <Stat label="Most active in a day" value={peak} />
              <Stat label="Payments" value={tx.toLocaleString('en')} />
              <Stat label="Money moved" value={formatMoney(vol)} />
              <Stat label="KYC tier 2" value={`${d.users.byTier.tier2} of ${d.users.total}`} />
              <Stat label="Sign-ups completed" value={`${d.signUps.completed} of ${d.signUps.started}`} />
              <Stat label="ATM cash" value={`${d.atm.count} · ${formatMoney(d.atm.volume)}`} />
              <Stat label="Risk alerts open" value={d.risk.open} />
            </div>

            <div className="grid-2 card-grid">
              <Card title="Active people" icon="users" tone="blue">
                <BarChart days={dayList} values={d.perDay.map((x) => x.activeUsers)} color="purple" label="Active people per day" />
              </Card>
              <Card title="New wallets" icon="userPlus" tone="teal">
                <BarChart days={dayList} values={d.perDay.map((x) => x.newUsers)} color="teal" label="New wallets per day" format={compact} />
              </Card>
              <Card title="People" icon="users">
                <ul className="mini-list">
                  <li><span>Customers</span><span className="num">{d.users.byRole.customer}</span></li>
                  <li><span>Merchants</span><span className="num">{d.users.byRole.merchant}</span></li>
                  <li><span>Agents</span><span className="num">{d.users.byRole.agent}</span></li>
                  <li><span>With a username</span><span className="num">{d.users.usernames}</span></li>
                  <li><span>With a confirmed email</span><span className="num">{d.users.emails}</span></li>
                  <li><span>KYC waiting / approved / rejected</span><span className="num">{d.kyc.pending} / {d.kyc.approved} / {d.kyc.rejected}</span></li>
                </ul>
              </Card>
              <Card title="Notifications" icon="bell">
                <ul className="mini-list">
                  {d.notifications.map((n) => <li key={n.channel}><span>{n.channel.toUpperCase()}</span><span className="num">{n.sent} sent · {n.mock} mock · {n.failed} failed</span></li>)}
                  <li><span>Risk: blocked / flagged in period</span><span className="num">{d.risk.blocked} / {d.risk.flagged}</span></li>
                </ul>
              </Card>
            </div>
          </>
        )
      })()}
    </>
  )
}
