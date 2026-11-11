import { useMemo, useState, type FormEvent } from 'react'
import { LESOTHO_BOUNDS, PLACE_KINDS, type Place, type PlaceBody, type PlaceKind } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { FilterBar, FilterChip, SearchBox, TableCard, Tag, ViewSwitch, type Tone } from '../components/dataview'
import { LocationPicker, PlacesMap } from '../components/PlaceMap'
import { useToast } from '../components/Toast'
import { Button, Field, ListState, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useAsync } from '../useAsync'

export const KIND_LABEL: Record<PlaceKind, string> = { shop: 'Econet shop', agent: 'Agent', merchant: 'Merchant', atm: 'ATM' }
const KIND_TONE: Record<PlaceKind, Tone> = { shop: 'orange', agent: 'blue', merchant: 'purple', atm: 'green' }

/** The dialog's fields as typed (latitude and longitude stay text until saved). */
export interface PlaceValues {
  kind: PlaceKind
  name: string
  address: string
  lat: string
  lng: string
  hours: string
  phone: string
  code: string
  enabled: boolean
}
type PlaceErrors = Partial<Record<'name' | 'address' | 'lat' | 'lng', string>>

const toValues = (p: Place | null): PlaceValues =>
  p
    ? { kind: p.kind, name: p.name, address: p.address, lat: String(p.lat), lng: String(p.lng), hours: p.hours ?? '', phone: p.phone ?? '', code: p.code ?? '', enabled: p.enabled }
    : { kind: 'agent', name: '', address: '', lat: '', lng: '', hours: '', phone: '', code: '', enabled: true }

const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null)

/** Checks the fields; lat/lng must fall inside Lesotho (a swapped pair usually doesn't). The server checks again. */
export function validatePlace(v: PlaceValues): { errors: PlaceErrors; body: PlaceBody | null } {
  const errors: PlaceErrors = {}
  const b = LESOTHO_BOUNDS
  if (!v.name.trim()) errors.name = 'Enter the name people know it by.'
  if (!v.address.trim()) errors.address = 'Enter the street, area and town.'
  const lat = num(v.lat)
  const lng = num(v.lng)
  if (lat === null) errors.lat = 'Enter a latitude, or click the map.'
  else if (lat < b.minLat || lat > b.maxLat) errors.lat = `Outside Lesotho: latitude is between ${b.minLat} and ${b.maxLat} (negative, south).`
  if (lng === null) errors.lng = 'Enter a longitude, or click the map.'
  else if (lng < b.minLng || lng > b.maxLng) errors.lng = `Outside Lesotho: longitude is between ${b.minLng} and ${b.maxLng}.`
  if (Object.keys(errors).length || lat === null || lng === null) return { errors, body: null }
  const opt = (s: string) => s.trim() || undefined
  return {
    errors,
    body: { kind: v.kind, name: v.name.trim(), address: v.address.trim(), lat, lng, hours: opt(v.hours), phone: opt(v.phone), code: opt(v.code), enabled: v.enabled },
  }
}

