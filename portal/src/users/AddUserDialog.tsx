import { useState, type FormEvent } from 'react'
import type { AdminUser, Role } from '../../../shared/api'
import { api, errorMessage, isApiError } from '../api'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, Field, Segmented } from '../components/ui'
import { normalizeMsisdn, ROLE_LABEL } from '../format'

interface Values {
  role: Role
  msisdn: string
  name: string
  businessName: string
  ownerIdNumber: string
  pin: string
}
type Errors = Partial<Record<keyof Values, string>>

const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321'])

export function validatePin(pin: string): string | undefined {
  if (!/^\d{4}$/.test(pin)) return 'The PIN must be exactly 4 digits.'
  if (WEAK_PINS.has(pin)) return 'Choose a less guessable PIN (not repeated or sequential digits).'
  return undefined
}

/** A business owner's national ID as on the ID card; spaces and dashes are ignored. Empty is allowed (record it later). */
export const normaliseOwnerId = (v: string) => v.replace(/[\s-]/g, '').toUpperCase()
export function validateOwnerId(v: string): string | undefined {
  const id = normaliseOwnerId(v)
  if (id && !/^[0-9A-Z]{6,20}$/.test(id)) return 'Enter the ID number as it is on the ID: 6 to 20 letters and digits.'
  return undefined
}

export function validateNewUser(v: Values): Errors {
  const e: Errors = {}
  if (!normalizeMsisdn(v.msisdn)) e.msisdn = 'Enter a Lesotho mobile number, e.g. +266 6200 0021.'
  if (v.name.trim().length < 2) e.name = 'Enter the full name.'
  if (v.role === 'merchant' && !v.businessName.trim()) e.businessName = 'Merchants need a business name.'
  const ownerErr = v.role === 'customer' ? undefined : validateOwnerId(v.ownerIdNumber)
  if (ownerErr) e.ownerIdNumber = ownerErr
  const pinErr = validatePin(v.pin)
  if (pinErr) e.pin = pinErr
  return e
}

export function AddUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const toast = useToast()
  const [v, setV] = useState<Values>({ role: 'agent', msisdn: '+266 ', name: '', businessName: '', ownerIdNumber: '', pin: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateNewUser(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setServerError(null)
    try {
      const user = await api.users.create({
        msisdn: normalizeMsisdn(v.msisdn)!,
        name: v.name.trim(),
        role: v.role,
        pin: v.pin,
        businessName: v.role === 'merchant' && v.businessName.trim() ? v.businessName.trim() : undefined,
        ownerIdNumber: v.role !== 'customer' && v.ownerIdNumber.trim() ? normaliseOwnerId(v.ownerIdNumber) : undefined,
      })
      toast.success(`${ROLE_LABEL[user.role]} ${user.name} added.`)
      onCreated(user)
    } catch (err) {
      const msg = isApiError(err) && err.code === 'CONFLICT' ? 'That number already has an EcoCash wallet.' : errorMessage(err)
      setServerError(msg)
      toast.error(`Couldn't add user: ${msg}`)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Add user" description="Onboard an agent, merchant or customer wallet." onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={busy}>
          <legend className="sr-only">New user</legend>
          <Segmented
            label="Role"
            name="add-user-role"
            value={v.role}
            options={(['agent', 'merchant', 'customer'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            onChange={(r) => set('role', r)}
          />
          <Field label="Mobile number" hint="Lesotho number in +266 format." error={errors.msisdn}>
            {(p) => <input {...p} type="tel" inputMode="tel" autoComplete="off" value={v.msisdn} onChange={(e) => set('msisdn', e.target.value)} data-autofocus />}
          </Field>
          <Field label="Full name" error={errors.name}>
            {(p) => <input {...p} type="text" autoComplete="off" value={v.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
          {v.role === 'merchant' && (
            <Field label="Business name" error={errors.businessName}>
              {(p) => <input {...p} type="text" autoComplete="off" value={v.businessName} onChange={(e) => set('businessName', e.target.value)} />}
            </Field>
          )}
          {v.role !== 'customer' && (
            <Field label="Owner’s ID number" hint="From the owner’s national ID or passport. Only that person can add this business to their EcoCash Super App." error={errors.ownerIdNumber}>
              {(p) => <input {...p} type="text" autoComplete="off" value={v.ownerIdNumber} onChange={(e) => set('ownerIdNumber', e.target.value)} />}
            </Field>
          )}
          <Field label="Initial PIN" hint="4 digits. Give it to the user privately; they should change it." error={errors.pin}>
            {(p) => (
              <input
                {...p}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={v.pin}
                onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            )}
          </Field>
        </fieldset>
        {serverError && (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        )}
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Add {ROLE_LABEL[v.role].toLowerCase()}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
