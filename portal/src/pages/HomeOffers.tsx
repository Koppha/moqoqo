import { useState, type FormEvent } from 'react'
import { OFFER_TARGETS, type Audience, type HomeLayout, type HomeSection, type Offer, type OfferBody } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Card, ErrorState, ListState, Loading, PageHeader, ReadOnlyNotice, Segmented, WriteButton } from '../components/ui'
import { formatMaseru } from '../time'
import { assetUrl, uploadPicture } from '../upload'
import { useAsync } from '../useAsync'

export const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Everyone', customers: 'Customers (EcoCash Super App)', business: 'Merchants and agents', tier1: 'KYC not yet approved (tier 1)', tier2: 'KYC approved (tier 2)',
}
const TARGET_LABEL: Record<(typeof OFFER_TARGETS)[number], string> = {
  ecosure: 'EcoSure (home)', ecosure_funeral: 'EcoSure funeral quote', ecosure_short_term: 'EcoSure short-term quotes', send: 'Send money', topup: 'Card to wallet',
  bank: 'Wallet to bank', remit: 'Send abroad (remittance)', atm: 'ATM cash', money: 'Pay code', receive_money: 'Receive money', split: 'Split bill', lec: 'LEC', news: 'News & offers', kyc: 'Update KYC',
}
const SECTION_LABEL: Record<HomeSection, string> = { offers: 'Banners (offers)', services: 'Services grid', requests: 'Requests waiting', transactions: 'Recent transactions' }

export function HomeOffersPage() {
  const [tab, setTab] = useState<'offers' | 'layout' | 'messages'>('offers')
  return (
    <>
      <PageHeader title="Home & offers" subtitle="Banners on the Home screen and in News & offers, the order of Home, and in-app messages to many people at once." />
      <Segmented label="Show" name="home-tab" hideLabel value={tab} onChange={setTab}
        options={[{ value: 'offers', label: 'Banners & offers' }, { value: 'layout', label: 'Home layout' }, { value: 'messages', label: 'In-app messages' }]} />
      <div style={{ height: 16 }} />
      {tab === 'offers' ? <Offers /> : tab === 'layout' ? <Layout /> : <Messages />}
    </>
  )
}

const now = () => new Date().toISOString()
const blank = (): OfferBody => ({
  title: { en: '', st: '' }, body: { en: '', st: '' }, cta: { en: 'Open', st: 'Bula' }, color: '#2446E8', target: null, placement: 'both',
  audience: 'all', startsAt: now(), endsAt: null, sort: 50, enabled: false,
})

