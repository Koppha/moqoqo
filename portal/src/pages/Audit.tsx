import { useState } from 'react'
import { api } from '../api'
import { Card, ListState, PageHeader, Pagination } from '../components/ui'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

export function AuditPage() {
  const [page, setPage] = useState(1)
  const list = useAsync(() => api.audit(page), [page])
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change made through this portal, newest first." />
      <Card>
        <ListState
          loading={list.loading}
          error={list.error}
          data={list.data}
          onRetry={list.reload}
          isEmpty={(d) => d.items.length === 0}
          emptyTitle="No audit entries yet"
          emptyHint="Admin actions such as scheduling maintenance or suspending a user are recorded here."
        >
          {(d) => (
            <>
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Audit log</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time (Maseru)</th>
                      <th scope="col">Admin</th>
                      <th scope="col">Action</th>
                      <th scope="col">Target</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((a) => (
                      <tr key={a.id}>
                        <td className="nowrap">{formatMaseru(a.createdAt)}</td>
                        <td>{a.adminEmail}</td>
                        <td>
                          <code className="code">{a.action}</code>
                        </td>
                        <td className="mono small">{a.target}</td>
                        <td className="cell-message">{a.detail}</td>
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
