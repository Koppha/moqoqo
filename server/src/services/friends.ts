// Friends, message requests, SMS invites and group invites. Contract: shared/api.ts "friends, invites, groups".
import {
  GROUP_MAX_MEMBERS,
  INVITES_PER_DAY,
  toMsisdn,
  type ChatSummary,
  type ContactMatch,
  type FriendRelation,
  type FriendRequest,
  type FriendRequestBody,
  type FriendsOverview,
  type GroupInvite,
  type MessagePolicy,
} from '../../../shared/api'
import type { Ctx } from '../context'
import type { Queryable } from '../db/index'
import { AppError, conflict, forbidden, notFound, validation } from '../errors'
import { newId } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { iso } from '../lib/time'
import type { Outbox } from '../realtime/outbox'
import { announceChat, chatSummaries, createGroup } from './chats'
import { displayName, getUsers, requireByNumberOrUsername, toPublicUser, type UserRow } from './users'

interface RequestRow { id: string; from_user_id: string; to_user_id: string; status: string; created_at: Date }

export async function areFriends(q: Queryable, a: string, b: string): Promise<boolean> {
  const [row] = await q.query('SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2', [a, b])
  return !!row
}

export async function relationOf(q: Queryable, meId: string, otherId: string): Promise<FriendRelation> {
  if (meId === otherId) return 'self'
  if (await areFriends(q, meId, otherId)) return 'friend'
  const [r] = await q.query<{ from_user_id: string }>(
    `SELECT from_user_id FROM friend_requests WHERE status = 'pending' AND ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))`,
    [meId, otherId],
  )
  return r ? (r.from_user_id === meId ? 'outgoing' : 'incoming') : 'none'
}

/** Friends both ways; any message requests between them become ordinary chats. */
async function makeFriends(q: Queryable, a: string, b: string) {
  await q.query('INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [a, b])
  await q.query(
    `UPDATE chat_members cm SET request_status = NULL FROM chats c
      WHERE c.id = cm.chat_id AND c.kind = 'direct' AND c.pair_key = $1 AND cm.request_status IS NOT NULL`,
    [`direct:${[a, b].sort().join(':')}`],
  )
}

async function toRequests(q: Queryable, rows: RequestRow[]): Promise<FriendRequest[]> {
  const users = await getUsers(q, rows.flatMap((r) => [r.from_user_id, r.to_user_id]))
  return rows.flatMap((r) => {
    const from = users.get(r.from_user_id)
    const to = users.get(r.to_user_id)
    return from && to ? [{ id: r.id, from: toPublicUser(from), to: toPublicUser(to), createdAt: iso(r.created_at) }] : []
  })
}

export async function friendsOverview(q: Queryable, me: UserRow): Promise<FriendsOverview> {
  const friends = await q.query<UserRow>(
    `SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1 AND u.status = 'active' ORDER BY lower(coalesce(u.business_name, u.name))`,
    [me.id],
  )
  const pending = await q.query<RequestRow>(
    `SELECT * FROM friend_requests WHERE status = 'pending' AND (to_user_id = $1 OR from_user_id = $1) ORDER BY created_at DESC`,
    [me.id],
  )
  const invites = await q.query<{ id: string; chat_id: string; title: string | null; invited_by: string; created_at: Date; members: number }>(
    `SELECT gi.id, gi.chat_id, c.title, gi.invited_by, gi.created_at,
            (SELECT count(*)::int FROM chat_members cm WHERE cm.chat_id = gi.chat_id) AS members
       FROM group_invites gi JOIN chats c ON c.id = gi.chat_id
      WHERE gi.user_id = $1 AND gi.status = 'pending' AND c.deleted_at IS NULL ORDER BY gi.created_at DESC`,
    [me.id],
  )
  const inviters = await getUsers(q, invites.map((i) => i.invited_by))
  const [{ n }] = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM chat_members WHERE user_id = $1 AND request_status = 'pending'`, [me.id])
  return {
    friends: friends.map(toPublicUser),
    incoming: await toRequests(q, pending.filter((r) => r.to_user_id === me.id)),
    outgoing: await toRequests(q, pending.filter((r) => r.from_user_id === me.id)),
    groupInvites: invites.flatMap((i): GroupInvite[] => {
      const from = inviters.get(i.invited_by)
      return from ? [{ id: i.id, chatId: i.chat_id, title: i.title ?? 'Group', from: toPublicUser(from), memberCount: i.members, createdAt: iso(i.created_at) }] : []
    }),
    messageRequests: n,
  }
}

async function findPerson(q: Queryable, body: FriendRequestBody): Promise<UserRow> {
  let user: UserRow | undefined
  if (body.userId) [user] = await q.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND kind = 'person'`, [body.userId])
  else if (body.username || body.msisdn) user = await requireByNumberOrUsername(q, (body.username ?? body.msisdn)!)
  else throw validation('Give a number, a username or a QR code')
  if (!user || user.status !== 'active') throw notFound('No one with that number or QR code uses EcoCash')
  return user
}