function Offers() {
  const list = useAsync(() => api.home.offers(), [])
  const services = useAsync(() => api.services.list(), [])
  const [editing, setEditing] = useState<{ id: string | null; body: OfferBody } | null>(null)
  const live = (o: Offer) => o.enabled && new Date(o.startsAt) <= new Date() && (!o.endsAt || new Date(o.endsAt) > new Date())
  return (
    <Card actions={<WriteButton variant="primary" onClick={() => setEditing({ id: null, body: blank() })}>New banner</WriteButton>}>
      <ListState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} isEmpty={(d) => d.length === 0} emptyTitle="No banners yet">
        {(d) => (
          <div className="offer-grid">
            {d.map((o) => (
              <button key={o.id} type="button" className="offer-card" onClick={() => { const { id, ...body } = o; setEditing({ id, body }) }}>
                <div className="offer-preview" style={{ background: `linear-gradient(135deg, ${o.color}, #0B1D86)` }}>
                  <div><strong>{o.title.en}</strong><span>{o.body.en}</span><em>{o.cta.en}</em></div>
                  {o.image && <img src={assetUrl(o.image)} alt="" />}
                </div>
                <div className="offer-meta">
                  <span className={`chip ${live(o) ? 'chip-ok' : 'chip-neutral'}`}>{live(o) ? 'Showing' : o.enabled ? 'Scheduled / ended' : 'Off'}</span>
                  <span className="muted small">{o.placement === 'both' ? 'Home + News' : o.placement === 'home' ? 'Home' : 'News'} · {AUDIENCE_LABEL[o.audience]}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </ListState>
      {editing && <OfferEditor id={editing.id} initial={editing.body} services={services.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload() }} />}
    </Card>
  )
}

const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)

function OfferEditor({ id, initial, services, onClose, onSaved }: {
  id: string | null; initial: OfferBody; services: { id: string; name: { en: string } }[]; onClose: () => void; onSaved: () => void
}) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<OfferBody>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof OfferBody>(k: K, value: OfferBody[K]) => setV((x) => ({ ...x, [k]: value }))
  const kind = v.target?.startsWith('url:') ? 'url' : v.target?.startsWith('service:') ? 'service' : v.target ? 'screen' : 'none'

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (id) await api.home.updateOffer(id, v)
      else await api.home.createOffer(v)
      toast.success('Banner saved. The apps show it on their next Home refresh.')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!id || !window.confirm('Delete this banner?')) return
    try {
      await api.home.deleteOffer(id)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const pair = (label: string, k: 'title' | 'body' | 'cta', max: number) => (
    <div className="grid-2">
      <label className="field"><span className="field-label">{label} (English)</span><input maxLength={max} value={v[k].en} onChange={(e) => set(k, { ...v[k], en: e.target.value })} /></label>
      <label className="field"><span className="field-label">{label} (Sesotho)</span><input lang="st" maxLength={max} value={v[k].st} onChange={(e) => set(k, { ...v[k], st: e.target.value })} /></label>
    </div>
  )

  return (
    <Dialog title={id ? 'Edit banner' : 'New banner'} onClose={onClose} size="lg" variant="panel"
      footer={<>{id && <WriteButton variant="danger" onClick={remove}>Delete</WriteButton>}<Button onClick={onClose}>Cancel</Button><WriteButton type="submit" form="offer-form" variant="primary" busy={busy}>Save</WriteButton></>}>
      {!canWrite && <ReadOnlyNotice />}
      <div className="offer-preview offer-preview-lg" style={{ background: `linear-gradient(135deg, ${v.color}, #0B1D86)` }}>
        <div><strong>{v.title.en || 'Title'}</strong><span>{v.body.en || 'Text'}</span><em>{v.cta.en || 'Button'}</em></div>
        {v.image && <img src={assetUrl(v.image)} alt="" />}
      </div>
      <form id="offer-form" onSubmit={save} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">Banner</legend>
          {pair('Title', 'title', 60)}
          {pair('Text', 'body', 160)}
          {pair('Button', 'cta', 30)}
          <div className="grid-2">
            <label className="field"><span className="field-label">Colour</span><input type="color" value={v.color} onChange={(e) => set('color', e.target.value.toUpperCase())} /></label>
            <div className="field">
              <span className="field-label">Picture (optional)</span>
              <div className="row-gap">
                <label htmlFor="offer-pic" className="btn btn-sm btn-secondary">Upload picture</label>
                <input id="offer-pic" type="file" accept="image/png,image/jpeg" className="sr-only" onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  try { set('image', (await uploadPicture(file, 'banner')).path) } catch (err) { setError(err instanceof Error && !('status' in err) ? err.message : errorMessage(err)) }
                }} />
                {v.image && <Button size="sm" variant="ghost" onClick={() => set('image', undefined)}>Remove</Button>}
              </div>
            </div>
          </div>
          <div className="grid-2">
            <label className="field"><span className="field-label">Tapping it opens</span>
              <select value={kind} onChange={(e) => set('target', e.target.value === 'none' ? null : e.target.value === 'url' ? 'url:https://' : e.target.value === 'service' ? `service:${services[0]?.id ?? ''}` : 'ecosure')}>
                <option value="none">Nothing</option><option value="screen">A EcoCash Super App screen</option><option value="service">A service</option><option value="url">A web page</option>
              </select>
            </label>
            {kind === 'screen' && (
              <label className="field"><span className="field-label">Screen</span>
                <select value={v.target ?? ''} onChange={(e) => set('target', e.target.value as OfferBody['target'])}>
                  {OFFER_TARGETS.map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
                </select>
              </label>
            )}
            {kind === 'service' && (
              <label className="field"><span className="field-label">Service</span>
                <select value={v.target ?? ''} onChange={(e) => set('target', e.target.value as OfferBody['target'])}>
                  {services.map((sv) => <option key={sv.id} value={`service:${sv.id}`}>{sv.name.en}</option>)}
                </select>
              </label>
            )}
            {kind === 'url' && (
              <label className="field"><span className="field-label">Web page (https)</span>
                <input value={(v.target ?? '').replace(/^url:/, '')} onChange={(e) => set('target', `url:${e.target.value}` as OfferBody['target'])} placeholder="https://www.econet.co.ls/…" />
              </label>
            )}
          </div>
          <div className="grid-2">
            <label className="field"><span className="field-label">Where</span>
              <select value={v.placement} onChange={(e) => set('placement', e.target.value as OfferBody['placement'])}>
                <option value="both">Home banner and News & offers</option><option value="home">Home banner only</option><option value="news">News & offers only</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Who sees it</span>
              <select value={v.audience} onChange={(e) => set('audience', e.target.value as Audience)}>
                {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </select>
            </label>
            <label className="field"><span className="field-label">From</span><input type="datetime-local" value={local(v.startsAt)} onChange={(e) => set('startsAt', fromLocal(e.target.value) ?? now())} /></label>
            <label className="field"><span className="field-label">Until (empty = no end)</span><input type="datetime-local" value={local(v.endsAt)} onChange={(e) => set('endsAt', fromLocal(e.target.value))} /></label>
            <label className="field"><span className="field-label">Order (lower first)</span><input type="number" value={v.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} /> On</label>
          {error && <p className="field-error" role="alert">{error}</p>}
        </fieldset>
      </form>
    </Dialog>
  )
}

function Layout() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const current = useAsync(() => api.home.layout(), [])
  const [v, setV] = useState<HomeLayout | null>(null)
  const layout = v ?? current.data
  const move = (i: number, d: -1 | 1) => {
    if (!layout) return
    const s = layout.sections.slice()
    const [x] = s.splice(i, 1)
    s.splice(i + d, 0, x)
    setV({ sections: s })
  }
  const save = async () => {
    if (!layout) return
    try {
      const saved = await api.home.setLayout(layout)
      current.setData(() => saved)
      setV(null)
      toast.success('Home layout saved. Apps pick it up on their next Home refresh.')
    } catch (err) {
      toast.error(errorMessage(err))
      current.reload()
    }
  }
  if (current.error) return <ErrorState error={current.error} onRetry={current.reload} />
  if (!layout) return <Loading />
  return (
    <Card title="Home screen, top to bottom">
      <p className="muted small">The balance card and the quick actions (Send, Request, Scan, Pay code, Top up) are always at the top.</p>
      <ol className="layout-list">
        {layout.sections.map((s, i) => (
          <li key={s.key}>
            <label className="check"><input type="checkbox" disabled={!canWrite} checked={s.visible} onChange={(e) => setV({ sections: layout.sections.map((x) => (x.key === s.key ? { ...x, visible: e.target.checked } : x)) })} /> {SECTION_LABEL[s.key]}</label>
            <span className="row-gap">
              <Button size="sm" disabled={!canWrite || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${SECTION_LABEL[s.key]} up`}>↑</Button>
              <Button size="sm" disabled={!canWrite || i === layout.sections.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${SECTION_LABEL[s.key]} down`}>↓</Button>
            </span>
          </li>
        ))}
      </ol>
      <WriteButton variant="primary" disabled={!v} onClick={save}>Save layout</WriteButton>
    </Card>
  )
}

