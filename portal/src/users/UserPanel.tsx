import { useState, type FormEvent } from 'react'
import { APP_NAMES, type AdminUser, type BoundDevice } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { Button, ErrorState, Field, Loading, UserStatusChip, WriteButton } from '../components/ui'
import { formatMoney, formatMsisdn, parseAmount, ROLE_LABEL } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'
import { normaliseOwnerId, validateOwnerId, validatePin } from './AddUserDialog'

type Action = 'status' | 'pin' | 'float' | 'owner' | null

/** Side panel with one user's details and admin actions. */
export function UserPanel({ user: initial, onClose, onChanged }: { user: AdminUser; onClose: () => void; onChanged: (u: AdminUser) => void }) {
  const toast = useToast()
  const fresh = useAsync(() => api.users.get(initial.id), [initial.id])
  // Recent activity: the transactions list filtered to this user.
  const recent = useAsync(() => api.transactions({ userId: initial.id, page: 1 }), [initial.id])
  const user = fresh.data ?? initial
  const [action, setAction] = useState<Action>(null)

  const changed = (u: AdminUser) => {
    fresh.setData(() => u)
    onChanged(u)
  }

  const suspended = user.status === 'suspended'

  return (
    <Dialog title={user.name} description={`${ROLE_LABEL[user.role]} · ${formatMsisdn(user.msisdn)}`} onClose={onClose} variant="panel">
      {fresh.error ? <ErrorState error={fresh.error} onRetry={fresh.reload} /> : null}
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <UserStatusChip status={user.status} />
          </dd>
        </div>
        <div>
          <dt>Balance{user.role === 'agent' ? ' (float)' : ''}</dt>
          <dd className="num">{formatMoney(user.balance)}</dd>
        </div>
        {user.code && (
          <div>
            <dt>Code</dt>
            <dd>{user.code}</dd>
          </div>
        )}
        {user.businessName && (
          <div>
            <dt>Business name</dt>
            <dd>{user.businessName}</dd>
          </div>
        )}
        {user.role !== 'customer' && (
          <div>
            <dt>Owner’s ID</dt>
            <dd>{user.ownerIdNumber ?? <span className="muted">Not recorded: nobody can add this business to EcoCash Super App</span>}</dd>
          </div>
        )}
        <div>
          <dt>KYC tier</dt>
          <dd>{user.kycTier}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatMaseru(user.createdAt)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{user.lastSeenAt ? formatMaseru(user.lastSeenAt) : 'Never'}</dd>
        </div>
      </dl>

      <div className="panel-actions">
        <WriteButton variant={suspended ? 'primary' : 'danger'} onClick={() => setAction('status')}>
          {suspended ? 'Reactivate' : 'Suspend'}
        </WriteButton>
        <WriteButton onClick={() => setAction('pin')}>Reset PIN</WriteButton>
        {user.role !== 'customer' && <WriteButton onClick={() => setAction('owner')}>Owner’s ID</WriteButton>}
        {user.role === 'agent' && (
          <WriteButton variant="primary" onClick={() => setAction('float')}>
            Top up float
          </WriteButton>
        )}
      </div>
      {user.code && <PosterPrint userId={user.id} />}
      <StatementPrint userId={user.id} />

      <PhonesSection userId={user.id} />

      <h3 className="panel-subtitle">Recent transactions</h3>
      {recent.error ? (
        <ErrorState error={recent.error} onRetry={recent.reload} />
      ) : !recent.data ? (
        <Loading />
      ) : recent.data.items.length === 0 ? (
        <p className="muted">No transactions yet.</p>
      ) : (
        <ul className="mini-list">
          {recent.data.items.slice(0, 8).map((t) => {
            const out = t.from?.id === user.id
            return (
              <li key={t.id}>
                <div>
                  <span>{t.description || t.kind}</span>
                  <span className="muted small">
                    {formatMaseru(t.createdAt)} · {t.reference}
                  </span>
                </div>
                <span className={`num ${out ? 'neg' : 'pos'}`}>
                  {out ? '−' : '+'}
                  {formatMoney(t.amount)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {action === 'status' && (
        <ConfirmDialog
          title={suspended ? `Reactivate ${user.name}?` : `Suspend ${user.name}?`}
          message={
            suspended
              ? 'They will be able to sign in and move money again.'
              : 'They will be signed out and blocked from sending, receiving or withdrawing money until reactivated.'
          }
          confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
          danger={!suspended}
          onConfirm={async () => {
            try {
              const u = await api.users.update(user.id, { status: suspended ? 'active' : 'suspended' })
              changed(u)
              toast.success(suspended ? `${u.name} reactivated.` : `${u.name} suspended.`)
            } catch (e) {
              toast.error(`Couldn't update ${user.name}: ${errorMessage(e)}`)
              throw e
            }
          }}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'pin' && <ResetPinDialog user={user} onClose={() => setAction(null)} />}
      {action === 'float' && <FloatDialog user={user} onClose={() => setAction(null)} onDone={changed} />}
      {action === 'owner' && <OwnerIdDialog user={user} onClose={() => setAction(null)} onDone={changed} />}
    </Dialog>
  )
}

/** Today in Maseru (UTC+2) as YYYY-MM-DD. */
const maseruToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10)

/** Account statement for any period up to 12 months: opens the A4 page and the browser's print dialog (or Save as PDF). */
function StatementPrint({ userId }: { userId: string }) {
  const toast = useToast()
  const [from, setFrom] = useState(() => `${maseruToday().slice(0, 8)}01`)
  const [to, setTo] = useState(maseruToday)
  const [lang, setLang] = useState<'en' | 'st'>('en')
  const [busy, setBusy] = useState(false)
  const print = async () => {
    const w = window.open('', '_blank')
    setBusy(true)
    try {
      const html = await api.users.statement(userId, from, to, lang)
      if (!w) throw new Error('Allow pop-ups for the portal to print')
      w.document.open()
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 600)
    } catch (err) {
      w?.close()
      toast.error(err instanceof Error && !('status' in err) ? err.message : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="poster-row">
      <h3 className="panel-subtitle">Statement</h3>
      <p className="muted small">Every transaction in the period with opening, closing and running balance. Print it, or choose Save as PDF.</p>
      <div className="row-gap">
        <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" aria-label="To" value={to} min={from} max={maseruToday()} onChange={(e) => setTo(e.target.value)} />
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'st')}>
          <option value="en">English</option>
          <option value="st">Sesotho</option>
        </select>
        <Button variant="primary" busy={busy} disabled={!from || !to || from > to} onClick={print}>Print statement</Button>
      </div>
    </div>
  )
}

/** Branded QR print-out for the till or counter: opens the page and the browser's print dialog. */
function PosterPrint({ userId }: { userId: string }) {
  const toast = useToast()
  const [size, setSize] = useState<'a4' | 'a5' | 'a6'>('a5')
  const [busy, setBusy] = useState(false)
  const print = async () => {
    const w = window.open('', '_blank')
    setBusy(true)
    try {
      const html = await api.users.poster(userId, size)
      if (!w) throw new Error('Allow pop-ups for the portal to print')
      w.document.open()
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 600)
    } catch (err) {
      w?.close()
      toast.error(err instanceof Error && !('status' in err) ? err.message : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="poster-row">
      <h3 className="panel-subtitle">QR print-out</h3>
      <p className="muted small">Branded poster with the QR code customers scan (and the code they can type).</p>
      <div className="row-gap">
        <select aria-label="Paper size" value={size} onChange={(e) => setSize(e.target.value as 'a4' | 'a5' | 'a6')}>
          <option value="a4">A4 poster</option>
          <option value="a5">A5 counter card</option>
          <option value="a6">A6 sticker</option>
        </select>
        <Button variant="primary" busy={busy} onClick={print}>Print QR poster</Button>
      </div>
    </div>
  )
}

/** The phone the wallet is bound to, earlier phones, and Unbind (the phone is signed out and must be set up again). */
function PhonesSection({ userId }: { userId: string }) {
  const toast = useToast()
  const phones = useAsync(() => api.users.devices(userId), [userId])
  const [confirming, setConfirming] = useState<BoundDevice | null>(null)
  const unbind = async (d: BoundDevice) => {
    try {
      const next = await api.users.unbind(userId, d.id)
      phones.setData(() => next)
      toast.success(`${d.model} unbound. The customer must set EcoCash Super App up again (ID check and OTP).`)
    } catch (err) {
      toast.error(errorMessage(err))
      phones.reload()
    } finally {
      setConfirming(null)
    }
  }
  return (
    <>
      <h3 className="panel-subtitle">Phones</h3>
      {phones.error ? <ErrorState error={phones.error} onRetry={phones.reload} /> : !phones.data ? <Loading /> : phones.data.length === 0 ? (
        <p className="muted">Not set up on any phone yet.</p>
      ) : (
        <ul className="mini-list">
          {phones.data.map((d) => (
            <li key={d.id}>
              <div>
                <span>{d.model} <span className="muted small">· {d.platform === 'ios' ? 'iPhone' : 'Android'} {d.osVersion} · {APP_NAMES[d.app]} {d.appVersion}</span></span>
                <span className="muted small">
                  Bound {formatMaseru(d.boundAt)}
                  {d.unboundAt ? ` · ${d.unboundReason === 'removed_by_staff' ? 'unbound by staff' : 'replaced by another phone'} ${formatMaseru(d.unboundAt)}` : d.lastSeenAt ? ` · last used ${formatMaseru(d.lastSeenAt)}` : ''}
                </span>
              </div>
              {d.unboundAt ? <span className="chip chip-neutral">Earlier</span> : <WriteButton size="sm" variant="danger" onClick={() => setConfirming(d)}>Unbind</WriteButton>}
            </li>
          ))}
        </ul>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Unbind ${confirming.model}?`}
          message="The phone is signed out at once. To use EcoCash Super App again the customer sets it up on a phone with their Econet SIM: number, PIN, ID check and an SMS code."
          confirmLabel="Unbind phone"
          danger
          onConfirm={() => unbind(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  )
}

function ResetPinDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ pin?: string; confirm?: string }>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    const p = validatePin(pin)
    if (p) errs.pin = p
    else if (confirm !== pin) errs.confirm = "The PINs don't match."
    setErrors(errs)
    if (errs.pin || errs.confirm) return
    setBusy(true)
    setServerError(null)
    try {
      await api.users.resetPin(user.id, { pin })
      toast.success(`PIN reset for ${user.name}.`)
      onClose()
    } catch (err) {
      setServerError(errorMessage(err))
      toast.error(`Couldn't reset the PIN: ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  const pinInput = (value: string, onChange: (v: string) => void) => (p: { id: string }) => (
    <input {...p} type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} />
  )

  return (
    <Dialog title={`Reset PIN for ${user.name}`} description="Set a new 4-digit PIN and give it to the user privately. Their lock-outs are cleared." onClose={onClose} size="sm">
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={busy}>
          <legend className="sr-only">New PIN</legend>
          <Field label="New PIN" error={errors.pin}>
            {pinInput(pin, setPin)}
          </Field>
          <Field label="Repeat new PIN" error={errors.confirm}>
            {pinInput(confirm, setConfirm)}
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
            Reset PIN
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Records who owns an agent or merchant account. A different owner ends the old owner's access from EcoCash Super App. */
function OwnerIdDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const toast = useToast()
  const [value, setValue] = useState(user.ownerIdNumber ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const err = validateOwnerId(value)
    setError(err)
    if (err) return
    setBusy(true)
    try {
      const u = await api.users.update(user.id, { ownerIdNumber: normaliseOwnerId(value) })
      onDone(u)
      toast.success(u.ownerIdNumber ? `Owner’s ID recorded for ${u.businessName ?? u.name}.` : `Owner’s ID cleared for ${u.businessName ?? u.name}.`)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Owner of ${user.businessName ?? user.name}`} description="The owner adds this business to their EcoCash Super App with their verified ID and the business PIN. Changing it removes the previous owner’s access." onClose={busy ? () => {} : onClose} size="sm">
      <form onSubmit={submit} noValidate>
        <Field label="Owner’s ID number" hint="As on the national ID or passport. Leave empty to clear." error={error}>
          {(p) => <input {...p} type="text" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />}
        </Field>
        <div className="dialog-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}

function FloatDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({})
  const [confirming, setConfirming] = useState<number | null>(null)

  const review = (e: FormEvent) => {
    e.preventDefault()
    const n = parseAmount(amount)
    const errs: typeof errors = {}
    if (n === null) errs.amount = 'Enter an amount in maloti, e.g. 5000 or 2500.50.'
    if (!note.trim()) errs.note = 'Add a note, e.g. the bank deposit reference.'
    setErrors(errs)
    if (n !== null && !errs.note) setConfirming(n)
  }

  if (confirming !== null) {
    return (
      <ConfirmDialog
        title={`Credit ${formatMoney(confirming)} to ${user.name}?`}
        message={`Agent float goes from ${formatMoney(user.balance)} to ${formatMoney(user.balance + confirming)}. Note: “${note.trim()}”.`}
        confirmLabel={`Credit ${formatMoney(confirming)}`}
        onConfirm={async () => {
          try {
            const u = await api.users.float(user.id, { amount: confirming, note: note.trim() })
            onDone(u)
            toast.success(`${formatMoney(confirming)} float credited to ${u.name}.`)
          } catch (e) {
            toast.error(`Float top-up failed: ${errorMessage(e)}`)
            throw e
          }
        }}
        onClose={onClose}
      />
    )
  }

  return (
    <Dialog title={`Top up float for ${user.name}`} description={`Current float: ${formatMoney(user.balance)}. Use after the agent's bank deposit has cleared.`} onClose={onClose} size="sm">
      <form onSubmit={review} noValidate>
        <Field label="Amount (maloti)" error={errors.amount}>
          {(p) => <input {...p} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Note" hint="Recorded in the audit log." error={errors.note}>
          {(p) => <input {...p} type="text" value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="dialog-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Review top-up
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
