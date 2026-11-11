// Friends, contacts, invites, groups and message requests. Contract: shared/api.ts "friends, invites, groups".
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Me, UserRelation } from '../../../shared/api'
import type { Ctx } from '../context'
import { notFound } from '../errors'
import { authUser, noContent, parse, zId } from '../http'
import {
  answerMessageRequest,
  cancelRequest,
  createGroupWithInvites,
  friendsOverview,
  invite,
  matchContacts,
  relationOf,
  requestFriend,
  respondToGroupInvite,
  respondToRequest,
  setMessagePolicy,
  unfriend,
} from '../services/friends'
import { toMe, toPublicUser, type UserRow } from '../services/users'

export async function friendRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }
  const idParam = (p: unknown) => parse(z.object({ id: zId }), p).id

  app.get('/v1/friends', auth, async (req) => friendsOverview(ctx.db, req.user))
  app.post('/v1/friends/requests', auth, async (req, reply) => {
    const body = parse(z.object({ msisdn: z.string().max(30).optional(), username: z.string().max(30).optional(), userId: zId.optional() }), req.body)
    const r = await requestFriend(ctx, req.user, body)
    reply.code('accepted' in r ? 200 : 201)
    return r
  })
  app.post('/v1/friends/requests/:id/accept', auth, async (req, reply) => {
    await respondToRequest(ctx, req.user, idParam(req.params), true)
    return noContent(reply)
  })
  app.post('/v1/friends/requests/:id/decline', auth, async (req, reply) => {
    await respondToRequest(ctx, req.user, idParam(req.params), false)
    return noContent(reply)
  })
  app.delete('/v1/friends/requests/:id', auth, async (req, reply) => {
    await cancelRequest(ctx, req.user, idParam(req.params))
    return noContent(reply)
  })
  app.delete('/v1/friends/:id', auth, async (req, reply) => {
    await unfriend(ctx, req.user, idParam(req.params))
    return noContent(reply)
  })

  // The personal QR (moqoqo://add?u=<id>): who it is and how they relate to me.
  app.get('/v1/users/:id/relation', auth, async (req): Promise<UserRelation> => {
    const id = idParam(req.params)
    const [u] = await ctx.db.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND kind = 'person' AND status = 'active'`, [id])
    if (!u) throw notFound('This QR code isn’t a person on EcoCash')
    return { user: toPublicUser(u), relation: await relationOf(ctx.db, req.user.id, u.id) }
  })

  app.post('/v1/contacts/match', auth, async (req) => {
    const { msisdns } = parse(z.object({ msisdns: z.array(z.string().max(30)).max(1000) }), req.body)
    return matchContacts(ctx.db, req.user, msisdns)
  })
  app.post('/v1/invites', auth, async (req, reply) => {
    const { msisdn } = parse(z.object({ msisdn: z.string().max(30) }), req.body)
    await invite(ctx, req.user, msisdn)
    return reply.code(201).send({})
  })

  app.put('/v1/me/privacy', auth, async (req): Promise<Me> => {
    const { messagePolicy } = parse(z.object({ messagePolicy: z.enum(['everyone', 'friends']) }), req.body)
    return toMe(await setMessagePolicy(ctx.db, req.user, messagePolicy))
  })

  app.post('/v1/groups', auth, async (req, reply) => {
    const body = parse(z.object({ title: z.string().max(60), memberIds: z.array(zId).max(200) }), req.body)
    reply.code(201)
    return createGroupWithInvites(ctx, req.user, body.title, body.memberIds)
  })
  app.post('/v1/group-invites/:id/accept', auth, async (req) => respondToGroupInvite(ctx, req.user, idParam(req.params), true))
  app.post('/v1/group-invites/:id/decline', auth, async (req) => respondToGroupInvite(ctx, req.user, idParam(req.params), false))

  app.post('/v1/chats/:id/accept-request', auth, async (req, reply) => {
    await answerMessageRequest(ctx, req.user, idParam(req.params), true)
    return noContent(reply)
  })
  app.post('/v1/chats/:id/decline-request', auth, async (req, reply) => {
    await answerMessageRequest(ctx, req.user, idParam(req.params), false)
    return noContent(reply)
  })
}