/** Sends a request; when they had asked you already, you become friends at once. */
export async function requestFriend(ctx: Ctx, me: UserRow, body: FriendRequestBody): Promise<FriendRequest | { accepted: true }> {
  const other = await findPerson(ctx.db, body)
  if (other.id === me.id) throw validation('That’s you')
  return ctx.tx(async (q, out) => {
    const relation = await relationOf(q, me.id, other.id)
    if (relation === 'friend') throw conflict(`You and ${displayName(other)} are already friends`)
    if (relation === 'outgoing') throw conflict(`You already asked ${displayName(other)}. Waiting for them to accept`)
    if (relation === 'incoming') {
      await q.query(`UPDATE friend_requests SET status = 'accepted', responded_at = now() WHERE status = 'pending' AND from_user_id = $1 AND to_user_id = $2`, [other.id, me.id])
      await makeFriends(q, me.id, other.id)
      notifyAccepted(out, me, other.id)
      return { accepted: true as const }
    }
    const id = newId()
    await q.query('INSERT INTO friend_requests (id, from_user_id, to_user_id) VALUES ($1, $2, $3)', [id, me.id, other.id])
    out.notify({
      userIds: [other.id],
      category: 'chats',
      title: 'Friend request',
      body: `${displayName(me)} wants to be friends on EcoCash Super App.`,
      data: { screen: 'friends' },
    })
    const [r] = await q.query<RequestRow>('SELECT * FROM friend_requests WHERE id = $1', [id])
    return (await toRequests(q, [r]))[0]
  })
}

function notifyAccepted(out: Outbox, me: UserRow, otherId: string) {
  out.notify({ userIds: [otherId], category: 'chats', title: 'Friend request accepted', body: `You and ${displayName(me)} are now friends.`, data: { screen: 'friends' } })
}

export async function respondToRequest(ctx: Ctx, me: UserRow, requestId: string, accept: boolean): Promise<void> {
  await ctx.tx(async (q, out) => {
    const [r] = await q.query<RequestRow>(`SELECT * FROM friend_requests WHERE id = $1 AND to_user_id = $2 AND status = 'pending' FOR UPDATE`, [requestId, me.id])
    if (!r) throw notFound('That request is no longer waiting')
    await q.query('UPDATE friend_requests SET status = $2, responded_at = now() WHERE id = $1', [requestId, accept ? 'accepted' : 'declined'])
    if (!accept) return
    await makeFriends(q, me.id, r.from_user_id)
    notifyAccepted(out, me, r.from_user_id)
  })
}

export async function cancelRequest(ctx: Ctx, me: UserRow, requestId: string): Promise<void> {
  const done = await ctx.db.query(`UPDATE friend_requests SET status = 'cancelled', responded_at = now() WHERE id = $1 AND from_user_id = $2 AND status = 'pending' RETURNING 1`, [requestId, me.id])
  if (!done.length) throw notFound('That request is no longer waiting')
}

export async function unfriend(ctx: Ctx, me: UserRow, friendId: string): Promise<void> {
  const gone = await ctx.db.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1) RETURNING 1', [me.id, friendId])
  if (!gone.length) throw notFound('Not a friend')
}

/** Which of these numbers (the phone's contacts) use EcoCash, and how they relate to me. */
export async function matchContacts(q: Queryable, me: UserRow, raw: string[]): Promise<ContactMatch[]> {
  const numbers = [...new Set(raw.map((m) => toMsisdn(m)).filter((m): m is string => !!m))]
  if (!numbers.length) return []
  const users = await q.query<UserRow>(`SELECT * FROM users WHERE msisdn = ANY($1) AND kind = 'person' AND status = 'active' AND role = 'customer'`, [numbers])
  const out: ContactMatch[] = []
  for (const u of users) out.push({ msisdn: u.msisdn!, user: toPublicUser(u), relation: await relationOf(q, me.id, u.id) })
  return out.sort((a, b) => a.user.name.localeCompare(b.user.name))
}

/** An SMS invite to a number not on EcoCash; their first sign-in finds my friend request waiting. */
export async function invite(ctx: Ctx, me: UserRow, rawMsisdn: string): Promise<void> {
  const msisdn = normalizeMsisdn(rawMsisdn)
  const [exists] = await ctx.db.query(`SELECT 1 FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
  if (exists) throw conflict(`${msisdn} already uses EcoCash. Send a friend request instead`)
  const [{ n }] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM invites WHERE inviter_id = $1 AND created_at > now() - interval '1 day'`, [me.id])
  if (n >= INVITES_PER_DAY) throw new AppError('LIMIT_EXCEEDED', `You can send up to ${INVITES_PER_DAY} invites a day`)
  const inserted = await ctx.db.query(`INSERT INTO invites (id, inviter_id, msisdn) VALUES ($1, $2, $3) ON CONFLICT (inviter_id, msisdn) DO NOTHING RETURNING 1`, [newId(), me.id, msisdn])
  if (!inserted.length) throw conflict(`You already invited ${msisdn}`)
  await ctx.notifier.sms.send(msisdn, `${displayName(me)} invites you to EcoCash Super App: chat, send and receive money with friends. Get it from the Play Store, then sign in with this number.`)
    .catch((err) => ctx.log.warn({ err: (err as Error).message }, 'invite sms failed'))
}

