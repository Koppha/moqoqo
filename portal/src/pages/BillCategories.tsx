import { useState, type FormEvent } from 'react'
import type { BillCategory, BillCategoryBody, ServiceDef } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Card, Field, ListState, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useAsync } from '../useAsync'

const blank = (sort: number): BillCategoryBody => ({ id: '', name: { en: '', st: '' }, icon: 'receipt', color: '#0F766E', sort, enabled: true })

/**
 * Services › Pay bill categories: the groups customers see under Pay bill (Econet, LEC, MultiChoice, WASCO, Insurance,
 * Financial, Utility, …). The billers in each are services with that category (Services › Edit › Pay bill category).
 */
export function BillCategoryList() {
  const cats = useAsync(() => api.billCategories.list(), [])
  const services = useAsync(() => api.services.list(), [])
  const [editing, setEditing] = useState<{ cat: BillCategory | null } | null>(null)
  const billersIn = (id: string): ServiceDef[] => (services.data ?? []).filter((s) => s.category === id)
  const nextSort = Math.max(0, ...(cats.data ?? []).map((c) => c.sort)) + 10

  return (
    <Card actions={<WriteButton variant="primary" onClick={() => setEditing({ cat: null })}>New category</WriteButton>}>
      <p className="muted small">The order here is the order in the app. Put a biller in a category from its service (Pay bill category); a category with one biller opens it directly.</p>
      <ListState loading={cats.loading} error={cats.error} data={cats.data} onRetry={cats.reload} isEmpty={(d) => d.length === 0} emptyTitle="No categories yet">
        {(d) => (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Pay bill categories</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Billers</th>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {d.map((c) => (
                  <tr key={c.id}>
                    <td><span className="swatch" style={{ background: c.color }} /> <strong>{c.name.en}</strong> <span className="muted small mono">{c.id}</span></td>
                    <td className="small">{billersIn(c.id).map((s) => s.name.en).join(', ') || <span className="muted">None yet</span>}</td>
                    <td>{c.sort}</td>
                    <td><span className={`chip ${c.enabled ? 'chip-ok' : 'chip-neutral'}`}>{c.enabled ? 'On' : 'Off'}</span></td>
                    <td><Button size="sm" onClick={() => setEditing({ cat: c })}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListState>
      {editing && (
        <CategoryEditor cat={editing.cat} sort={nextSort} billers={editing.cat ? billersIn(editing.cat.id).length : 0}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); cats.reload() }} />
      )}
    </Card>
  )
}

function CategoryEditor({ cat, sort, billers, onClose, onSaved }: { cat: BillCategory | null; sort: number; billers: number; onClose: () => void; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<BillCategoryBody>(() => (cat ? { ...cat } : blank(sort)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof BillCategoryBody>(k: K, val: BillCategoryBody[K]) => setV((s) => ({ ...s, [k]: val }))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    if (!cat && !/^[a-z][a-z0-9-]{1,30}$/.test(v.id)) return setError('The id is lowercase letters, digits and -, like "insurance".')
    if (!v.name.en.trim() || !v.name.st.trim()) return setError('Write the name in English and Sesotho.')
    setBusy(true)
    setError(null)
    try {
      if (cat) {
        const { id: _, ...body } = v
        await api.billCategories.update(cat.id, body)
      } else await api.billCategories.create(v)
      toast.success(`${v.name.en} saved.`)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        title={cat ? `Edit ${cat.name.en}` : 'New Pay bill category'}
        onClose={onClose}
        footer={
          <>
            {cat && <WriteButton variant="danger" onClick={() => setConfirmDelete(true)}>Delete</WriteButton>}
            <Button onClick={onClose}>Cancel</Button>
            <WriteButton type="submit" form="billcat-form" variant="primary" busy={busy}>Save</WriteButton>
          </>
        }
      >
        {!canWrite && <ReadOnlyNotice />}
        <form id="billcat-form" onSubmit={save} noValidate>
          <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
            <legend className="sr-only">Category</legend>
            {!cat && (
              <Field label="Id" hint='Fixed once made: lowercase, like "schools"'>
                {(p) => <input {...p} className="mono" maxLength={31} value={v.id} onChange={(e) => set('id', e.target.value.toLowerCase().trim())} />}
              </Field>
            )}
            <div className="grid-2">
              <Field label="Name (English)">{(p) => <input {...p} maxLength={40} value={v.name.en} onChange={(e) => set('name', { ...v.name, en: e.target.value })} />}</Field>
              <Field label="Name (Sesotho)">{(p) => <input {...p} lang="st" maxLength={40} value={v.name.st} onChange={(e) => set('name', { ...v.name, st: e.target.value })} />}</Field>
              <Field label="Icon (Ionicons name)" hint="e.g. flash, water, tv, shield-checkmark">{(p) => <input {...p} value={v.icon} onChange={(e) => set('icon', e.target.value.trim())} />}</Field>
              <Field label="Colour">{(p) => <input {...p} type="color" value={v.color} onChange={(e) => set('color', e.target.value.toUpperCase())} />}</Field>
              <Field label="Order (lower first)">{(p) => <input {...p} type="number" value={v.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} />}</Field>
            </div>
            <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} /> On (shown under Pay bill)</label>
            {error && <p className="form-error" role="alert">{error}</p>}
          </fieldset>
        </form>
      </Dialog>
      {confirmDelete && cat && (
        <ConfirmDialog
          title={`Delete ${cat.name.en}?`}
          message={billers > 0
            ? `${billers} biller${billers === 1 ? ' is' : 's are'} still in it: move them to another category or remove them first (or turn the category off).`
            : 'It disappears from Pay bill. To hide it for a while instead, turn it off.'}
          confirmLabel="Delete category"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.billCategories.remove(cat.id)
            toast.success(`${cat.name.en} deleted.`)
            onSaved()
          }}
        />
      )}
    </>
  )
}
