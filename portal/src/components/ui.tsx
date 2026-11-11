import { createContext, useContext, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { MaintenanceStatus, UserStatus } from '../../../shared/api'
import { errorMessage, isApiError } from '../api'
import { READ_ONLY_REASON, useAuth } from '../auth'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'sm'
  busy?: boolean
}

export function Button({ variant = 'secondary', size = 'md', busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className ?? ''].join(' ').trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className="spinner spinner-inline" aria-hidden="true" />}
      {children}
    </button>
  )
}

/**
 * A button for a write action. For the read-only support role it stays focusable (so the
 * explanation is reachable by keyboard and screen readers) but is aria-disabled and inert.
 */
export function WriteButton({ onClick, type = 'button', ...props }: ButtonProps) {
  const { canWrite } = useAuth()
  const tipId = useId()
  if (canWrite) return <Button onClick={onClick} type={type} {...props} />
  return (
    <span className="tip-wrap">
      <Button
        {...props}
        type="button"
        disabled={false}
        busy={false}
        aria-disabled="true"
        aria-describedby={tipId}
        className={`${props.className ?? ''} is-readonly`}
        onClick={(e) => e.preventDefault()}
      />
      <span role="tooltip" id={tipId} className="tip">
        {READ_ONLY_REASON}
      </span>
    </span>
  )
}

/** Banner shown at the top of pages with write controls when the admin is read-only. */
export function ReadOnlyNotice() {
  const { canWrite } = useAuth()
  if (canWrite) return null
  return (
    <div className="notice notice-info" role="note">
      <Icon name="lock" size={18} />
      <span>
        You're signed in with a <strong>support</strong> account, which is read-only. Changes are disabled on this page.
      </span>
    </div>
  )
}

/** The top bar's title slot, set by the Layout. Outside the shell (tests, login) there is none. */
export const TitleSlot = createContext<HTMLElement | null>(null)

/**
 * The page's title and subtitle go into the top bar; actions stay at the top of the page. With `crumbs` the page has
 * its own header instead (breadcrumb, large title, subtitle, and a view switch or actions on the right), and the top
 * bar shows the section name.
 */
export function PageHeader({ title, subtitle, actions, crumbs, views }: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  crumbs?: string[]
  /** A ViewSwitch, top right. */
  views?: ReactNode
}) {
  const slot = useContext(TitleSlot)
  if (crumbs) return (
    <header className="page-intro">
      <div className="page-intro-text">
        <nav aria-label="Breadcrumb" className="crumbs">
          <ol>
            {crumbs.map((c) => <li key={c}>{c}</li>)}
          </ol>
        </nav>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {(views || actions) && <div className="page-intro-side">{views}{actions}</div>}
    </header>
  )
  const heading = (
    <div className="page-title">
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </div>
  )
  if (slot) return (
    <>
      {createPortal(heading, slot)}
      {actions && <div className="page-actions page-actions-solo">{actions}</div>}
    </>
  )
  return (
    <header className="page-header">
      {heading}
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, children, className, actions, icon, tone = 'purple' }: {
  title?: ReactNode
  children: ReactNode
  className?: string
  actions?: ReactNode
  /** Shown before the title, in the card's tone. */
  icon?: IconName
  tone?: 'purple' | 'teal' | 'blue'
}) {
  return (
    <section className={`card ${className ?? ''}`.trim()}>
      {(title || actions) && (
        <div className="card-head">
          {title && (
            <h2 className="card-title">
              {icon && <Icon name={icon} size={20} className={`card-icon tone-${tone}`} />}
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

const MAINT_LABEL: Record<MaintenanceStatus, string> = {
  scheduled: 'Scheduled',
  active: 'Active',
  ended: 'Ended',
  cancelled: 'Cancelled',
}

export function MaintenanceChip({ status }: { status: MaintenanceStatus }) {
  return <span className={`chip chip-${status}`}>{MAINT_LABEL[status]}</span>
}

export function UserStatusChip({ status }: { status: UserStatus }) {
  return <span className={`chip chip-${status === 'active' ? 'ok' : 'suspended'}`}>{status === 'active' ? 'Active' : 'Suspended'}</span>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const network = isApiError(error) && error.code === 'NETWORK'
  return (
    <div className="state state-error" role="alert">
      <Icon name={network ? 'wifiOff' : 'alert'} size={28} />
      <p className="state-title">{network ? "Can't reach the EcoCash Super App server" : 'Something went wrong'}</p>
      <p className="muted">{network ? 'Check your connection or VPN. The server may also be down.' : errorMessage(error)}</p>
      {onRetry && (
        <Button onClick={onRetry} size="sm">
          Try again
        </Button>
      )}
    </div>
  )
}

/** Picks loading / error / empty / content for a list. */
export function ListState<T>({
  loading,
  error,
  data,
  isEmpty,
  emptyTitle,
  emptyHint,
  onRetry,
  children,
}: {
  loading: boolean
  error: unknown
  data: T | undefined
  isEmpty: (d: T) => boolean
  emptyTitle: string
  emptyHint?: ReactNode
  onRetry: () => void
  children: (d: T) => ReactNode
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (data === undefined) return loading ? <Loading /> : null
  if (isEmpty(data)) return <Empty title={emptyTitle}>{emptyHint}</Empty>
  return <>{children(data)}</>
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  loading,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  loading?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted" aria-live="polite">
        {from}–{to} of {total}
        {loading ? ' · updating…' : ''}
      </span>
      <div className="pagination-btns">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span className="muted">
          Page {page} of {pages}
        </span>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          Next
        </Button>
      </div>
    </nav>
  )
}

/** Labelled form field with optional hint and error, wiring aria-describedby / aria-invalid. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  className?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className ?? ''}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errId}>
          {error}
        </p>
      )}
    </div>
  )
}

/** Segmented control built on native radio buttons (arrow keys work, one tab stop). */
export function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  hideLabel?: boolean
}) {
  return (
    <fieldset className="segmented-field">
      <legend className={hideLabel ? 'sr-only' : 'field-label'}>{label}</legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={o.value} className={value === o.value ? 'on' : ''}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
