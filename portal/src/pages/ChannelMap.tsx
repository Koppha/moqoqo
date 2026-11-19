import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CHURN_BAND_LABEL, LESOTHO_BOUNDS, type ChannelUser, type ChurnBand } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { CountTabs, Dot, FilterBar, FilterChip, SearchBox, TableCard, Tag, When, type Tone } from '../components/dataview'
import { ChannelMapView, LocationPicker, type ChannelColour } from '../components/PlaceMap'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, Segmented, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn } from '../format'
import { useAsync } from '../useAsync'

const BAND_TONE: Record<ChurnBand, Tone> = { high: 'red', medium: 'orange', low: 'green', quiet: 'grey' }
const BANDS: ChurnBand[] = ['high', 'medium', 'quiet', 'low']
const nameOf = (u: ChannelUser) => u.user.businessName ?? u.user.name

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="stat">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
      {hint && <dd className="stat-hint">{hint}</dd>}
    </div>
  )
}

/**
 * Channel map: every agent and merchant on one staff map, coloured by churn risk, so staff see where the channel is
 * thin or slipping. Pins come from a location set here, else the wallet's Find us place.
 */
export function ChannelMapPage() {
  const data = useAsync(() => api.channelMap.get(), [])
  const [role, setRole] = useState<'agent' | 'merchant' | ''>('')
  const [band, setBand] = useState<ChurnBand | ''>('')
  const [query, setQuery] = useState('')
  const [colour, setColour] = useState<ChannelColour>('risk')
  const [open, setOpen] = useState<ChannelUser | null>(null)

  const all = data.data?.users ?? []
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((u) =>
      (!role || u.user.role === role) &&
      (!band || u.churn?.band === band) &&
      (!q || nameOf(u).toLowerCase().includes(q) || u.user.msisdn.includes(q) || (u.user.code ?? '').toLowerCase().includes(q)))
  }, [all, role, band, query])
  const located = shown.filter((u) => u.location)
  const missing = shown.filter((u) => !u.location)
  const count = (pred: (u: ChannelUser) => boolean) => all.filter(pred).length

  const replace = (next: ChannelUser) => data.setData((d) => (d ? { ...d, users: d.users.map((u) => (u.user.id === next.user.id ? next : u)) } : d))

  return (
    <>
      <PageHeader
        crumbs={['Business', 'Channel map']}
        title="Channel map"
        subtitle={<>Every agent and merchant on one map, coloured by churn risk from <Link to="/retention">Retention</Link>. Pins come from a location set here, else their <Link to="/places">Find us</Link> place. Staff only: customers still see just Find us.</>}
        views={<Segmented label="Colour pins by" name="colour" value={colour} onChange={setColour} options={[{ value: 'risk', label: 'Churn risk' }, { value: 'role', label: 'Agent / merchant' }]} />}
      />
      <ReadOnlyNotice />
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : !data.data ? <Loading /> : (
        <>
          <Card>
            <dl className="stats">
              <Stat label="Agents" value={count((u) => u.user.role === 'agent')} hint={`${count((u) => u.user.role === 'agent' && !!u.location)} on the map`} />
              <Stat label="Merchants" value={count((u) => u.user.role === 'merchant')} hint={`${count((u) => u.user.role === 'merchant' && !!u.location)} on the map`} />
              <Stat label="Not on the map yet" value={data.data.unlocated} hint="Set their location below" />
              <Stat label="High risk or gone quiet" value={count((u) => u.churn?.band === 'high' || u.churn?.band === 'quiet')} hint="Red and grey pins" />
            </dl>
          </Card>
          <FilterBar>
            <CountTabs
              label="Who"
              value={role || 'all'}
              onChange={(v) => setRole(v === 'all' ? '' : (v as 'agent' | 'merchant'))}
              options={[
                { value: 'agent', label: 'Agents', count: count((u) => u.user.role === 'agent') },
                { value: 'merchant', label: 'Merchants', count: count((u) => u.user.role === 'merchant') },
                { value: 'all', label: 'All', count: all.length },
              ]}
            />
            <FilterChip id="cm-band" label="Churn risk" value={band} onChange={setBand}
              options={BANDS.map((b) => ({ value: b, label: CHURN_BAND_LABEL[b], count: count((u) => u.churn?.band === b) }))} />
            <SearchBox id="cm-q" label="Search" placeholder="Name, number or code…" value={query} onChange={setQuery} />
          </FilterBar>
          <Card>
            <ChannelMapView users={located} colour={colour} onSelect={setOpen} />
            <div className="channel-legend muted small" aria-label="Legend">
              {colour === 'risk' ? (
                <>
                  {BANDS.map((b) => <span key={b}><span className={`place-pin channel-pin-${b}`} aria-hidden="true" />{CHURN_BAND_LABEL[b]}</span>)}
                  <span><span className="place-pin channel-pin-none" aria-hidden="true" />Not scored yet</span>
                </>
              ) : (
                <>
                  <span><span className="place-pin place-pin-agent" aria-hidden="true">A</span>Agent</span>
                  <span><span className="place-pin place-pin-merchant" aria-hidden="true">M</span>Merchant</span>
                </>
              )}
              <span>Faded: suspended</span>
              <span>{located.length} of {shown.length} shown on the map</span>
            </div>
          </Card>
          <TableCard title="Not on the map yet" count={missing.length} unit={['agent or merchant', 'agents and merchants']}>
            {missing.length === 0 ? <p className="muted" style={{ padding: 16 }}>Everyone shown is on the map.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Agents and merchants without a location</caption>
                  <thead><tr><th scope="col">Agent or merchant</th><th scope="col">Churn risk</th><th scope="col">Last 30 days</th><th scope="col" /></tr></thead>
                  <tbody>
                    {missing.map((u) => (
                      <tr key={u.user.id}>
                        <td><strong>{nameOf(u)}</strong><div className="muted small nowrap">{u.user.role === 'agent' ? 'Agent' : 'Merchant'}{u.user.code ? ` ${u.user.code}` : ''} · {formatMsisdn(u.user.msisdn)}</div></td>
                        <td>{u.churn ? <Dot tone={BAND_TONE[u.churn.band]}>{CHURN_BAND_LABEL[u.churn.band]}</Dot> : <span className="muted small">Not scored yet</span>}</td>
                        <td className="small">{u.tx30} transactions</td>
                        <td><WriteButton size="sm" onClick={() => setOpen(u)}>Set location</WriteButton></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableCard>
        </>
      )}
      {open && <ChannelDialog u={open} onClose={() => setOpen(null)} onSaved={(next) => { replace(next); setOpen(null) }} onCleared={() => { setOpen(null); data.reload() }} />}
    </>
  )
}

function ChannelDialog({ u, onClose, onSaved, onCleared }: { u: ChannelUser; onClose: () => void; onSaved: (u: ChannelUser) => void; onCleared: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [lat, setLat] = useState(u.location ? String(u.location.lat) : '')
  const [lng, setLng] = useState(u.location ? String(u.location.lng) : '')
  const [address, setAddress] = useState(u.location?.address ?? '')
  const [busy, setBusy] = useState(false)
  const latN = Number(lat)
  const lngN = Number(lng)
  const b = LESOTHO_BOUNDS
  const valid = lat.trim() !== '' && lng.trim() !== '' && latN >= b.minLat && latN <= b.maxLat && lngN >= b.minLng && lngN <= b.maxLng

  const save = async () => {
    setBusy(true)
    try {
      onSaved(await api.channelMap.setLocation(u.user.id, { lat: latN, lng: lngN, address: address.trim() || undefined }))
      toast.success(`${nameOf(u)} placed on the map.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    setBusy(true)
    try {
      await api.channelMap.clearLocation(u.user.id)
      toast.success('Location removed: back to their Find us place, if they have one.')
      onCleared()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={nameOf(u)} description={`${u.user.role === 'agent' ? 'Agent' : 'Merchant'}${u.user.code ? ` ${u.user.code}` : ''} · ${formatMsisdn(u.user.msisdn)}`}
      onClose={onClose} variant="panel" size="lg"
      footer={
        <>
          {u.location?.source === 'set' && <WriteButton variant="ghost" busy={busy} onClick={clear}>Remove this location</WriteButton>}
          <Button onClick={onClose}>Close</Button>
          <WriteButton variant="primary" busy={busy} disabled={!valid} onClick={save}>Save location</WriteButton>
        </>
      }>
      <div className="stack">
        <dl className="stats">
          <Stat label="Churn risk" value={u.churn ? <Dot tone={BAND_TONE[u.churn.band]}>{CHURN_BAND_LABEL[u.churn.band]}</Dot> : '–'} hint={u.churn ? <>Score {u.churn.score} · <Link to="/retention">Retention</Link></> : 'Not scored yet'} />
          <Stat label="Last 30 days" value={u.tx30} hint="transactions" />
          <Stat label={u.user.role === 'agent' ? 'Float' : 'Balance'} value={formatMoney(u.balance)} hint={u.status === 'suspended' ? <Tag tone="red">Suspended</Tag> : undefined} />
          <Stat label="Last transaction" value={u.lastTransactionAt ? <span className="small"><When iso={u.lastTransactionAt} /></span> : 'Never'} />
        </dl>
        <p className="muted small">
          {u.location ? (u.location.source === 'set' ? 'Placed by staff here.' : 'From their Find us place. Saving here places them on this map only; Find us is unchanged.') : 'Click the map where they trade, or drag the pin.'}
        </p>
        <LocationPicker value={valid ? { lat: latN, lng: lngN } : null} onPick={(a, o) => { setLat(String(a)); setLng(String(o)) }} />
        <div className="grid-2">
          <Field label="Latitude">{(p) => <input {...p} inputMode="decimal" value={lat} disabled={!canWrite} onChange={(e) => setLat(e.target.value)} />}</Field>
          <Field label="Longitude">{(p) => <input {...p} inputMode="decimal" value={lng} disabled={!canWrite} onChange={(e) => setLng(e.target.value)} />}</Field>
        </div>
        <Field label="Where (optional)" hint="Area and landmark, e.g. Ha Abia shops, opposite the clinic.">
          {(p) => <input {...p} maxLength={200} value={address} disabled={!canWrite} onChange={(e) => setAddress(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  )
}