function Messages() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const history = useAsync(() => api.home.broadcasts(), [])
  const [en, setEn] = useState('')
  const [st, setSt] = useState('')
  const [audience, setAudience] = useState<Audience>('all')
  const [sms, setSms] = useState(false)
  const [busy, setBusy] = useState(false)
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!en.trim() || !window.confirm(`Send this message to ${AUDIENCE_LABEL[audience].toLowerCase()}?`)) return
    setBusy(true)
    try {
      const b = await api.home.broadcast({ text: { en: en.trim(), st: st.trim() }, audience, sms })
      toast.success(`Sent to ${b.recipients} ${b.recipients === 1 ? 'person' : 'people'}.`)
      setEn('')
      setSt('')
      history.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid-2">
      <Card title="New in-app message">
        <p className="muted small">Arrives in each person's "EcoCash Super App" chat with a push notification. Tick SMS to also text the people who allow news by SMS.</p>
        <form onSubmit={send} noValidate>
          <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
            <legend className="sr-only">Message</legend>
            <label className="field"><span className="field-label">Message (English)</span><textarea rows={4} maxLength={1000} value={en} onChange={(e) => setEn(e.target.value)} /></label>
            <label className="field"><span className="field-label">Message (Sesotho, optional)</span><textarea lang="st" rows={4} maxLength={1000} value={st} onChange={(e) => setSt(e.target.value)} /></label>
            <label className="field"><span className="field-label">To</span>
              <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Also by SMS</label>
            <WriteButton type="submit" variant="primary" busy={busy}>Send message</WriteButton>
          </fieldset>
        </form>
      </Card>
      <Card title="Sent">
        <ListState loading={history.loading} error={history.error} data={history.data} onRetry={history.reload} isEmpty={(d) => d.length === 0} emptyTitle="Nothing sent yet">
          {(d) => (
            <ul className="mini-list">
              {d.map((b) => (
                <li key={b.id}>
                  <div><span>{b.text.en}</span><span className="muted small">{formatMaseru(b.createdAt)} · {AUDIENCE_LABEL[b.audience]} · {b.recipients} people{b.sms ? ' · SMS' : ''} · {b.sentBy}</span></div>
                </li>
              ))}
            </ul>
          )}
        </ListState>
      </Card>
    </div>
  )
}