export function PlacesPage() {
  const list = useAsync(() => api.places.list(), [])
  const [view, setView] = useState<'list' | 'map'>('list')
  const [kind, setKind] = useState<PlaceKind | ''>('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ place: Place | null } | null>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list.data ?? []).filter((p) => (!kind || p.kind === kind) && (!q || p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q)))
  }, [list.data, kind, query])
  const count = (k: PlaceKind) => (list.data ?? []).filter((p) => p.kind === k).length

  return (
    <>
      <PageHeader
        crumbs={['Content', 'Find us']}
        title="Places"
        subtitle="Agents, merchants and ATMs that customers find on the map in the app (Me › Find us). Only places that are on are shown."
        views={<ViewSwitch label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />}
        actions={<WriteButton variant="primary" onClick={() => setEditing({ place: null })}>Add place</WriteButton>}
      />
      <ReadOnlyNotice />
      <FilterBar>
        <FilterChip id="pl-kind" label="Kind" value={kind} onChange={setKind} options={PLACE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], count: count(k) }))} />
        <SearchBox id="pl-search" label="Search places" placeholder="Name or address" value={query} onChange={setQuery} />
      </FilterBar>
      <TableCard title={view === 'list' ? 'All places' : 'On the map'} count={list.data ? shown.length : undefined} unit={['place', 'places']}>
        <ListState
          loading={list.loading}
          error={list.error}
          data={list.data}
          onRetry={list.reload}
          isEmpty={(d) => d.length === 0}
          emptyTitle="No places yet"
          emptyHint="Add the agents, merchants and ATMs customers can visit."
        >
          {() =>
            view === 'map' ? (
              <div className="table-card-body">
                <PlacesMap places={shown} onSelect={(p) => setEditing({ place: p })} />
                <p className="muted small place-legend">
                  <Tag tone="blue">A Agent</Tag> <Tag tone="purple">M Merchant</Tag> <Tag tone="green">ATM</Tag> Faded pins are off. Click a pin to edit it.
                </p>
              </div>
            ) : shown.length === 0 ? (
              <p className="muted table-card-body">No places match. Try another kind or search.</p>
            ) : (
              <div className="table-wrap" aria-busy={list.loading}>
                <table className="table">
                  <caption className="sr-only">Places</caption>
                  <thead>
                    <tr>
                      <th scope="col">Kind</th>
                      <th scope="col">Name</th>
                      <th scope="col">Address</th>
                      <th scope="col">Code</th>
                      <th scope="col">Hours</th>
                      <th scope="col">Shown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.id}>
                        <td><Tag tone={KIND_TONE[p.kind]}>{KIND_LABEL[p.kind]}</Tag></td>
                        <td>
                          <button type="button" className="link-btn" onClick={() => setEditing({ place: p })}>{p.name}</button>
                          {p.phone && <div className="muted small nowrap">{p.phone}</div>}
                        </td>
                        <td className="cell-message">{p.address}</td>
                        <td className="mono">{p.code ?? '—'}</td>
                        <td>{p.hours ?? <span className="muted">—</span>}</td>
                        <td><span className={`chip ${p.enabled ? 'chip-ok' : 'chip-neutral'}`}>{p.enabled ? 'On' : 'Off'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </ListState>
      </TableCard>
      {editing && (
        <PlaceEditor
          place={editing.place}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}

function PlaceEditor({ place, onClose, onSaved }: { place: Place | null; onClose: () => void; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<PlaceValues>(() => toValues(place))
  const [errors, setErrors] = useState<PlaceErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof PlaceValues>(k: K, val: PlaceValues[K]) => setV((s) => ({ ...s, [k]: val }))
  const lat = num(v.lat)
  const lng = num(v.lng)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validatePlace(v)
    setErrors(r.errors)
    if (!r.body) return
    setBusy(true)
    setError(null)
    try {
      if (place) await api.places.update(place.id, r.body)
      else await api.places.create(r.body)
      toast.success(`${r.body.name} saved. The app shows it on the next map refresh${r.body.enabled ? '' : ' (it is off, so hidden)'}.`)
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
        title={place ? `Edit ${place.name}` : 'Add place'}
        onClose={onClose}
        size="lg"
        variant="panel"
        footer={
          <>
            {place && <WriteButton variant="danger" onClick={() => setConfirmDelete(true)}>Delete</WriteButton>}
            <Button onClick={onClose}>Cancel</Button>
            <WriteButton type="submit" form="place-form" variant="primary" busy={busy}>Save</WriteButton>
          </>
        }
      >
        {!canWrite && <ReadOnlyNotice />}
        <form id="place-form" onSubmit={save} noValidate>
          <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
            <legend className="sr-only">Place</legend>
            <div className="grid-2">
              <Field label="Kind">
                {(p) => (
                  <select {...p} value={v.kind} onChange={(e) => set('kind', e.target.value as PlaceKind)}>
                    {PLACE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Name" error={errors.name}>
                {(p) => <input {...p} maxLength={80} value={v.name} onChange={(e) => set('name', e.target.value)} />}
              </Field>
            </div>
            <Field label="Address" hint='As people say it: "Kingsway, next to Pioneer Mall, Maseru"' error={errors.address}>
              {(p) => <input {...p} maxLength={160} value={v.address} onChange={(e) => set('address', e.target.value)} />}
            </Field>
            <h3 className="form-section">Location</h3>
            <p className="muted small">Click the map to drop the pin, drag it, or type the numbers (latitude is negative in Lesotho).</p>
            <LocationPicker
              value={lat !== null && lng !== null ? { lat, lng } : null}
              onPick={(la, ln) => setV((s) => ({ ...s, lat: String(la), lng: String(ln) }))}
            />
            <div className="grid-2">
              <Field label="Latitude" hint="e.g. -29.3151" error={errors.lat}>
                {(p) => <input {...p} inputMode="decimal" value={v.lat} onChange={(e) => set('lat', e.target.value)} />}
              </Field>
              <Field label="Longitude" hint="e.g. 27.4869" error={errors.lng}>
                {(p) => <input {...p} inputMode="decimal" value={v.lng} onChange={(e) => set('lng', e.target.value)} />}
              </Field>
            </div>
            <h3 className="form-section">Details</h3>
            <div className="grid-2">
              <Field label="Opening hours (optional)" hint='e.g. "Mon–Sat 08:00–18:00" or "24 hours"'>
                {(p) => <input {...p} maxLength={80} value={v.hours} onChange={(e) => set('hours', e.target.value)} />}
              </Field>
              <Field label="Phone (optional)">
                {(p) => <input {...p} inputMode="tel" maxLength={20} value={v.phone} onChange={(e) => set('phone', e.target.value)} />}
              </Field>
              <Field label="EcoCash code (optional)" hint="Agent or merchant code, e.g. AGENT-0101 or 1001">
                {(p) => <input {...p} className="mono" maxLength={20} value={v.code} onChange={(e) => set('code', e.target.value)} />}
              </Field>
            </div>
            <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} /> On (shown in the app)</label>
            {error && <p className="form-error" role="alert">{error}</p>}
          </fieldset>
        </form>
      </Dialog>
      {confirmDelete && place && (
        <ConfirmDialog
          title={`Delete ${place.name}?`}
          message="It disappears from the map in the app. To hide it for a while instead, turn it off."
          confirmLabel="Delete place"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.places.remove(place.id)
            toast.success(`${place.name} deleted.`)
            onSaved()
          }}
        />
      )}
    </>
  )
}
