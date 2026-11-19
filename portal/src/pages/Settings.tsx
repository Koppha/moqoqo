import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { DEFAULT_DEVICE_SECURITY, MAX_TRANSACTION, SECURITY_LIMITS, type AppConfig, type AppConfigBody, type ContactSettings, type Tariff } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../components/Toast'
import { KycLimitsCard } from './KycLimits'
import { Card, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

const SEMVER = /^\d+\.\d+\.\d+$/

interface Values {
  showAnnouncement: boolean
  en: string
  st: string
  customer: string
  business: string
  ecosure: string
  society: string
  blockRooted: boolean
  blockDeveloperMode: boolean
  requireSimMatch: boolean
  idleMinutes: string
  sessionDays: string
  maxPinAttempts: string
  pinLockMinutes: string
}
type SecurityKey = 'idleMinutes' | 'sessionDays' | 'maxPinAttempts' | 'pinLockMinutes'
type Errors = Partial<Record<'en' | 'st' | 'customer' | 'business' | 'ecosure' | 'society' | SecurityKey, string>>
const SECURITY_FIELDS: { key: SecurityKey; label: string; hint: string }[] = [
  { key: 'idleMinutes', label: 'Sign out after no use (minutes)', hint: 'Apps and portal. The guidelines allow at most 15.' },
  { key: 'sessionDays', label: 'Sign in again after (days)', hint: 'Even when the app is in use.' },
  { key: 'maxPinAttempts', label: 'Wrong PINs before locking', hint: 'Also staff passwords.' },
  { key: 'pinLockMinutes', label: 'Lock time (minutes)', hint: 'How long a locked PIN or staff account stays locked.' },
]

export function validateSettings(v: Values): { errors: Errors; body: AppConfigBody | null } {
  const errors: Errors = {}
  if (v.showAnnouncement) {
    if (!v.en.trim()) errors.en = 'Enter the English announcement, or turn the announcement off.'
    if (!v.st.trim()) errors.st = 'Enter the Sesotho announcement, or turn the announcement off.'
  }
  if (v.customer.trim() && !SEMVER.test(v.customer.trim())) errors.customer = 'Use a version like 1.4.0, or leave empty.'
  if (v.business.trim() && !SEMVER.test(v.business.trim())) errors.business = 'Use a version like 1.4.0, or leave empty.'
  if (v.ecosure.trim() && !SEMVER.test(v.ecosure.trim())) errors.ecosure = 'Use a version like 1.4.0, or leave empty.'
  if (v.society.trim() && !SEMVER.test(v.society.trim())) errors.society = 'Use a version like 1.4.0, or leave empty.'
  for (const f of SECURITY_FIELDS) {
    const n = Number(v[f.key])
    const [min, max] = SECURITY_LIMITS[f.key]
    if (!/^\d+$/.test(v[f.key].trim()) || n < min || n > max) errors[f.key] = `A whole number from ${min} to ${max}.`
  }
  if (Object.keys(errors).length) return { errors, body: null }
  return {
    errors,
    body: {
      announcement: v.showAnnouncement ? { en: v.en.trim(), st: v.st.trim() } : null,
      minVersion: { customer: v.customer.trim() || null, business: v.business.trim() || null, ecosure: v.ecosure.trim() || null, society: v.society.trim() || null },
      deviceSecurity: {
        blockRooted: v.blockRooted, blockDeveloperMode: v.blockDeveloperMode, requireSimMatch: v.requireSimMatch,
        idleMinutes: Number(v.idleMinutes), sessionDays: Number(v.sessionDays), maxPinAttempts: Number(v.maxPinAttempts), pinLockMinutes: Number(v.pinLockMinutes),
      },
    },
  }
}

function toValues(c: AppConfig): Values {
  return {
    showAnnouncement: c.announcement !== null,
    en: c.announcement?.en ?? '',
    st: c.announcement?.st ?? '',
    customer: c.minVersion.customer ?? '',
    business: c.minVersion.business ?? '',
    ecosure: c.minVersion.ecosure ?? '',
    society: c.minVersion.society ?? '',
    blockRooted: c.deviceSecurity.blockRooted,
    blockDeveloperMode: c.deviceSecurity.blockDeveloperMode,
    requireSimMatch: c.deviceSecurity.requireSimMatch ?? true,
    idleMinutes: String(c.deviceSecurity.idleMinutes ?? DEFAULT_DEVICE_SECURITY.idleMinutes),
    sessionDays: String(c.deviceSecurity.sessionDays ?? DEFAULT_DEVICE_SECURITY.sessionDays),
    maxPinAttempts: String(c.deviceSecurity.maxPinAttempts ?? DEFAULT_DEVICE_SECURITY.maxPinAttempts),
    pinLockMinutes: String(c.deviceSecurity.pinLockMinutes ?? DEFAULT_DEVICE_SECURITY.pinLockMinutes),
  }
}

function Current({ config }: { config: AppConfig }) {
  return (
    <Card title="Live now">
      <dl className="detail-list">
        <div>
          <dt>Announcement</dt>
          <dd>
            {config.announcement ? (
              <>
                <p lang="en">{config.announcement.en}</p>
                <p lang="st" className="muted">
                  {config.announcement.st}
                </p>
              </>
            ) : (
              <span className="muted">None</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Minimum customer app</dt>
          <dd>{config.minVersion.customer ?? <span className="muted">No minimum</span>}</dd>
        </div>
        <div>
          <dt>Minimum business app</dt>
          <dd>{config.minVersion.business ?? <span className="muted">No minimum</span>}</dd>
        </div>
        <div>
          <dt>Minimum EcoSure app</dt>
          <dd>{config.minVersion.ecosure ?? <span className="muted">No minimum</span>}</dd>
        </div>
        <div>
          <dt>Minimum Mekhatlo app</dt>
          <dd>{config.minVersion.society ?? <span className="muted">No minimum</span>}</dd>
        </div>
        <div>
          <dt>Device security</dt>
          <dd>
            {config.deviceSecurity.blockRooted || config.deviceSecurity.blockDeveloperMode
              ? [config.deviceSecurity.blockRooted && 'Rooted and jailbroken phones blocked', config.deviceSecurity.blockDeveloperMode && 'Developer mode blocked'].filter(Boolean).join('; ')
              : <span className="muted">All phones allowed</span>}
            {' · '}
            {config.deviceSecurity.requireSimMatch === false ? 'SIM number not checked on new phones' : 'New phones must hold the wallet’s SIM'}
            {` · sign out after ${config.deviceSecurity.idleMinutes ?? 15} min without use · ${config.deviceSecurity.maxPinAttempts ?? 5} wrong PINs lock for ${config.deviceSecurity.pinLockMinutes ?? 15} min`}
          </dd>
        </div>
        <div>
          <dt>Maintenance</dt>
          <dd>
            {config.maintenance ? (
              <>
                {config.maintenance.active ? 'Active until ' : 'Scheduled for '}
                {formatMaseru(config.maintenance.active ? config.maintenance.endsAt : config.maintenance.startsAt)}
              </>
            ) : (
              'None'
            )}{' '}
            · <Link to="/maintenance">Manage</Link>
          </dd>
        </div>
        <div>
          <dt>Server time</dt>
          <dd>{formatMaseru(config.serverTime)}</dd>
        </div>
      </dl>
    </Card>
  )
}

function SettingsForm({ config, onSaved }: { config: AppConfig; onSaved: (c: AppConfig) => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<Values>(() => toValues(config))
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateSettings(v)
    setErrors(r.errors)
    if (!r.body) return
    setBusy(true)
    setServerError(null)
    try {
      const saved = await api.appConfig.put(r.body)
      toast.success('App settings saved. The apps pick them up on their next config check.')
      onSaved(saved)
      setV(toValues(saved))
    } catch (err) {
      setServerError(errorMessage(err))
      toast.error(`Couldn't save settings: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Change settings">
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">App settings</legend>
          <h3 className="form-section">Announcement</h3>
          <div className="check-row">
            <input id="ann-on" type="checkbox" checked={v.showAnnouncement} onChange={(e) => set('showAnnouncement', e.target.checked)} />
            <label htmlFor="ann-on">Show an announcement banner in the apps</label>
          </div>
          {v.showAnnouncement && (
            <div className="grid-2">
              <Field label="Announcement in English" error={errors.en}>
                {(p) => <textarea {...p} lang="en" rows={3} value={v.en} onChange={(e) => set('en', e.target.value)} />}
              </Field>
              <Field label="Announcement in Sesotho" error={errors.st}>
                {(p) => <textarea {...p} lang="st" rows={3} value={v.st} onChange={(e) => set('st', e.target.value)} />}
              </Field>
            </div>
          )}
          <h3 className="form-section">Minimum app versions</h3>
          <p className="muted small">Builds below these versions are asked to update before they can be used. Leave empty for no minimum.</p>
          <div className="grid-2">
            <Field label="Customer app" hint="e.g. 1.4.0" error={errors.customer}>
              {(p) => <input {...p} type="text" inputMode="decimal" value={v.customer} onChange={(e) => set('customer', e.target.value)} />}
            </Field>
            <Field label="Business app" hint="e.g. 1.2.0" error={errors.business}>
              {(p) => <input {...p} type="text" inputMode="decimal" value={v.business} onChange={(e) => set('business', e.target.value)} />}
            </Field>
            <Field label="EcoSure app" hint="e.g. 1.0.0" error={errors.ecosure}>
              {(p) => <input {...p} type="text" inputMode="decimal" value={v.ecosure} onChange={(e) => set('ecosure', e.target.value)} />}
            </Field>
            <Field label="Mekhatlo app" hint="e.g. 1.0.0" error={errors.society}>
              {(p) => <input {...p} type="text" inputMode="decimal" value={v.society} onChange={(e) => set('society', e.target.value)} />}
            </Field>
          </div>
          <h3 className="form-section">Device security</h3>
          <p className="muted small">
            Phones the apps refuse to run on. The apps show the customer why; the server also refuses sign-in and sign-up from them. Detection is a best
            effort: a determined attacker can hide a rooted phone. Turning developer mode blocking on also blocks emulators and phones used for testing.
          </p>
          <div className="check-row">
            <input id="block-rooted" type="checkbox" checked={v.blockRooted} onChange={(e) => set('blockRooted', e.target.checked)} />
            <label htmlFor="block-rooted">Block rooted (Android) and jailbroken (iPhone) phones</label>
          </div>
          <div className="check-row">
            <input id="block-dev" type="checkbox" checked={v.blockDeveloperMode} onChange={(e) => set('blockDeveloperMode', e.target.checked)} />
            <label htmlFor="block-dev">Block phones with developer options or USB debugging on (Android)</label>
          </div>
          <div className="check-row">
            <input id="require-sim" type="checkbox" checked={v.requireSimMatch} onChange={(e) => set('requireSimMatch', e.target.checked)} />
            <label htmlFor="require-sim">
              On a phone’s first sign-in, refuse it when its SIM shows a different number than the wallet’s (Android phones that show
              their number; Econet’s network check once connected). Off: let it through and mark the phone.
            </label>
          </div>
          <h3 className="form-section">Sessions and PIN lockout</h3>
          <p className="muted small">
            CBL/LCA DFS Security Guidelines 3.2.8a and 3.2.5b-v. Changes apply to the next request; people already signed in are signed out once they pass the new limits.
          </p>
          <div className="grid-2">
            {SECURITY_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
                {(p) => <input {...p} type="number" inputMode="numeric" min={SECURITY_LIMITS[f.key][0]} max={SECURITY_LIMITS[f.key][1]} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} />}
              </Field>
            ))}
          </div>
        </fieldset>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="form-actions">
          <WriteButton type="submit" variant="primary" busy={busy}>
            Save settings
          </WriteButton>
        </div>
      </form>
    </Card>
  )
}

// ---------- fees & limits (tariff) ----------

type TariffKey = keyof Tariff
type TariffValues = Record<TariffKey, string>
type TariffErrors = Partial<Record<TariffKey, string>>

const TARIFF_FIELDS: { key: TariffKey; label: string; hint: string; unit: 'M' | '%'; max: number }[] = [
  { key: 'cardTopupFeePercent', label: 'Card top-up fee (%)', hint: 'Percent of the amount, charged to the card. At most 20.', unit: '%', max: 20 },
  { key: 'cardTopupFeeMin', label: 'Card top-up minimum fee (M)', hint: 'Charged when the percentage comes to less.', unit: 'M', max: MAX_TRANSACTION },
  { key: 'cardTopupMax', label: 'Card top-up maximum (M)', hint: 'Per top-up.', unit: 'M', max: MAX_TRANSACTION },
  { key: 'bankTransferFee', label: 'Bank transfer fee (M)', hint: 'Flat, paid from the wallet on top of the amount.', unit: 'M', max: MAX_TRANSACTION },
  { key: 'bankTransferMax', label: 'Bank transfer maximum (M)', hint: 'Per transfer.', unit: 'M', max: MAX_TRANSACTION },
  { key: 'dailyMax', label: 'Daily maximum (M)', hint: 'Per wallet per day, for top-ups and for bank transfers separately.', unit: 'M', max: 1_000_000 },
  { key: 'atmFee', label: 'ATM withdrawal fee (M)', hint: 'Flat, per cardless ATM withdrawal (taken when the cash comes out).', unit: 'M', max: 1000 },
  { key: 'atmMax', label: 'ATM withdrawal maximum (M)', hint: 'Per withdrawal. A multiple of M50.', unit: 'M', max: MAX_TRANSACTION },
]

const toTariffValues = (t: Tariff): TariffValues =>
  Object.fromEntries(TARIFF_FIELDS.map((f) => [f.key, String(t[f.key])])) as TariffValues

export function validateTariff(v: TariffValues): { errors: TariffErrors; body: Tariff | null } {
  const errors: TariffErrors = {}
  const body = {} as Tariff
  for (const f of TARIFF_FIELDS) {
    const raw = v[f.key].trim()
    const n = Number(raw)
    if (!raw || !Number.isFinite(n)) errors[f.key] = 'Enter a number.'
    else if (n < 0) errors[f.key] = "Can't be negative."
    else if (n > f.max) errors[f.key] = f.unit === '%' ? `At most ${f.max}%.` : `At most M${f.max.toLocaleString('en')}.`
    else if (f.unit === 'M' && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) errors[f.key] = 'At most 2 decimals.'
    else body[f.key] = n
  }
  if (!errors.dailyMax && !errors.cardTopupMax && !errors.bankTransferMax && body.dailyMax < Math.max(body.cardTopupMax, body.bankTransferMax)) {
    errors.dailyMax = 'Must be at least the per-top-up and per-transfer maximums.'
  }
  return Object.keys(errors).length ? { errors, body: null } : { errors, body }
}

function TariffForm({ tariff, onSaved }: { tariff: Tariff; onSaved: (t: Tariff) => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<TariffValues>(() => toTariffValues(tariff))
  const [errors, setErrors] = useState<TariffErrors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateTariff(v)
    setErrors(r.errors)
    if (!r.body) return
    setBusy(true)
    setServerError(null)
    try {
      const saved = await api.tariff.put(r.body)
      toast.success('Fees and limits saved. They apply to new top-ups and bank transfers.')
      onSaved(saved)
      setV(toTariffValues(saved))
    } catch (err) {
      setServerError(errorMessage(err))
      toast.error(`Couldn't save fees and limits: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Fees & limits">
      <p className="muted small">
        Card top-ups (card → wallet) and bank transfers (wallet → bank). Placeholder values until the real tariff is agreed.
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">Fees and limits</legend>
          <div className="grid-2">
            {TARIFF_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode="decimal"
                    value={v[f.key]}
                    onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="form-actions">
          <WriteButton type="submit" variant="primary" busy={busy}>
            Save fees & limits
          </WriteButton>
        </div>
      </form>
    </Card>
  )
}

function TariffSection() {
  const tariff = useAsync(() => api.tariff.get(), [])
  if (tariff.error) return <ErrorState error={tariff.error} onRetry={tariff.reload} />
  if (!tariff.data) return <Loading />
  return <TariffForm tariff={tariff.data} onSaved={(t) => tariff.setData(() => t)} />
}

// ---------- contact us & share the app ----------

type ContactErrors = Partial<Record<keyof ContactSettings, string>>

const CONTACT_FIELDS: { key: keyof ContactSettings; label: string; hint: string; inputMode?: 'tel' | 'email' | 'url' }[] = [
  { key: 'phone', label: 'Call centre number', hint: 'As dialled, e.g. 199 or +26622000000.', inputMode: 'tel' },
  { key: 'whatsapp', label: 'WhatsApp number', hint: 'International form (+266…). Leave empty to hide WhatsApp.', inputMode: 'tel' },
  { key: 'email', label: 'Email', hint: 'e.g. ecocash@etl.co.ls', inputMode: 'email' },
  { key: 'website', label: 'Website', hint: 'https://…', inputMode: 'url' },
  { key: 'shareLink', label: 'Share link', hint: 'What Me › Share the app sends: an app store or download page (https://…).', inputMode: 'url' },
]

export function validateContact(v: ContactSettings): { errors: ContactErrors; body: ContactSettings | null } {
  const errors: ContactErrors = {}
  const t = Object.fromEntries(CONTACT_FIELDS.map((f) => [f.key, v[f.key].trim()])) as unknown as ContactSettings
  if (!/^\+?\d{3,15}$/.test(t.phone.replace(/\s/g, ''))) errors.phone = 'Enter the number as dialled (digits, with + for international).'
  if (t.whatsapp && !/^\+\d{8,15}$/.test(t.whatsapp.replace(/\s/g, ''))) errors.whatsapp = 'Use the international form, e.g. +26658000000, or leave empty.'
  if (t.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)) errors.email = 'Enter an email address, or leave empty.'
  if (t.website && !/^https?:\/\/\S+$/.test(t.website)) errors.website = 'Start with https://, or leave empty.'
  if (!/^https?:\/\/\S+$/.test(t.shareLink)) errors.shareLink = 'Enter the link to share, starting with https://.'
  return Object.keys(errors).length ? { errors, body: null } : { errors, body: t }
}

function ContactForm({ contact, onSaved }: { contact: ContactSettings; onSaved: (c: ContactSettings) => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [v, setV] = useState<ContactSettings>(contact)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateContact(v)
    setErrors(r.errors)
    if (!r.body) return
    setBusy(true)
    setServerError(null)
    try {
      const saved = await api.contact.put(r.body)
      toast.success('Contact details saved. The apps pick them up on their next config check.')
      onSaved(saved)
      setV(saved)
    } catch (err) {
      setServerError(errorMessage(err))
      toast.error(`Couldn't save contact details: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Contact us & share the app">
      <p className="muted small">Shown in the apps under Me › Contact us, and the link Me › Share the app sends. Placeholders until ETL confirms them.</p>
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">Contact us</legend>
          <div className="grid-2">
            {CONTACT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode={f.inputMode}
                    value={v[f.key]}
                    onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="form-actions">
          <WriteButton type="submit" variant="primary" busy={busy}>
            Save contact details
          </WriteButton>
        </div>
      </form>
    </Card>
  )
}

function ContactSection() {
  const contact = useAsync(() => api.contact.get(), [])
  if (contact.error) return <ErrorState error={contact.error} onRetry={contact.reload} />
  if (!contact.data) return <Loading />
  return <ContactForm contact={contact.data} onSaved={(c) => contact.setData(() => c)} />
}

export function SettingsPage() {
  const cfg = useAsync(() => api.appConfig.get(), [])
  return (
    <>
      <PageHeader title="App settings" subtitle="Announcement banner, minimum app versions, the fees and limits for card top-ups and bank transfers, and the Contact us details." />
      <ReadOnlyNotice />
      {cfg.error ? (
        <ErrorState error={cfg.error} onRetry={cfg.reload} />
      ) : !cfg.data ? (
        <Loading />
      ) : (
        <div className="settings-grid">
          <SettingsForm config={cfg.data} onSaved={(c) => cfg.setData(() => c)} />
          <Current config={cfg.data} />
        </div>
      )}
      <div className="settings-grid settings-section">
        <TariffSection />
        <KycLimitsCard />
      </div>
      <div className="settings-grid settings-section">
        <ContactSection />
      </div>
    </>
  )
}
