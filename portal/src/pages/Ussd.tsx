import { useState, type FormEvent } from 'react'
import { USSD_CODE_PATTERN, USSD_FUNCTIONS, USSD_SHORTCUT_PATTERN, ussdDialString, type UssdFunction, type UssdSettings } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAsync } from '../useAsync'

const LABEL: Record<UssdFunction, string> = {
  balance: 'Check balance (Home)',
  send: 'Send money',
  airtime: 'Buy airtime',
  lec: 'LEC',
  cashout: 'Cash out',
  merchant: 'Pay merchant',
}
/** What each function's shortcut may carry; the example values show the result. */
const EXAMPLE: Record<UssdFunction, Partial<Record<'number' | 'amount' | 'meter' | 'code', string>>> = {
  balance: {},
  send: { number: '62000021', amount: '150' },
  airtime: { amount: '20' },
  lec: { meter: '04128890113', amount: '100' },
  cashout: { code: '0101', amount: '200' },
  merchant: { code: '0001', amount: '45' },
}

/** Checks the form; returns the first problem in plain words. */
export function validateUssd(s: UssdSettings): string | null {
  if (!USSD_CODE_PATTERN.test(s.code.replace(/\s/g, ''))) return 'The USSD code looks like *199#.'
  for (const fn of USSD_FUNCTIONS) {
    const f = s.functions[fn]
    const shortcut = f.shortcut.replace(/\s/g, '')
    if (/pin/i.test(shortcut)) return `${LABEL[fn]}: a shortcut never carries the PIN. People type it in the USSD menu.`
    if (shortcut && !USSD_SHORTCUT_PATTERN.test(shortcut)) return `${LABEL[fn]}: a shortcut starts with *, ends with #, and has only digits, * and {number} {amount} {meter} {code}.`
    if (!f.steps.en.trim() || !f.steps.st.trim()) return `${LABEL[fn]}: write the menu steps in English and Sesotho.`
  }
  return null
}

function UssdForm({ initial, onSaved }: { initial: UssdSettings; onSaved: () => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [s, setS] = useState<UssdSettings>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setFn = (fn: UssdFunction, patch: Partial<UssdSettings['functions'][UssdFunction]>) =>
    setS((x) => ({ ...x, functions: { ...x.functions, [fn]: { ...x.functions[fn], ...patch } } }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const problem = validateUssd(s)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      await api.ussd.save(s)
      toast.success('Saved. Phones keep it for when they have no internet.')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
        <legend className="sr-only">USSD fallback</legend>
        <label className="check">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Offer USSD when the app has no internet.
        </label>
        <Field label="USSD code" hint="Production: *199#.">
          {(p) => <input {...p} value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} />}
        </Field>
        {USSD_FUNCTIONS.map((fn) => {
          const f = s.functions[fn]
          let preview = s.code
          try {
            preview = ussdDialString({ ...s, functions: { ...s.functions, [fn]: { ...f, shortcut: f.shortcut.replace(/\s/g, '') } } }, fn, EXAMPLE[fn])
          } catch {
            // Shown once it is valid.
          }
          return (
            <fieldset key={fn} className="plain-fieldset ussd-fn">
              <legend><strong>{LABEL[fn]}</strong></legend>
              <label className="check">
                <input type="checkbox" checked={f.enabled} onChange={(e) => setFn(fn, { enabled: e.target.checked })} /> Offer it
              </label>
              <Field label="Shortcut (optional)" hint={`Empty: the app dials ${s.code} and shows the steps. Example result: ${preview}`}>
                {(p) => <input {...p} className="mono" placeholder="*199*1*1*{number}*{amount}#" value={f.shortcut} onChange={(e) => setFn(fn, { shortcut: e.target.value })} />}
              </Field>
              <div className="grid-2">
                <Field label="Menu steps (English)">
                  {(p) => <textarea {...p} rows={2} maxLength={300} value={f.steps.en} onChange={(e) => setFn(fn, { steps: { ...f.steps, en: e.target.value } })} />}
                </Field>
                <Field label="Menu steps (Sesotho)">
                  {(p) => <textarea {...p} rows={2} maxLength={300} value={f.steps.st} onChange={(e) => setFn(fn, { steps: { ...f.steps, st: e.target.value } })} />}
                </Field>
              </div>
            </fieldset>
          )
        })}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <WriteButton type="submit" variant="primary" busy={busy}>Save</WriteButton>
      </div>
    </form>
  )
}

/** USSD fallback: what the apps offer on *199# when they have no internet. */
export function UssdPage() {
  const settings = useAsync<UssdSettings>(() => api.ussd.get(), [])
  return (
    <>
      <PageHeader title="USSD fallback" subtitle="With no internet, the apps open the EcoCash USSD menu instead. Menu steps are placeholders until ETL confirms the *199# menus." />
      <ReadOnlyNotice />
      <Card title="When the app has no internet" icon="settings">
        {settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} /> : !settings.data ? <Loading /> : (
          <UssdForm key={JSON.stringify(settings.data)} initial={settings.data} onSaved={settings.reload} />
        )}
      </Card>
    </>
  )
}
