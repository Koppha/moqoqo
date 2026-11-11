import { Link } from 'react-router'
import type { AdminStats, Maintenance } from '../../../shared/api'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { ErrorState, Loading, PageHeader } from '../components/ui'
import { formatCount, formatMoney } from '../format'
import { formatMaseru, MASERU_LABEL } from '../time'
import { useAsync } from '../useAsync'

export function MaintenanceBanner({ maintenance }: { maintenance: Maintenance | null }) {
  if (!maintenance) {
    return (
      <div className="banner banner-ok">
        <Icon name="check" size={22} />
        <div className="banner-text">
          <strong>No maintenance scheduled.</strong>
          <span>Customers and businesses can send and receive money normally.</span>
        </div>
        <Link to="/maintenance" className="btn btn-secondary btn-sm">
          Schedule maintenance
        </Link>
      </div>
    )
  }
  if (maintenance.active) {
    return (
      <div className="banner banner-active" role="status">
        <Icon name="wrench" size={22} />
        <div className="banner-text">
          <strong>Maintenance is ACTIVE until {formatMaseru(maintenance.endsAt)}.</strong>
          <span>The apps show the maintenance screen; money can't move until it ends.</span>
        </div>
        <Link to="/maintenance" className="btn btn-secondary btn-sm">
          Manage maintenance
        </Link>
      </div>
    )
  }
  return (
    <div className="banner banner-scheduled">
      <Icon name="clock" size={22} />
      <div className="banner-text">
        <strong>Maintenance scheduled for {formatMaseru(maintenance.startsAt)}</strong>
        <span>Until {formatMaseru(maintenance.endsAt)} ({MASERU_LABEL}).</span>
      </div>
      <Link to="/maintenance" className="btn btn-secondary btn-sm">
        View maintenance
      </Link>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat card">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
      {hint && <dd className="stat-hint">{hint}</dd>}
    </div>
  )
}

function StatsGrid({ stats }: { stats: AdminStats }) {
  const totalUsers = stats.users.customer + stats.users.agent + stats.users.merchant
  return (
    <>
      <h2 className="section-title">Accounts</h2>
      <dl className="stats">
        <Stat label="Customers" value={formatCount(stats.users.customer)} />
        <Stat label="Agents" value={formatCount(stats.users.agent)} />
        <Stat label="Merchants" value={formatCount(stats.users.merchant)} />
        <Stat label="Suspended" value={formatCount(stats.suspended)} hint={`of ${formatCount(totalUsers)} accounts`} />
      </dl>
      <h2 className="section-title">Today (Maseru)</h2>
      <dl className="stats">
        <Stat label="Transactions" value={formatCount(stats.today.transactions)} />
        <Stat label="Volume" value={formatMoney(stats.today.volume)} />
        <Stat label="Messages" value={formatCount(stats.today.messages)} />
        <Stat label="New users" value={formatCount(stats.today.newUsers)} />
      </dl>
    </>
  )
}

export function DashboardPage() {
  const { data, error, loading, reload } = useAsync(() => api.stats(), [])
  return (
    <>
      <PageHeader title="Dashboard" subtitle="EcoCash Super App at a glance." />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        loading && <Loading label="Loading stats…" />
      ) : (
        <>
          <MaintenanceBanner maintenance={data.maintenance} />
          <StatsGrid stats={data} />
        </>
      )}
    </>
  )
}
