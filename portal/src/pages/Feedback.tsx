import { useMemo, useState } from 'react'
import { APP_NAMES } from '../../../shared/api'
import { api } from '../api'
import { FilterBar, FilterChip, TableCard, When } from '../components/dataview'
import { ListState, PageHeader } from '../components/ui'
import { formatMsisdn } from '../format'
import { useAsync } from '../useAsync'

type Rating = '1' | '2' | '3' | '4' | '5'
const RATINGS: Rating[] = ['5', '4', '3', '2', '1']

/** "★★★☆☆", read out as "3 of 5 stars". */
function Stars({ n }: { n: number }) {
  return (
    <span className="stars nowrap" role="img" aria-label={`${n} of 5 stars`}>
      {'★'.repeat(n)}
      <span className="stars-off">{'★'.repeat(Math.max(0, 5 - n))}</span>
    </span>
  )
}

/** What people sent from Me › Send feedback in the apps, newest first. Read-only, so support staff see it too. */
export function FeedbackPage() {
  const list = useAsync(() => api.feedback(), [])
  const [rating, setRating] = useState<Rating | ''>('')
  const shown = useMemo(() => (list.data ?? []).filter((f) => !rating || f.rating === Number(rating)), [list.data, rating])
  const count = (r: Rating) => (list.data ?? []).filter((f) => f.rating === Number(r)).length
  const average = list.data?.length ? list.data.reduce((s, f) => s + f.rating, 0) / list.data.length : null

  return (
    <>
      <PageHeader title="Feedback" subtitle="Star ratings and comments people send from the apps (Me › Send feedback), newest first." />
      <FilterBar>
        <FilterChip
          id="fb-rating"
          label="Rating"
          value={rating}
          onChange={setRating}
          options={RATINGS.map((r) => ({ value: r, label: `${r} star${r === '1' ? '' : 's'}`, count: count(r) }))}
        />
        {average !== null && <span className="muted small">Average {average.toFixed(1)} of 5 from {list.data?.length} {list.data?.length === 1 ? 'person' : 'people'}</span>}
      </FilterBar>
      <TableCard title="Feedback" count={list.data ? shown.length : undefined} unit={['response', 'responses']}>
        <ListState
          loading={list.loading}
          error={list.error}
          data={list.data}
          onRetry={list.reload}
          isEmpty={(d) => d.length === 0}
          emptyTitle="No feedback yet"
        >
          {() =>
            shown.length === 0 ? (
              <p className="muted table-card-body">No feedback with this rating.</p>
            ) : (
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Feedback</caption>
                  <thead>
                    <tr>
                      <th scope="col">Sent ▾</th>
                      <th scope="col">Rating</th>
                      <th scope="col">Comment</th>
                      <th scope="col">From</th>
                      <th scope="col">App</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((f) => (
                      <tr key={f.id}>
                        <td><When iso={f.createdAt} /></td>
                        <td><Stars n={f.rating} /></td>
                        <td className="cell-message">{f.text || <span className="muted">No comment</span>}</td>
                        <td><div>{f.user.name}</div><div className="muted small nowrap">{formatMsisdn(f.user.msisdn)}</div></td>
                        <td><div>{APP_NAMES[f.app] ?? f.app}</div><div className="muted small">{f.appVersion ? `Version ${f.appVersion}` : 'Version unknown'}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </ListState>
      </TableCard>
    </>
  )
}
