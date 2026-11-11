// Building blocks for list pages in the "monitoring console" style: a view switch, count tabs, filter chips, a search
// box, a table card with a CSV button, and two-line times. Pages: Transactions, Users, Risk, Performance.
import { useState, type ReactNode } from 'react'
import { errorMessage } from '../api'
import { formatMaseru } from '../time'
import { Icon } from './Icon'
import { useToast } from './Toast'

export type Tone = 'red' | 'orange' | 'amber' | 'blue' | 'green' | 'purple' | 'grey'

/** Two or three views of one page ("Alerts | Rules"), top right of the page header. */
export function ViewSwitch<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="view-switch" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Joined buttons with counts: "Customers 120 | Agents 4 | All 130". */
export function CountTabs<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: readonly { value: T; label: string; count?: number }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="count-tabs" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="count-tabs-n">{o.count.toLocaleString('en')}</span>}
        </button>
      ))}
    </div>
  )
}

/** "Kind  All ▾": a chip with a native select on top, so keyboards and screen readers get a normal list. */
export function FilterChip<T extends string>({ id, label, value, options, onChange, allLabel = 'All' }: {
  id: string
  label: string
  value: T | ''
  options: readonly { value: T; label: string; count?: number }[]
  onChange: (v: T | '') => void
  allLabel?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <label className={`filter-chip${value ? ' filter-chip-on' : ''}`} htmlFor={id}>
      <span className="filter-chip-label">{label}</span>
      <span className="filter-chip-value">{current?.label ?? allLabel}</span>
      <Icon name="chevronDown" size={14} />
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T | '')}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.count !== undefined ? ` (${o.count})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A toggle chip with a coloured dot and a count: "● Critical 32". */
export function DotChip({ tone, label, count, active, onClick }: { tone: Tone; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`dot-chip tone-text-${tone}`} aria-pressed={active} onClick={onClick}>
      <span className={`dot dot-${tone}`} aria-hidden="true" />
      {label}
      {count !== undefined && <span className="dot-chip-n">{count.toLocaleString('en')}</span>}
    </button>
  )
}

export function SearchBox({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-box" role="search">
      <Icon name="search" size={16} />
      <input id={id} type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/** The filter area under the page header: rows of chips and the search box. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>
}

/** "Active alarms  124 alarms        [CSV]" above a full-width table. */
export function TableCard({ title, count, unit, actions, children }: { title: string; count?: number; unit?: [string, string]; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="table-card">
      <div className="table-card-head">
        <h2>{title}</h2>
        {count !== undefined && (
          <span className="table-card-count">
            {count.toLocaleString('en')} {unit ? (count === 1 ? unit[0] : unit[1]) : ''}
          </span>
        )}
        <div className="table-card-actions">{actions}</div>
      </div>
      {children}
    </section>
  )
}

/** A coloured word with a dot in front: "● Critical". */
export function Dot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`dot-text tone-text-${tone}`}>
      <span className={`dot dot-${tone}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** A small outlined label: "Service affecting", "Link". */
export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}

const UNITS: [number, string][] = [[86_400_000, 'day'], [3_600_000, 'hour'], [60_000, 'minute']]
/** "26 days ago", "3 hours ago", "just now". */
export function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso)
  for (const [size, unit] of UNITS) {
    const n = Math.floor(ms / size)
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

/** "Tue 3 Nov 2026, 15:41" over "26 days ago". */
export function When({ iso }: { iso: string }) {
  return (
    <>
      <div className="nowrap">{formatMaseru(iso)}</div>
      <div className="muted small">{ago(iso)}</div>
    </>
  )
}

type Cell = string | number | null | undefined
const csvCell = (v: Cell) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Saves rows as a CSV file (UTF-8 with a BOM, so Excel shows Sesotho names and "M" amounts correctly). */
export function downloadCsv(filename: string, rows: Cell[][]) {
  const text = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Pages through a list (100 at a time, up to `max`) so CSV exports hold every match, not just the page on screen. */
export async function fetchAll<T>(load: (page: number) => Promise<{ items: T[]; total: number }>, max = 10_000): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; out.length < max; page++) {
    const p = await load(page)
    out.push(...p.items)
    if (!p.items.length || out.length >= p.total) break
  }
  return out.slice(0, max)
}

/** "⤓ CSV": builds the rows when pressed (all matches, with the filters on screen). */
export function CsvButton({ filename, rows }: { filename: string; rows: () => Promise<Cell[][]> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm csv-btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          downloadCsv(filename, await rows())
        } catch (err) {
          toast.error(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <Icon name="download" size={16} /> {busy ? 'Preparing…' : 'CSV'}
    </button>
  )
}
