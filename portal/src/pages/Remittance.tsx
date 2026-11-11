import { useState, type FormEvent } from 'react'
import { MAX_TRANSACTION, REMIT_PAYOUTS, type RemitCorridor, type RemitPayout, type RemitSettings } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Card, Empty, ErrorState, Field, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatMoney, formatMsisdn } from '../format'
import { formatMaseru } from '../time'
import { useAsync } from '../useAsync'

const PAYOUT_LABEL: Record<RemitPayout, string> = { mobile: 'Mobile wallet', bank: 'Bank account', cash: 'Cash pick-up' }
const NUMBER_FIELDS = ['rate', 'fee', 'feePercent', 'max'] as const
type NumberField = (typeof NUMBER_FIELDS)[number]

/** A corridor as typed in the form (numbers stay text until saved). */
type Row = Omit<RemitCorridor, NumberField> & Record<NumberField, string>

const toRow = (c: RemitCorridor): Row => ({ ...c, rate: String(c.rate), fee: String(c.fee), feePercent: String(c.feePercent), max: String(c.max) })
const blankRow = (): Row => ({ code: '', country: '', currency: '', rate: '1', fee: '0', feePercent: '0', max: '5000', payouts: ['mobile'], enabled: false })
const twoDecimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6

/** Checks the form; returns the body to save, or the first problem in plain words. */
export function validateRemit(rows: Row[], dailyRaw: string): { body: RemitSettings | null; error: string | null } {
  const dailyMax = Number(dailyRaw.trim())
  if (!dailyRaw.trim() || !Number.isFinite(dailyMax) || dailyMax <= 0 || !twoDecimals(dailyMax)) return { body: null, error: 'Daily maximum: enter an amount in maloti.' }
  const corridors: RemitCorridor[] = []
  const seen = new Set<string>()
  for (const [i, r] of rows.entries()) {
    const label = r.country.trim() || `Row ${i + 1}`
    const code = r.code.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) return { body: null, error: `${label}: the country code is 2 letters, e.g. ZA.` }
    if (seen.has(code)) return { body: null, error: `${label}: ${code} is listed twice.` }
    seen.add(code)
    if (r.country.trim().length < 2) return { body: null, error: `Row ${i + 1}: enter the country name.` }
    const currency = r.currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return { body: null, error: `${label}: the currency is 3 letters, e.g. ZAR.` }
    const n = Object.fromEntries(NUMBER_FIELDS.map((f) => [f, Number(r[f].trim())])) as Record<NumberField, number>
    if (NUMBER_FIELDS.some((f) => !r[f].trim() || !Number.isFinite(n[f]))) return { body: null, error: `${label}: rate, fee, fee % and maximum must be numbers.` }
    if (n.rate <= 0) return { body: null, error: `${label}: the rate must be more than 0.` }
    if (n.fee < 0 || n.fee > 1000 || !twoDecimals(n.fee)) return { body: null, error: `${label}: the fee is M0 to M1,000, at most 2 decimals.` }
    if (n.feePercent < 0 || n.feePercent > 20) return { body: null, error: `${label}: the fee % is 0 to 20.` }
    if (n.max <= 0 || n.max > MAX_TRANSACTION || !twoDecimals(n.max)) return { body: null, error: `${label}: the maximum is up to M${MAX_TRANSACTION.toLocaleString('en')}.` }
    if (n.max > dailyMax) return { body: null, error: `${label}: the maximum can't be more than the daily maximum.` }
    if (r.enabled && r.payouts.length === 0) return { body: null, error: `${label}: tick at least one way to receive the money.` }
    corridors.push({ code, country: r.country.trim(), currency, ...n, payouts: r.payouts, enabled: r.enabled })
  }
  return { body: { dailyMax, corridors }, error: null }
}

