import { useState } from 'react'
import type { AdminUser, Role, UserStatus } from '../../../shared/api'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { ago, CountTabs, CsvButton, Dot, DotChip, fetchAll, FilterBar, FilterChip, SearchBox, TableCard, Tag, When, type Tone } from '../components/dataview'
import { ListState, PageHeader, Pagination, ReadOnlyNotice, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn, ROLE_LABEL } from '../format'
import { useAsync, useDebounced } from '../useAsync'
import { AddUserDialog } from '../users/AddUserDialog'
import { UserPanel } from '../users/UserPanel'

const ROLE_TONE: Record<Role, Tone> = { customer: 'blue', agent: 'green', merchant: 'purple' }
const ROLES: Role[] = ['customer', 'agent', 'merchant']

export function UsersPage() {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [status, setStatus] = useState<UserStatus | ''>('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const q = useDebounced(query.trim(), 300)

  const list = useAsync(() => api.users.list({ query: q, role, status, page }), [q, role, status, page])

  const replace = (u: AdminUser) =>
    list.setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === u.id ? u : x)) } : d))

  const counts = list.data?.counts ?? {}
  const filtered = Boolean(q || role || status)
  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      <PageHeader
        crumbs={['People', 'Wallets', 'Users']}
        title="Users"
        subtitle="Customers, agents and merchants. Select a row to see the wallet, devices and history."
        actions={
          <WriteButton variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add user
          </WriteButton>
        }
      />
      <ReadOnlyNotice />
      <FilterBar>
        <CountTabs
          label="Role"
          value={role || 'all'}
          onChange={(v) => pick(setRole)(v === 'all' ? '' : (v as Role))}
          options={[
            ...ROLES.map((r) => ({ value: r, label: `${ROLE_LABEL[r]}s`, count: counts[`role:${r}`] ?? 0 })),
            { value: 'all', label: 'All', count: counts['role:all'] },
          ]}
        />
        <DotChip tone="green" label="Active" count={counts['status:active'] ?? 0} active={status === 'active'} onClick={() => pick(setStatus)(status === 'active' ? '' : 'active')} />
        <DotChip tone="red" label="Suspended" count={counts['status:suspended'] ?? 0} active={status === 'suspended'} onClick={() => pick(setStatus)(status === 'suspended' ? '' : 'suspended')} />
        <FilterChip
          id="users-role"
          label="Role"
          value={role}
          onChange={pick(setRole)}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], count: counts[`role:${r}`] ?? 0 }))}
        />
        <SearchBox id="users-q" label="Search users" placeholder="Search name, number, code or business…" value={query} onChange={pick(setQuery)} />
      </FilterBar>

      <TableCard
        title="Wallets"
        count={list.data?.total}
        unit={['user', 'users']}
        actions={
          <CsvButton
            filename={`moqoqo-users${role ? `-${role}s` : ''}.csv`}
            rows={async () => [
              ['Name', 'Number', 'Role', 'Code', 'Business', 'Balance (M)', 'KYC tier', 'Status', 'Created (UTC)', 'Last seen (UTC)'],
              ...(await fetchAll((p) => api.users.list({ query: q, role, status, page: p, pageSize: 100 }))).map((u) => [
                u.name, u.msisdn, ROLE_LABEL[u.role], u.code, u.businessName, u.balance.toFixed(2), u.kycTier, u.status, u.createdAt, u.lastSeenAt,
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
          emptyTitle={filtered ? 'No users match these filters' : 'No users yet'}
          emptyHint={filtered ? 'Try a different name, number or filter.' : 'Add an agent or merchant to get started.'}
        >
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table table-hover">
                  <caption className="sr-only">Users</caption>
                  <thead>
                    <tr>
                      <th scope="col">Created ▾</th>
                      <th scope="col">Name</th>
                      <th scope="col">Number</th>
                      <th scope="col">Role</th>
                      <th scope="col">Code / business</th>
                      <th scope="col">KYC</th>
                      <th scope="col" className="num">Balance</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((u) => (
                      <tr key={u.id} onClick={() => setSelected(u)}>
                        <td><When iso={u.createdAt} /></td>
                        <td>
                          <button type="button" className="link-btn" onClick={(e) => (e.stopPropagation(), setSelected(u))}>
                            {u.name}
                          </button>
                        </td>
                        <td className="nowrap">{formatMsisdn(u.msisdn)}</td>
                        <td><Tag tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Tag></td>
                        <td>
                          {u.code && <div className="mono-id">{u.code}</div>}
                          {u.businessName && <div className="muted">{u.businessName}</div>}
                          {!u.code && !u.businessName && <span className="muted">–</span>}
                        </td>
                        <td><Tag tone={u.kycTier === 2 ? 'green' : 'grey'}>Tier {u.kycTier}</Tag></td>
                        <td className="num nowrap"><strong>{formatMoney(u.balance)}</strong></td>
                        <td>{u.status === 'active' ? <Dot tone="green">Active</Dot> : <Dot tone="red">Suspended</Dot>}</td>
                        <td className="nowrap">{u.lastSeenAt ? ago(u.lastSeenAt) : <span className="muted">Never</span>}</td>
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

      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={(u) => {
            setAdding(false)
            list.reload()
            setSelected(u)
          }}
        />
      )}
      {selected && <UserPanel user={selected} onClose={() => setSelected(null)} onChanged={replace} />}
    </>
  )
}
