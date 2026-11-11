import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from '../api'
import { Button } from './ui'
import { Icon } from './Icon'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog: role="dialog" + aria-modal, focus moves in on open and back on close,
 * Tab is trapped, Escape closes. Rendered into document.body.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  variant = 'modal',
}: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** "panel" slides in from the right (detail views). */
  variant?: 'modal' | 'panel'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    node?.addEventListener('keydown', onKey)
    document.body.classList.add('has-modal')
    return () => {
      node?.removeEventListener('keydown', onKey)
      document.body.classList.remove('has-modal')
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div className={`overlay overlay-${variant}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog dialog-${variant} dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        {description && (
          <p id={descId} className="dialog-desc">
            {description}
          </p>
        )}
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Confirmation for destructive or money-moving actions. Shows the failure inline if the action throws. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={title}
      description={message}
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy} data-autofocus>
            Keep as is
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={run} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
