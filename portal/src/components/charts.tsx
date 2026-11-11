import { Icon } from './Icon'

/**
 * A round top for the axis (1, 2, 2.5 or 5 × a power of ten, times 4 steps) so gridlines land on easy numbers.
 * Counts step in whole numbers: a top of 3 gives 0, 1, 2, 3, never 0.75.
 */
function niceTicks(max: number, whole: boolean): number[] {
  const top = Math.max(1, max)
  if (whole && top <= 4) return Array.from({ length: Math.ceil(top) + 1 }, (_, i) => i)
  const raw = top / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow
  const steps = whole && !Number.isInteger(step) ? Math.ceil(step) : step
  return [0, 1, 2, 3, 4].map((i) => i * steps)
}

/** 1500 → 1.5K, 2000000 → 2.0M; small numbers as they are. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 100) / 10}K`.replace('.0K', 'K')
  return n.toLocaleString('en')
}

/**
 * One series per day as bars, with a left axis on round numbers and light gridlines. Day labels under every bar up to
 * 31 days; beyond that, every few days. Hover a bar for its day and exact value.
 */
export function BarChart({ days, values, color, label, format = (n) => n.toLocaleString('en'), whole = true }: {
  days: string[]
  values: number[]
  color: 'purple' | 'teal'
  label: string
  format?: (n: number) => string
  /** Counts (people, payments): whole-number steps. Amounts pass false. */
  whole?: boolean
}) {
  const ticks = niceTicks(Math.max(0, ...values), whole)
  const top = ticks.at(-1) ?? 1
  const every = days.length <= 31 ? 1 : Math.ceil(days.length / 15)
  return (
    <div className={`barchart barchart-${color}`} role="img" aria-label={label}>
      <div className="barchart-axis" aria-hidden="true">
        {[...ticks].reverse().map((t) => <span key={t}>{compact(t)}</span>)}
      </div>
      <div className="barchart-plot">
        <div className="barchart-grid" aria-hidden="true">{ticks.map((t) => <span key={t} />)}</div>
        <div className="barchart-bars">
          {days.map((d, i) => (
            <div key={d} className="barchart-col" title={`${d}: ${format(values.at(i) ?? 0)}`}>
              <div className="barchart-bar" style={{ height: `${((values.at(i) ?? 0) / top) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="barchart-days" aria-hidden="true">
          {days.map((d, i) => <span key={d}>{i % every === 0 ? d.slice(8) : ''}</span>)}
        </div>
      </div>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS.at(Number(iso.slice(5, 7)) - 1) ?? ''}`

/**
 * The period as a chip ("27 Sep – 27 Oct 2026") that opens a choice of 7, 30, 90 or 365 days. A native select sits on
 * top of it, so keyboard and screen readers get a normal list.
 */
export function PeriodChip({ days, value, onChange, id }: { days: string[]; value: number; onChange: (n: number) => void; id: string }) {
  const first = days.at(0), last = days.at(-1)
  const text = first && last ? `${dayMonth(first)} – ${dayMonth(last)} ${last.slice(0, 4)}` : `Last ${value} days`
  return (
    <label className="period-chip" htmlFor={id}>
      <Icon name="calendar" size={15} />
      <span>{text}</span>
      <Icon name="chevronDown" size={14} />
      <select id={id} aria-label="Period" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
        <option value={365}>Last year</option>
      </select>
    </label>
  )
}