function CorridorsForm({ settings, onSaved }: { settings: RemitSettings; onSaved: (s: RemitSettings) => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>(() => settings.corridors.map(toRow))
  const [daily, setDaily] = useState(String(settings.dailyMax))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (i: number, patch: Partial<Row>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const togglePayout = (i: number, p: RemitPayout, on: boolean) =>
    set(i, { payouts: REMIT_PAYOUTS.filter((x) => (x === p ? on : rows[i].payouts.includes(x))) })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canWrite) return
    const r = validateRemit(rows, daily)
    setError(r.error)
    if (!r.body) return
    setBusy(true)
    try {
      const saved = await api.remit.put(r.body)
      toast.success('Remittance countries saved. The app shows them the next time the screen opens.')
      onSaved(saved)
      setRows(saved.corridors.map(toRow))
      setDaily(String(saved.dailyMax))
    } catch (err) {
      setError(errorMessage(err))
      toast.error(`Couldn't save: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Countries, rates & fees" icon="send">
      <p className="muted small">
        Placeholder values until the remittance partner and tariff are agreed. Rate = how much of the country's currency the recipient gets for M1.
        Fee = flat fee plus a percentage of the amount, paid by the sender on top. Only switched-on countries appear in the app.
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset className="plain-fieldset" disabled={!canWrite || busy}>
          <legend className="sr-only">Remittance countries</legend>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Remittance countries</caption>
              <thead>
                <tr>
                  <th scope="col">On</th>
                  <th scope="col">Code</th>
                  <th scope="col">Country</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Rate per M1</th>
                  <th scope="col">Fee (M)</th>
                  <th scope="col">Fee %</th>
                  <th scope="col">Max (M)</th>
                  <th scope="col">Recipient receives by</th>
                  <th scope="col"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" aria-label={`${r.country || 'Country'} switched on`} checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} /></td>
                    <td><input aria-label="Country code" className="mono" size={3} maxLength={2} value={r.code} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} /></td>
                    <td><input aria-label="Country name" value={r.country} onChange={(e) => set(i, { country: e.target.value })} /></td>
                    <td><input aria-label="Currency" className="mono" size={4} maxLength={3} value={r.currency} onChange={(e) => set(i, { currency: e.target.value.toUpperCase() })} /></td>
                    {NUMBER_FIELDS.map((f) => (
                      <td key={f}><input aria-label={f} inputMode="decimal" size={7} value={r[f]} onChange={(e) => set(i, { [f]: e.target.value } as Partial<Row>)} /></td>
                    ))}
                    <td className="nowrap">
                      {REMIT_PAYOUTS.map((p) => (
                        <label key={p} className="check">
                          <input type="checkbox" checked={r.payouts.includes(p)} onChange={(e) => togglePayout(i, p, e.target.checked)} /> {PAYOUT_LABEL[p]}
                        </label>
                      ))}
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((list) => list.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows((list) => [...list, blankRow()])}>Add a country</button>
          <div className="grid-2">
            <Field label="Daily maximum (M)" hint="Per wallet per day, all countries together.">
              {(p) => <input {...p} inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />}
            </Field>
          </div>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <WriteButton type="submit" variant="primary" busy={busy}>Save countries</WriteButton>
        </div>
      </form>
    </Card>
  )
}

function Recent() {
  const list = useAsync(() => api.remit.recent(), [])
  return (
    <Card title="Recent remittances" icon="receipt">
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
        <Empty title="No remittances yet">Money customers send abroad appears here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Recent remittances</caption>
            <thead>
              <tr>
                <th scope="col">Time (Maseru)</th>
                <th scope="col">Reference</th>
                <th scope="col">Sender</th>
                <th scope="col">Recipient</th>
                <th scope="col">Country</th>
                <th scope="col">By</th>
                <th scope="col">Amount</th>
                <th scope="col">Fee</th>
                <th scope="col">They receive</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{formatMaseru(r.createdAt)}</td>
                  <td className="mono small">{r.reference}</td>
                  <td>{r.sender.name}{r.sender.msisdn ? <span className="muted small"> · {formatMsisdn(r.sender.msisdn)}</span> : null}</td>
                  <td>{r.recipientName}<div className="muted small">{r.payout === 'bank' ? `${r.bankName} ••${(r.accountNumber ?? '').slice(-4)}` : r.recipientPhone}</div></td>
                  <td>{r.countryName}</td>
                  <td>{PAYOUT_LABEL[r.payout]}</td>
                  <td className="num">{formatMoney(r.amount)}</td>
                  <td className="num">{formatMoney(r.fee)}</td>
                  <td className="num nowrap">{r.currency} {r.receiveAmount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td><span className={`chip ${r.status === 'completed' ? 'chip-ok' : r.status === 'failed' ? 'chip-suspended' : 'chip-warn'}`}>{r.status === 'submitted' ? 'Waiting for pick-up' : r.status === 'completed' ? 'Paid' : 'Failed'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function RemittancePage() {
  const settings = useAsync(() => api.remit.get(), [])
  return (
    <>
      <PageHeader title="Remittance" subtitle="Sending money abroad: which countries, the exchange rates, fees and limits, and recent transfers." />
      <ReadOnlyNotice />
      {settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} /> : !settings.data ? <Loading /> : (
        <CorridorsForm settings={settings.data} onSaved={(s) => settings.setData(() => s)} />
      )}
      <div className="settings-section">
        <Recent />
      </div>
    </>
  )
}
