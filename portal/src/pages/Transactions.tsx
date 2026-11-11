import { useState } from 'react'
import type { PublicUser, Transaction } from '../../../shared/api'
import { api } from '../api'
import { CountTabs, CsvButton, fetchAll, FilterBar, FilterChip, SearchBox, TableCard, Tag, When, type Tone } from '../components/dataview'
import { ListState, PageHeader, Pagination } from '../components/ui'
import { formatMoney, formatMsisdn } from '../format'
import { useAsync, useDebounced } from '../useAsync'

type Kind = Transaction['kind']

export const KIND_LABEL: Record<Kind, string> = {
  send: 'Send',
  mpho: 'Mpho (gift)',
  request: 'Request paid',
  bill: 'Bill',
  merchant: 'Merchant sale',
  tap: 'Tap to pay',
  qr: 'QR / code payment',
  cashin: 'Cash-in',
  cashout: 'Cash-out',
  float: 'Float top-up',
  register: 'Registration',
  ecosure: 'EcoSure premium',
  claim: 'EcoSure payout',
  topup: 'Card top-up',
  withdraw: 'Bank transfer',
  fee: 'Fee',
  service: 'Service (other network, airtime, bundle)',
  atm: 'ATM withdrawal',
  atm_refund: 'ATM money back',
}

/** Money in (green), out to cash or banks (red), payments (blue), sales (purple), bills and services (orange). */
const KIND_TONE: Record<Kind, Tone> = {
  send: 'blue', mpho: 'blue', request: 'blue', tap: 'blue', qr: 'blue',
  merchant: 'purple', bill: 'orange', service: 'orange', topup: 'orange', ecosure: 'amber',
  cashin: 'green', claim: 'green', atm_refund: 'green',
  cashout: 'red', atm: 'red', withdraw: 'red',
  float: 'grey', register: 'grey', fee: 'grey',
}

const PERIODS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
] as const
type Period = (typeof PERIODS)[number]['value']

function Party({ p }: { p: PublicUser | null }) {
  if (!p) return <span className="muted">System</span>
  return (
    <>
      <div>{p.businessName ?? p.name}</div>
      <div className="muted small nowrap">{formatMsisdn(p.msisdn)}</div>
    </>
  )
}

const party = (p: PublicUser | null) => (p ? `${p.businessName ?? p.name} (${p.msisdn})` : 'System')

export function TransactionsPage() {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind | ''>('')
  const [period, setPeriod] = useState<Period | ''>('')
  const [page, setPage] = useState(1)
  const q = useDebounced(query.trim(), 300)
  const days = period ? Number(period) : ''
  const list = useAsync(() => api.transactions({ query: q, kind, days, page }), [q, kind, days, page])
  const counts = list.data?.counts ?? {}
  // The four busiest kinds as tabs; every kind is in the Kind chip.
  const top = (Object.keys(KIND_LABEL) as Kind[])
    .filter((k) => counts[`kind:${k}`])
    .sort((a, b) => counts[`kind:${b}`] - counts[`kind:${a}`])
    .slice(0, 4)
  if (kind && !top.includes(kind)) top.push(kind)
  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      <PageHeader crumbs={['Money', 'Ledger', 'Transactions']} title="Transactions" subtitle="Every money movement, newest first. Read-only." />
      <FilterBar>
        <CountTabs
          label="Kind"
          value={kind || 'all'}
          onChange={(v) => pick(setKind)(v === 'all' ? '' : (v as Kind))}
          options={[...top.map((k) => ({ value: k, label: KIND_LABEL[k], count: counts[`kind:${k}`] ?? 0 })), { value: 'all', label: 'All', count: counts['kind:all'] }]}
        />
        <FilterChip
          id="tx-kind"
          label="Kind"
          value={kind}
          onChange={pick(setKind)}
          options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k], count: counts[`kind:${k}`] ?? 0 }))}
        />
        <FilterChip id="tx-period" label="Period" value={period} onChange={pick(setPeriod)} options={PERIODS} allLabel="All time" />
        <SearchBox id="tx-q" label="Search transactions" placeholder="Search reference, name or number…" value={query} onChange={pick(setQuery)} />
      </FilterBar>
      <TableCard
        title="Transactions"
        count={list.data?.total}
        unit={['transaction', 'transactions']}
        actions={
          <CsvButton
            filename={`moqoqo-transactions${kind ? `-${kind}` : ''}.csv`}
            rows={async () => [
              ['Time (UTC)', 'Reference', 'Kind', 'From', 'To', 'Amount (M)', 'Description'],
              ...(await fetchAll((p) => api.transactions({ query: q, kind, days, page: p, pageSize: 100 }))).map((t) => [
                t.createdAt, t.reference, KIND_LABEL[t.kind] ?? t.kind, party(t.from), party(t.to), t.amount.toFixed(2), t.description,
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
          emptyTitle={q || kind || period ? 'No transactions match' : 'No transactions yet'}
          emptyHint={q || kind || period ? 'Try another reference, number, kind or period.' : undefined}
        >
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Transactions</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time ▾</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Kind</th>
                      <th scope="col">From</th>
                      <th scope="col">To</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((t) => (
                      <tr key={t.id}>
                        <td><When iso={t.createdAt} /></td>
                        <td className="mono-id nowrap">{t.reference}</td>
                        <td><Tag tone={KIND_TONE[t.kind] ?? 'grey'}>{(KIND_LABEL[t.kind] ?? t.kind).replace(/ \(.*\)$/, '')}</Tag></td>
                        <td><Party p={t.from} /></td>
                        <td><Party p={t.to} /></td>
                        <td className="num nowrap"><strong>{formatMoney(t.amount)}</strong></td>
                        <td className="cell-message">{t.description}</td>
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
