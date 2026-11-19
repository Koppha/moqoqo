// The sign-in event log (CBL/LCA DFS guidelines 3.2.5b-vi) and the payment-biometric token check. Kept apart from
// security.ts so pins.ts can use them without an import cycle.
import type { AuthEvent, AuthEventKind } from '../../../shared/api'
import type { Queryable } from '../db/index'
import { hashToken, newId } from '../lib/crypto'
import { iso } from '../lib/time'

export async function logAuthEvent(
  q: Queryable,
  e: { userId?: string | null; adminId?: string | null; kind: AuthEventKind; app?: string | null; ip?: string | null; detail?: string | null },
) {
  await q.query(
    'INSERT INTO auth_events (id, user_id, admin_id, kind, app, ip, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [newId(), e.userId ?? null, e.adminId ?? null, e.kind, e.app ?? null, e.ip ?? null, e.detail ?? null],
  ).catch(() => {}) // the log never blocks what it records
}

export async function listAuthEvents(q: Queryable, userId: string): Promise<AuthEvent[]> {
  const rows = await q.query<{ id: string; kind: AuthEventKind; app: string | null; ip: string | null; detail: string | null; created_at: Date }>(
    'SELECT * FROM auth_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [userId],
  )
  return rows.map((r) => ({ id: r.id, kind: r.kind, app: r.app, ip: r.ip, detail: r.detail, createdAt: iso(r.created_at) }))
}

/** A payment's "PIN" was a biometric token: valid when issued to this wallet and not revoked (its phone still bound). */
export async function payBiometricValid(q: Queryable, userId: string, token: string): Promise<boolean> {
  const [r] = await q.query(
    `SELECT 1 FROM pay_biometric_keys k LEFT JOIN bound_devices d ON d.id = k.bound_device_id
     WHERE k.token_hash = $1 AND k.user_id = $2 AND k.revoked_at IS NULL AND k.created_at > now() - interval '90 days'
       AND (k.bound_device_id IS NULL OR d.unbound_at IS NULL)`,
    [hashToken(token), userId],
  )
  return !!r
}

