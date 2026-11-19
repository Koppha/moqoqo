// People blocking people. Contract: shared/api.ts "blocking". A block (either way) stops messages, money, money
// requests and friend requests between the two, one to one; groups are unaffected. Only customers can be blocked:
// blocking a merchant or agent would break paying them. The blocked person is never told.
import type { BlockedUser } from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, notFound, validation } from '../errors'
import { iso } from '../lib/time'
import { getUsers, toPublicUser, type UserRow } from './users'

/** From `meId`'s side: did I block them, did they block me, or neither. */
export async function blockBetween(q: Queryable, meId: string, otherId: string): Promise<'i_blocked' | 'blocked_me' | null> {
  const rows = await q.query<{ blocker_id: string }>(
    'SELECT blocker_id FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
    [meId, otherId],
  )
  if (rows.some((r) => r.blocker_id === meId)) return 'i_blocked'
  return rows.length ? 'blocked_me' : null
}

/**
 * Refuses anything one to one between two people when either blocked the other. Checked before money moves (the
 * live ledger can't be rolled back) and again when a message is posted.
 */
export async function assertCanReach(q: Queryable, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return
  const block = await blockBetween(q, fromId, toId)
  if (block === 'i_blocked') throw new AppError('BLOCKED', 'You blocked this person. Unblock them to send messages, money or requests')
  if (block === 'blocked_me') throw new AppError('BLOCKED', "You can't send messages, money or requests to this person")
}

export async function listBlocks(q: Queryable, meId: string): Promise<BlockedUser[]> {
  const rows = await q.query<{ blocked_id: string; created_at: Date }>('SELECT blocked_id, created_at FROM user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC', [meId])
  const users = await getUsers(q, rows.map((r) => r.blocked_id))
  return rows.flatMap((r) => {
    const u = users.get(r.blocked_id)
    return u ? [{ user: toPublicUser(u), since: iso(r.created_at) }] : []
  })
}

/** Block a customer: also ends a friendship and declines open friend requests and money requests between the two. */
export async function blockUser(ctx: Ctx, me: UserRow, otherId: string): Promise<BlockedUser[]> {
  if (otherId === me.id) throw validation("You can't block yourself")
  const [other] = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND kind = 'person'`, [otherId])
  if (!other) throw notFound('Person not found')
  if (other.role !== 'customer') throw validation("Merchants and agents can't be blocked. To report one, contact EcoCash Support")
  await ctx.db.tx(async (q) => {
    await q.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, otherId])
    await q.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [me.id, otherId])
    await q.query(
      `UPDATE friend_requests SET status = 'declined' WHERE status = 'pending'
         AND ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))`,
      [me.id, otherId],
    )
    // Their open "pay me" and "pay this bill for me" requests to me close; mine to them stay mine to cancel.
    await q.query(
      `UPDATE requests SET status = 'declined' WHERE status = 'pending' AND kind IN ('money', 'bill') AND requester_id = $1 AND to_user_id = $2`,
      [otherId, me.id],
    )
  })
  return listBlocks(ctx.db, me.id)
}

export async function unblockUser(ctx: Ctx, me: UserRow, otherId: string): Promise<BlockedUser[]> {
  await ctx.db.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [me.id, otherId])
  return listBlocks(ctx.db, me.id)
}

/** Of these people, the ones the viewer blocked (for chat summaries). */
export async function blockedByViewer(q: Queryable, viewerId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await q.query<{ blocked_id: string }>('SELECT blocked_id FROM user_blocks WHERE blocker_id = $1 AND blocked_id = ANY($2)', [viewerId, ids])
  return new Set(rows.map((r) => r.blocked_id))
}
