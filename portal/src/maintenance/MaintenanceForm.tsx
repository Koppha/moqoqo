import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { MaintenanceBody, MaintenanceWindow } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { ConfirmDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Field, Segmented, WriteButton } from '../components/ui'
import { formatDuration, formatMaseru, maseruToIso, MASERU_LABEL } from '../time'
import {
  DEFAULT_MESSAGE,
  initialValues,
  MESSAGE_MAX,
  validateMaintenance,
  valuesFromWindow,
  type MaintenanceErrors,
  type MaintenanceFormValues,
} from './form'
import { PhonePreview, type Lang } from './PhonePreview'

const FIELD_ORDER: (keyof MaintenanceErrors)[] = ['start', 'end', 'en', 'st']

export function MaintenanceForm({
  editing,
  onSaved,
  onCancel,
  clock = () => new Date(),
}: {
  editing?: MaintenanceWindow
  onSaved: (w: MaintenanceWindow) => void
  onCancel: () => void
  /** Injectable clock for tests. */
  clock?: () => Date
}) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const clockRef = useRef(clock)
  clockRef.current = clock
  const [now, setNow] = useState(() => clock())
  const [values, setValues] = useState<MaintenanceFormValues>(() => (editing ? valuesFromWindow(editing) : initialValues(clock())))
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmBody, setConfirmBody] = useState<MaintenanceBody | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const formRef = useRef<HTMLFormElement>(null)
  const ids = { start: useId(), end: useId(), startNow: useId(), preview: useId() }

  // Keep "now" fresh so "Start now", validation and the preview stay right while the form is open.
  useEffect(() => {
    const t = setInterval(() => setNow(clockRef.current()), 30_000)
    return () => clearInterval(t)
  }, [])

  const lockedStart = editing?.status === 'active' ? editing.startsAt : undefined
  const result = useMemo(() => validateMaintenance(values, now, { lockedStart }), [values, now, lockedStart])
  const errors: MaintenanceErrors = submitted ? result.errors : {}

  const set = <K extends keyof MaintenanceFormValues>(k: K, v: MaintenanceFormValues[K]) => setValues((s) => ({ ...s, [k]: v }))

  const previewStart = lockedStart ?? (values.startNow ? now.toISOString() : maseruToIso(values.startDate, values.startTime))
  const previewEnd = maseruToIso(values.endDate, values.endTime)
  const duration = previewStart && previewEnd ? Date.parse(previewEnd) - Date.parse(previewStart) : 0

  const save = async (body: MaintenanceBody) => {
    setBusy(true)
    setServerError(null)
    try {
      let saved: MaintenanceWindow
      if (editing) {
        const patch: Partial<MaintenanceBody> = lockedStart ? { endsAt: body.endsAt, message: body.message } : body
        saved = await api.maintenance.update(editing.id, patch)
        toast.success('Maintenance window updated.')
      } else {
        saved = await api.maintenance.create(body)
        toast.success(saved.status === 'active' ? 'Maintenance has started.' : `Maintenance scheduled for ${formatMaseru(saved.startsAt)}.`)
      }
      onSaved(saved)
    } catch (e) {
      const msg = errorMessage(e)
      setServerError(msg)
      toast.error(`Couldn't save maintenance: ${msg}`)
      setBusy(false)
      throw e
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    setSubmitted(true)
    const fresh = validateMaintenance(values, clockRef.current(), { lockedStart })
    if (!fresh.body) {
      const first = FIELD_ORDER.find((f) => fresh.errors[f])
      const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)
      el?.focus()
      return
    }
    if (!editing && values.startNow) {
      setConfirmBody(fresh.body)
      return
    }
    save(fresh.body).catch(() => {})
  }

  const stIsDraft = values.st.trim() === DEFAULT_MESSAGE.st

  return (
    <div className="maint-editor">
      <form ref={formRef} onSubmit={submit} noValidate className="maint-form" aria-label={editing ? 'Edit maintenance window' : 'Schedule maintenance'}>
        <fieldset disabled={!canWrite || busy} className="plain-fieldset">
          <legend className="sr-only">{editing ? 'Edit maintenance window' : 'Schedule maintenance'}</legend>

          {!editing && (
            <div className="check-row">
              <input id={ids.startNow} type="checkbox" checked={values.startNow} onChange={(e) => set('startNow', e.target.checked)} />
              <label htmlFor={ids.startNow}>
                <strong>Start now</strong>
                <span className="muted"> — the maintenance screen appears in the apps immediately</span>
              </label>
            </div>
          )}

          <div className={`field ${errors.start ? 'has-error' : ''}`}>
            <span className="field-label" id={ids.start}>
              Start <span className="muted">({MASERU_LABEL})</span>
            </span>
            {lockedStart ? (
              <p className="field-static">Started {formatMaseru(lockedStart)} (can't be changed while active)</p>
            ) : values.startNow ? (
              <p className="field-static">Now — {formatMaseru(now.toISOString())}</p>
            ) : (
              <div className="datetime" role="group" aria-labelledby={ids.start}>
                <label className="sr-only" htmlFor={`${ids.start}-d`}>
                  Start date
                </label>
                <input
                  id={`${ids.start}-d`}
                  data-field="start"
                  type="date"
                  value={values.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                  aria-invalid={errors.start ? true : undefined}
                  aria-describedby={errors.start ? `${ids.start}-err` : undefined}
                />
                <label className="sr-only" htmlFor={`${ids.start}-t`}>
                  Start time
                </label>
                <input
                  id={`${ids.start}-t`}
                  type="time"
                  value={values.startTime}
                  onChange={(e) => set('startTime', e.target.value)}
                  aria-invalid={errors.start ? true : undefined}
                />
              </div>
            )}
            {errors.start && (
              <p className="field-error" id={`${ids.start}-err`}>
                {errors.start}
              </p>
            )}
          </div>

          <div className={`field ${errors.end ? 'has-error' : ''}`}>
            <span className="field-label" id={ids.end}>
              End <span className="muted">({MASERU_LABEL})</span>
            </span>
            <div className="datetime" role="group" aria-labelledby={ids.end}>
              <label className="sr-only" htmlFor={`${ids.end}-d`}>
                End date
              </label>
              <input
                id={`${ids.end}-d`}
                data-field="end"
                type="date"
                value={values.endDate}
                onChange={(e) => set('endDate', e.target.value)}
                aria-invalid={errors.end ? true : undefined}
                aria-describedby={errors.end ? `${ids.end}-err` : undefined}
              />
              <label className="sr-only" htmlFor={`${ids.end}-t`}>
                End time
              </label>
              <input
                id={`${ids.end}-t`}
                type="time"
                value={values.endTime}
                onChange={(e) => set('endTime', e.target.value)}
                aria-invalid={errors.end ? true : undefined}
              />
            </div>
            {errors.end ? (
              <p className="field-error" id={`${ids.end}-err`}>
                {errors.end}
              </p>
            ) : (
              duration > 0 && <p className="field-hint">Lasts {formatDuration(duration)}.</p>
            )}
          </div>

          <Field label="Message in English" error={errors.en} hint={`${values.en.trim().length}/${MESSAGE_MAX} characters`}>
            {(p) => (
              <textarea {...p} data-field="en" lang="en" rows={3} value={values.en} onChange={(e) => set('en', e.target.value)} />
            )}
          </Field>

          <Field
            label={
              <>
                Message in Sesotho{' '}
                {stIsDraft && <span className="chip chip-warn">Needs review by a Sesotho speaker</span>}
              </>
            }
            error={errors.st}
            hint={
              stIsDraft
                ? 'This default text is a draft translation. Have a Sesotho speaker check it before publishing.'
                : `${values.st.trim().length}/${MESSAGE_MAX} characters`
            }
          >
            {(p) => (
              <textarea {...p} data-field="st" lang="st" rows={3} value={values.st} onChange={(e) => set('st', e.target.value)} />
            )}
          </Field>
        </fieldset>

        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}

        <div className="form-actions">
          <Button onClick={onCancel} disabled={busy}>
            {editing ? 'Close' : 'Discard'}
          </Button>
          <WriteButton type="submit" variant="primary" busy={busy}>
            {editing ? 'Save changes' : values.startNow ? 'Start maintenance now' : 'Schedule maintenance'}
          </WriteButton>
        </div>
      </form>

      <section className="maint-preview" aria-labelledby={ids.preview}>
        <div className="preview-head">
          <h3 id={ids.preview}>Live preview</h3>
          <Segmented
            label="Preview language"
            hideLabel
            name={`${ids.preview}-lang`}
            value={lang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'st', label: 'Sesotho' },
            ]}
            onChange={setLang}
          />
        </div>
        <PhonePreview lang={lang} message={lang === 'en' ? values.en : values.st} endsAt={previewEnd} now={now} />
        <p className="muted small">
          Approximately how the full-screen maintenance page looks in the customer and business apps.
          {lang === 'st' && ' Sesotho screen title and "back at" text are drafts pending review.'}
        </p>
      </section>

      {confirmBody && (
        <ConfirmDialog
          title="Start maintenance now?"
          message={
            <>
              Every customer, agent and merchant will see the maintenance screen immediately and won't be able to send or receive
              money until {formatMaseru(confirmBody.endsAt)} ({MASERU_LABEL}), or until you end it.
            </>
          }
          confirmLabel="Start maintenance now"
          danger
          onConfirm={() => save({ ...confirmBody, startsAt: clockRef.current().toISOString() })}
          onClose={() => setConfirmBody(null)}
        />
      )}
    </div>
  )
}