/** On sign-in: invites to this number become friend requests from the people who sent them. */
export async function claimInvites(ctx: Ctx, user: UserRow): Promise<void> {
  if (!user.msisdn || user.kind !== 'person') return
  await ctx.tx(async (q, out) => {
    const invites = await q.query<{ id: string; inviter_id: string }>(
      `UPDATE invites SET joined_user_id = $2, joined_at = now() WHERE msisdn = $1 AND joined_user_id IS NULL AND inviter_id <> $2 RETURNING id, inviter_id`,
      [user.msisdn, user.id],
    )
    for (const i of invites) {
      if ((await relationOf(q, i.inviter_id, user.id)) !== 'none') continue
      await q.query('INSERT INTO friend_requests (id, from_user_id, to_user_id) VALUES ($1, $2, $3)', [newId(), i.inviter_id, user.id])
      const inviter = (await getUsers(q, [i.inviter_id])).get(i.inviter_id)
      out.notify({ userIds: [i.inviter_id], category: 'chats', title: 'Your invite was accepted', body: `${displayName(user)} joined EcoCash Super App. Your friend request is waiting for them.`, data: { screen: 'friends' } })
      if (inviter) out.notify({ userIds: [user.id], category: 'chats', title: 'Friend request', body: `${displayName(inviter)} invited you and wants to be friends.`, data: { screen: 'friends' } })
    }
  })
}

export async function setMessagePolicy(q: Queryable, me: UserRow, policy: MessagePolicy): Promise<UserRow> {
  const [u] = await q.query<UserRow>('UPDATE users SET message_policy = $2 WHERE id = $1 RETURNING *', [me.id, policy])
  return u
}

// ---------- groups ----------

/** Creates the group with me in it, and invites the others (friends only); they join when they accept. */
export async function createGroupWithInvites(ctx: Ctx, me: UserRow, title: string, memberIds: string[]): Promise<ChatSummary> {
  const name = title.trim()
  if (name.length < 2) throw validation('Give the group a name')
  const ids = [...new Set(memberIds)].filter((id) => id !== me.id)
  if (!ids.length) throw validation('Choose at least one friend to invite')
  if (ids.length >= GROUP_MAX_MEMBERS) throw validation(`A group can have up to ${GROUP_MAX_MEMBERS} people`)
  return ctx.tx(async (q, out) => {
    for (const id of ids) if (!(await areFriends(q, me.id, id))) throw forbidden('You can only invite your friends to a group')
    const chatId = await createGroup(q, out, me.id, name, [])
    for (const id of ids) {
      await q.query('INSERT INTO group_invites (id, chat_id, user_id, invited_by) VALUES ($1, $2, $3, $4)', [newId(), chatId, id, me.id])
    }
    out.notify({ userIds: ids, category: 'chats', title: `Join ${name}?`, body: `${displayName(me)} invited you to the group ${name}.`, data: { screen: 'friends' } })
    const [summary] = await chatSummaries(q, me.id, [chatId])
    return summary
  })
}

export async function respondToGroupInvite(ctx: Ctx, me: UserRow, inviteId: string, accept: boolean): Promise<{ chatId: string }> {
  return ctx.tx(async (q, out) => {
    const [gi] = await q.query<{ chat_id: string; invited_by: string }>(`SELECT gi.chat_id, gi.invited_by FROM group_invites gi JOIN chats c ON c.id = gi.chat_id WHERE gi.id = $1 AND gi.user_id = $2 AND gi.status = 'pending' AND c.deleted_at IS NULL FOR UPDATE OF gi`, [inviteId, me.id])
    if (!gi) throw notFound('That invite is no longer waiting')
    await q.query('UPDATE group_invites SET status = $2, responded_at = now() WHERE id = $1', [inviteId, accept ? 'accepted' : 'declined'])
    if (accept) {
      await q.query('INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gi.chat_id, me.id])
      await q.query('UPDATE chats SET updated_at = now() WHERE id = $1', [gi.chat_id])
      await announceChat(q, out, gi.chat_id, [me.id])
      out.notify({ userIds: [gi.invited_by], category: 'chats', title: 'Joined your group', body: `${displayName(me)} joined the group.`, data: { chatId: gi.chat_id } })
    }
    return { chatId: gi.chat_id }
  })
}

// ---------- message requests ----------

export async function answerMessageRequest(ctx: Ctx, me: UserRow, chatId: string, accept: boolean): Promise<void> {
  const done = await ctx.db.query(
    `UPDATE chat_members SET request_status = $3 WHERE chat_id = $1 AND user_id = $2 AND request_status = 'pending' RETURNING 1`,
    [chatId, me.id, accept ? null : 'declined'],
  )
  if (!done.length) throw notFound('That message request is no longer waiting')
}
