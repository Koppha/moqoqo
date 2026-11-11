import { useState, type FormEvent } from 'react'
import type { SplitSettings } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Card, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAsync } from '../useAsync'

type NumberKey = Exclude<keyof SplitSettings, 'reminderHours' | 'merchantDirect'>
const FIELDS: { key: NumberKey; label: string; hint: string; whole?: boolean }[] = [
  { key: 'approvalHours', label: 'Time to approve (hours)', hint: 'After this, a share nobody approved counts as declined and goes back to the organiser.', whole: true },
  { key: 'collectionDays', label: 'Collection runs for (days)', hint: 'After approval, EcoCash keeps collecting what is owed as money arrives, for this long.', whole: true },
  { key: 'maxShare', label: 'Largest share (M)', hint: 'Most a fully verified person can approve for collection without a PIN.' },
  { key: 'maxShareTier1', label: 'Largest share, KYC tier 1 (M)', hint: 'For people whose ID is not verified yet. They can still pay a bigger share with their PIN.' },
  { key: 'maxOpenOwed', label: 'Most a person may owe (M)', hint: 'Across all their open split bills together.' },
  { key: 'maxParticipants', label: 'Most people in a split', hint: 'The organiser included.', whole: true },
  { key: 'balanceFloor', label: 'Minimum balance kept (M)', hint: 'Automatic collection never takes a wallet below this, so people keep money for transport and food.' },
]

type Form = Record<NumberKey, string> & { reminderHours: string; merchantDirect: boolean }
const toForm = (s: SplitSettings): Form => ({
  ...(Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<NumberKey, string>),
  reminderHours: s.reminderHours.join(', '),
  merchantDirect: s.merchantDirect,
})

/** Checks the form; returns the body to save, or the first problem in plain words. */
export function validateSplit(form: Form): { body: SplitSettings | null; error: string | null } {
  const nums = {} as Record<NumberKey, number>
  for (const f of FIELDS) {
    const raw = form[f.key].trim()
    const n = Number(raw)
    if (!raw || !Number.isFinite(n) || n < 0) return { body: null, error: `${f.label}: enter a number.` }
    if (f.whole && !Number.isInteger(n)) return { body: null, error: `${f.label}: enter a whole number.` }
    nums[f.key] = n
  }
  const reminderHours = form.reminderHours.split(',').map((x) => x.trim()).filter(Boolean).map(Number)
  if (reminderHours.some((h) => !Number.isFinite(h) || h <= 0)) return { body: null, error: 'Reminders: hours separated by commas, e.g. 1, 24.' }
  if (reminderHours.some((h) => h >= nums.approvalHours)) return { body: null, error: 'Reminders must come before the time to approve runs out.' }
  if (nums.maxShareTier1 > nums.maxShare) return { body: null, error: 'The tier 1 share can’t be more than the largest share.' }
  if (nums.maxShare > nums.maxOpenOwed) return { body: null, error: 'The largest share can’t be more than the most a person may owe.' }
  if (nums.maxParticipants < 2) return { body: null, error: 'A split needs at least 2 people.' }
  return { body: { ...nums, reminderHours, merchantDirect: form.merchantDirect }, error: null }
}

function SettingsForm({ settings, onSaved }: { settings: SplitSettings; onSaved: (s: SplitSettings) => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState<Form>(() => toForm(settings))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateSplit(form)
    setError(r.error)
    if (!r.body) return
    setBusy(true)
    try {
      const saved = await api.split.put(r.body)
      toast.success('Split bill limits saved. They apply to new approvals and the next collection.')
      onSaved(saved)
      setForm(toForm(saved))
    } catch (err) {
      setError(errorMessage(err))
      toast.error(`Couldn't save: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Approval, collection & limits" icon="users">
      <p className="muted small">
        Placeholder values until ETL confirms them with the EcoCash API. Each person approves their share once with their PIN; EcoCash then
        collects it without a PIN, right away and whenever money arrives, oldest split first, until it is paid or collection time runs out.
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">Split bill limits</legend>
          <div className="grid-2">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(p) => <input {...p} inputMode="decimal" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
              </Field>
            ))}
            <Field label="Reminders (hours after the request)" hint="Hours separated by commas, e.g. 1, 24.">
              {(p) => <input {...p} value={form.reminderHours} onChange={(e) => setForm({ ...form, reminderHours: e.target.value })} />}
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.merchantDirect} onChange={(e) => setForm({ ...form, merchantDirect: e.target.checked })} />{' '}
            Allow merchant splits where the merchant waits for each share. When off, the organiser pays the merchant in full and the shares come back to them.
          </label>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <WriteButton type="submit" variant="primary" busy={busy}>Save limits</WriteButton>
        </div>
      </form>
    </Card>
  )
}

export function SplitBillPage() {
  const settings = useAsync(() => api.split.get(), [])
  return (
    <>
      <PageHeader title="Split bill" subtitle="How long people have to approve, how collection works, and the limits on pinless shares." />
      <ReadOnlyNotice />
      {settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} /> : !settings.data ? <Loading /> : (
        <SettingsForm settings={settings.data} onSaved={(s) => settings.setData(() => s)} />
      )}
    </>
  )
}
