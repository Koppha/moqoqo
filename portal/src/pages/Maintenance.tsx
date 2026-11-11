import { useState } from 'react'
import type { MaintenanceWindow } from '../../../shared/api'
import { api } from '../api'
import { ConfirmDialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { Card, ListState, MaintenanceChip, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { MaintenanceForm } from '../maintenance/MaintenanceForm'
import { formatDuration, formatMaseru, MASERU_LABEL } from '../time'
import { useAsync } from '../useAsync'
import '../styles/maintenance.css'

type Pending = { kind: 'end' | 'cancel'; w: MaintenanceWindow }

export function MaintenancePage({ clock }: { clock?: () => Date }) {
  const toast = useToast()
  const list = useAsync(() => api.maintenance.list(), [])
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; w: MaintenanceWindow } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const upsert = (w: MaintenanceWindow) =>
    list.setData((xs) => (xs ? (xs.some((x) => x.id === w.id) ? xs.map((x) => (x.id === w.id ? w : x)) : [w, ...xs]) : [w]))

  const current = list.data?.find((w) => w.status === 'active') ?? null

  const runPending = async () => {
    if (!pending) return
    try {
      const w = pending.kind === 'end' ? await api.maintenance.end(pending.w.id) : await api.maintenance.cancel(pending.w.id)
      upsert(w)
      toast.success(pending.kind === 'end' ? 'Maintenance ended. The apps are back to normal.' : 'Scheduled maintenance cancelled.')
      if (editor?.mode === 'edit' && editor.w.id === w.id) setEditor(null)
    } catch (e) {
      toast.error(pending.kind === 'end' ? "Couldn't end maintenance." : "Couldn't cancel maintenance.")
      throw e
    }
  }

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle={
          <>
            Plan downtime. While a window is active the apps show a full-screen maintenance page and no money can move. All times are{' '}
            {MASERU_LABEL}.
          </>
        }
        actions={
          !editor && (
            <WriteButton variant="primary" onClick={() => setEditor({ mode: 'new' })}>
              <Icon name="plus" size={16} /> Schedule maintenance
            </WriteButton>
          )
        }
      />
      <ReadOnlyNotice />

      {current && (
        <div className="banner banner-active" role="status">
          <Icon name="wrench" size={22} />
          <div className="banner-text">
            <strong>Maintenance is ACTIVE until {formatMaseru(current.endsAt)}.</strong>
            <span>Customers and businesses can't send or receive money right now.</span>
          </div>
          <WriteButton variant="danger" size="sm" onClick={() => setPending({ kind: 'end', w: current })}>
            End now
          </WriteButton>
        </div>
      )}

      {editor && (
        <Card title={editor.mode === 'new' ? 'Schedule maintenance' : 'Edit maintenance window'} className="maint-card">
          <MaintenanceForm
            key={editor.mode === 'edit' ? editor.w.id : 'new'}
            editing={editor.mode === 'edit' ? editor.w : undefined}
            clock={clock}
            onCancel={() => setEditor(null)}
            onSaved={(w) => {
              upsert(w)
              setEditor(null)
            }}
          />
        </Card>
      )}

      <Card title="Maintenance windows">
        <ListState
          loading={list.loading}
          error={list.error}
          data={list.data}
          onRetry={list.reload}
          isEmpty={(d) => d.length === 0}
          emptyTitle="No maintenance windows yet"
          emptyHint="Scheduled, active and past windows will appear here."
        >
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Maintenance windows, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Window (Maseru)</th>
                    <th scope="col">Message (English)</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <MaintenanceChip status={w.status} />
                      </td>
                      <td className="nowrap">
                        <div>{formatMaseru(w.startsAt)}</div>
                        <div className="muted">
                          to {formatMaseru(w.endsAt)} · {formatDuration(Date.parse(w.endsAt) - Date.parse(w.startsAt))}
                        </div>
                      </td>
                      <td className="cell-message">
                        <span title={w.message.en}>{w.message.en}</span>
                      </td>
                      <td>
                        <div>{w.createdBy}</div>
                        <div className="muted nowrap">{formatMaseru(w.createdAt)}</div>
                      </td>
                      <td className="cell-actions">
                        {(w.status === 'scheduled' || w.status === 'active') && (
                          <WriteButton size="sm" onClick={() => setEditor({ mode: 'edit', w })} aria-label={`Edit window starting ${formatMaseru(w.startsAt)}`}>
                            Edit
                          </WriteButton>
                        )}
                        {w.status === 'active' && (
                          <WriteButton size="sm" variant="danger" onClick={() => setPending({ kind: 'end', w })}>
                            End now
                          </WriteButton>
                        )}
                        {w.status === 'scheduled' && (
                          <WriteButton
                            size="sm"
                            variant="danger"
                            onClick={() => setPending({ kind: 'cancel', w })}
                            aria-label={`Cancel window starting ${formatMaseru(w.startsAt)}`}
                          >
                            Cancel
                          </WriteButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ListState>
      </Card>

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'end' ? 'End maintenance now?' : 'Cancel this maintenance window?'}
          message={
            pending.kind === 'end'
              ? 'The apps will leave the maintenance screen and money will start moving again straight away.'
              : `The window planned for ${formatMaseru(pending.w.startsAt)} will not happen. Users will no longer see the advance notice.`
          }
          confirmLabel={pending.kind === 'end' ? 'End maintenance now' : 'Cancel window'}
          danger
          onConfirm={runPending}
          onClose={() => setPending(null)}
        />
      )}
    </>
  )
}
