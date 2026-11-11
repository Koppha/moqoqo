import { useState, type FormEvent, type ReactNode } from 'react'
import type { AtmWithdrawal } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Icon, type IconName } from '../components/Icon'
import { Card, Field, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { formatMoney } from '../format'
import { formatMaseru } from '../time'

/** An input with an icon inside its left edge. */
const withIcon = (icon: IconName | 'M', input: ReactNode) => (
  <div className="input-icon">
    {icon === 'M' ? <span className="input-icon-mark" aria-hidden="true">M</span> : <Icon name={icon} size={16} />}
    {input}
  </div>
)

/** The ATMs the simulator can stand in for; Kingsway is the pilot until the switch lists them. */
const ATMS = ['Kingsway ATM, Maseru']

/**
 * Stands in for an EcoCash-enabled ATM until the ATM switch is connected: enter what the customer would enter at the
 * ATM (number, the code from the app, amount) and the "cash comes out". On the dashboard the form takes two columns.
 */
export function AtmSimulator({ wide = false }: { wide?: boolean }) {
  const { canWrite } = useAuth()
  const [msisdn, setMsisdn] = useState('')
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState('')
  const [atm, setAtm] = useState(ATMS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<AtmWithdrawal | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      setDone(await api.atm.redeem({ msisdn: msisdn.trim(), code: code.trim(), amount: Number(amount), atm: atm.trim() }))
      setCode('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const number = <Field label="Customer's number">{(p) => withIcon('phone', <input {...p} inputMode="tel" placeholder="e.g. 62000021" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} />)}</Field>
  const withdrawalCode = <Field label="Withdrawal code" hint="8 digits, shown in the customer's app">{(p) => withIcon('lock', <input {...p} className="mono" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />)}</Field>
  const amountField = <Field label="Amount (M)">{(p) => withIcon('M', <input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />)}</Field>
  const atmField = (
    <Field label="ATM">
      {(p) => withIcon('pin', (
        <>
          <select {...p} value={atm} onChange={(e) => setAtm(e.target.value)}>
            {ATMS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Icon name="chevronDown" size={16} className="input-icon-end" />
        </>
      ))}
    </Field>
  )

  return (
    <div className={wide ? 'grid-atm card-grid' : 'grid-2'}>
      <Card title="At the ATM" icon={wide ? 'atm' : 'receipt'} tone="blue" className={wide ? undefined : 'card-boxed'}>
        <form onSubmit={submit} noValidate>
          <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
            <legend className="sr-only">ATM</legend>
            {wide ? (
              <div className="grid-2 form-grid">
                {number}
                {amountField}
                {withdrawalCode}
                {atmField}
              </div>
            ) : (
              <>
                {number}
                {withdrawalCode}
                {amountField}
                {atmField}
              </>
            )}
            {error && <p className="field-error" role="alert">{error}</p>}
            <WriteButton type="submit" variant="primary" busy={busy}>Withdraw cash</WriteButton>
          </fieldset>
        </form>
      </Card>
      <Card title="Result" icon="infoMark" className="card-info">
        {done ? (
          <dl className="detail-list">
            <div><dt>Status</dt><dd><span className="chip chip-ok">Cash paid out</span></dd></div>
            <div><dt>Reference</dt><dd className="mono">{done.reference}</dd></div>
            <div><dt>Amount</dt><dd className="num">{formatMoney(done.amount)}</dd></div>
            <div><dt>Fee</dt><dd className="num">{formatMoney(done.fee)}</dd></div>
            <div><dt>When</dt><dd>{done.redeemedAt ? formatMaseru(done.redeemedAt) : ''}</dd></div>
          </dl>
        ) : (
          <p className="muted">The customer asks for cash in <span className="accent-text">EcoCash Super App (Services › ATM cash)</span>. The code is valid for 30 minutes; three wrong codes cancel it and the money goes back.</p>
        )}
      </Card>
    </div>
  )
}

export function AtmPage() {
  const { canWrite } = useAuth()
  return (
    <>
      <PageHeader title="ATM simulator" subtitle="For testing cardless ATM withdrawals until the ATM switch is connected. Enter what the customer would type at the ATM." />
      {!canWrite && <ReadOnlyNotice />}
      <AtmSimulator />
    </>
  )
}
