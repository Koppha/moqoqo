import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { APP_KINDS, APP_NAMES, SEND_MANY_MAX, type AppKind } from '../../../shared/api'
import type {
  AgentSummary,
  ChatSummary,
  LoginResult,
  Me,
  MerchantSummary,
  Message,
  PublicUser,
  Transaction,
} from '../../../shared/api'
import { ensureAssistantChat } from '../assistant/account'
import { customerWrote } from '../services/support'
import { maseru } from '../assistant/tools'
import type { Ctx } from '../context'
import { AppError, notFound, validation } from '../errors'
import { authUser, noContent, parse, requireRole, zAmount, zClientId, zId, zPin } from '../http'
import { hashToken, newToken } from '../lib/crypto'
import { normalizeMsisdn } from '../lib/msisdn'
import { startOfMaseruDay } from '../lib/time'
import { chatSummaries, createGroup, deleteGroup, ensurePairChat, leaveGroup, listMessages, loadMessages, markRead, postMessage, requireMember } from '../services/chats'
import * as intents from '../services/intents'
import { boundDevice, checkDeviceAllowed, startOnboarding, zDevice, zNetwork } from '../services/onboarding'
import { appConfig } from '../services/maintenance'
import * as money from '../services/money'
import * as paycodes from '../services/paycodes'
import * as splits from '../services/splits'
import { checkPin } from '../services/pins'
import { claimInvites } from '../services/friends'
import { listTransactions } from '../services/transactions'
import { asUsername, requireByNumberOrUsername, requireWallet, toMe, toPublicUser, type UserRow } from '../services/users'

/**
 * Placeholder agent commission rates until EcoCash provides its real commission table.
 * Commission is reported in the agent summary only; it is not paid out by this server.
 */
export const AGENT_COMMISSION = { cashin: 0.005, cashout: 0.01 } as const

const zBill = z.enum(['lec', 'wasco', 'school', 'airtime', 'burial'])

export async function v1Routes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authUser(ctx) }

  // ---------- config (public) ----------
  app.get('/v1/app-config', async () => appConfig(ctx.db))

  // ---------- auth ----------
  app.post('/v1/auth/login', async (req, reply): Promise<LoginResult> => {
    const body = parse(
      z.object({
        msisdn: z.string(),
        pin: zPin,
        app: z.enum(APP_KINDS as [AppKind, ...AppKind[]]),
        role: z.enum(['agent', 'merchant']).optional(),
        device: zDevice.optional(),
        network: zNetwork.optional(),
      }),
      req.body,
    )
    // A username works as well as the number.
    const username = /^\+?\d[\d\s-]*$/.test(body.msisdn.trim()) ? null : asUsername(body.msisdn)
    const msisdn = username ? '' : normalizeMsisdn(body.msisdn)
    const [user] = username
      ? await ctx.db.query<UserRow>(`SELECT * FROM users WHERE username = $1 AND kind = 'person'`, [username])
      : await ctx.db.query<UserRow>(`SELECT * FROM users WHERE msisdn = $1 AND kind = 'person'`, [msisdn])
    if (!user || !user.pin_hash) throw new AppError('NOT_REGISTERED', username ? `No one uses the username @${username}` : `${msisdn} is not registered for EcoCash`)
    if (user.status === 'suspended') throw new AppError('SUSPENDED', 'This account is suspended. Please contact EcoCash')
    // The EcoSure app signs in with the EcoSure PIN the person created (their EcoSure profile), never the EcoCash PIN.
    await checkPin(ctx.db, user, body.pin, body.app === 'ecosure' ? 'ecosure' : 'wallet')
    if (body.app === 'business' && user.role === 'customer') {
      throw new AppError('WRONG_APP', 'The business app is for EcoCash agents and merchants. Use the EcoCash Super App instead')
    }
    if (body.app === 'society' && user.role !== 'customer') {
      throw new AppError('WRONG_APP', 'Mekhatlo is for your personal EcoCash wallet. Sign in with your own number, not a business one')
    }
    if (body.role && body.role !== user.role) {
      throw new AppError('WRONG_ROLE', `This number is registered as ${user.role === 'agent' ? 'an agent' : `a ${user.role}`}. Choose that to sign in`)
    }
    // Device binding: only the wallet's bound phone signs in with number + PIN; any other phone starts sign-up.
    let boundDeviceId: string | null = null
    if (ctx.config.deviceBinding) {
      if (!body.device || !body.network) throw new AppError('VALIDATION', `Update ${APP_NAMES[body.app]} to sign in`)
      await checkDeviceAllowed(ctx.db, body.device)
      boundDeviceId = await boundDevice(ctx.db, user.id, body.app, body.device.deviceId)
      if (!boundDeviceId) {
        reply.code(202)
        return { onboarding: await startOnboarding(ctx, user, body.app, body.device, body.network) }
      }
    }
    const token = newToken()
    await ctx.db.query('INSERT INTO sessions (token_hash, user_id, app, bound_device_id) VALUES ($1, $2, $3, $4)', [hashToken(token), user.id, body.app, boundDeviceId])
    const [fresh] = await ctx.db.query<UserRow>('UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING *', [user.id])
    req.log.info({ userId: user.id, app: body.app }, 'login')
    // Invites sent to this number become friend requests waiting for them.
    await claimInvites(ctx, fresh).catch((err) => req.log.warn({ err: (err as Error).message }, 'claim invites failed'))
    void ctx.notifier.send({
      userIds: [user.id],
      category: 'security',
      title: 'New sign-in',
      body: `Your wallet was signed in to on the ${APP_NAMES[body.app]} app at ${maseru(new Date())}. If this wasn't you, call EcoCash customer care now.`,
      data: { screen: 'notifications' },
    })
    return { token, user: toMe(fresh) }
  })

  // A payment-grade check (e.g. before showing a pay code): always the wallet PIN.
  app.post('/v1/auth/verify-pin', auth, async (req, reply) => {
    const body = parse(z.object({ pin: zPin }), req.body)
    await checkPin(ctx.db, req.user, body.pin, req.sessionApp === 'ecosure' ? 'ecosure' : 'wallet')
    return noContent(reply)
  })

  // Opening the app (the lock screen): the app PIN when the person set one, else the wallet PIN.
  app.post('/v1/auth/unlock', auth, async (req, reply) => {
    const body = parse(z.object({ pin: zPin }), req.body)
    await checkPin(ctx.db, req.user, body.pin, req.sessionApp === 'ecosure' ? 'ecosure' : req.user.app_pin_hash ? 'app' : 'wallet')
    return noContent(reply)
  })

  app.post('/v1/auth/logout', auth, async (req, reply) => {
    await ctx.db.query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash])
    return noContent(reply)
  })

  app.get('/v1/me', auth, async (req): Promise<Me> => toMe(req.user))

  app.get('/v1/users/lookup', auth, async (req): Promise<PublicUser> => {
    const query = parse(z.object({ msisdn: z.string().optional(), username: z.string().optional() }), req.query)
    return toPublicUser(await requireByNumberOrUsername(ctx.db, query.username ?? query.msisdn ?? ''))
  })

  app.put('/v1/me/username', auth, async (req): Promise<Me> => {
    const body = parse(z.object({ username: z.string().max(30) }), req.body)
    const username = asUsername(body.username)
    if (!username) throw validation('A username has 3–20 letters, digits, dots or underscores, and starts with a letter')
    const [taken] = await ctx.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1 AND id <> $2', [username, req.user.id])
    if (taken) throw new AppError('CONFLICT', `@${username} is taken. Try another`)
    const [u] = await ctx.db.query<UserRow>('UPDATE users SET username = $2 WHERE id = $1 RETURNING *', [req.user.id, username])
    return toMe(u)
  })

  app.post('/v1/devices', auth, async (req, reply) => {
    const body = parse(
      z.object({ expoPushToken: z.string().min(10).max(300), platform: z.enum(['android', 'ios']), app: z.enum(APP_KINDS as [AppKind, ...AppKind[]]) }),
      req.body,
    )
    await ctx.db.query(
      `INSERT INTO devices (expo_push_token, user_id, platform, app) VALUES ($1, $2, $3, $4)
       ON CONFLICT (expo_push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app = EXCLUDED.app, updated_at = now()`,
      [body.expoPushToken, req.user.id, body.platform, body.app],
    )
    return noContent(reply)
  })

  app.post('/v1/devices/test', auth, async (req) =>
    ctx.notifier.testPush(req.user.id, 'Test notification', 'Push notifications work on this phone. You will hear about money, requests and security here.'))

  // Signing out: this phone stops getting the wallet's pushes.
  app.post('/v1/devices/unregister', auth, async (req, reply) => {
    const { expoPushToken } = parse(z.object({ expoPushToken: z.string().min(10).max(300) }), req.body)
    await ctx.db.query('DELETE FROM devices WHERE expo_push_token = $1 AND user_id = $2', [expoPushToken, req.user.id])
    return noContent(reply)
  })

  app.get('/v1/transactions', auth, async (req): Promise<Transaction[]> => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query)
    return listTransactions(ctx.db, req.user.id, limit)
  })

  // ---------- chats ----------
  app.get('/v1/chats', auth, async (req): Promise<ChatSummary[]> => {
    // Everyone has a chat with the EcoCash Assistant; it appears the first time the chat list loads.
    await ctx.tx((q, out) => ensureAssistantChat(q, out, req.user))
    return chatSummaries(ctx.db, req.user.id)
  })

  app.post('/v1/chats', auth, async (req, reply): Promise<ChatSummary> => {
    const body = parse(
      z.union([
        z.object({ msisdn: z.string() }),
        z.object({ username: z.string() }),
        z.object({ title: z.string().trim().min(1).max(60), memberMsisdns: z.array(z.string()).min(1).max(256) }),
      ]),
      req.body,
    )
    const me = req.user
    const { chatId, created } = await ctx.tx(async (q, out) => {
      if ('msisdn' in body || 'username' in body) {
        const other = await requireByNumberOrUsername(q, 'username' in body ? '@' + body.username.replace(/^@/, '') : body.msisdn)
        return ensurePairChat(q, out, me.id, other.id, { creatorId: me.id })
      }
      const members: string[] = []
      for (const raw of body.memberMsisdns) members.push((await requireWallet(q, normalizeMsisdn(raw, 'memberMsisdns'))).id)
      if (!members.some((m) => m !== me.id)) throw validation('A group needs at least one other member')
      return { chatId: await createGroup(q, out, me.id, body.title, members), created: true }
    })
    reply.code(created ? 201 : 200)
    return (await chatSummaries(ctx.db, me.id, [chatId]))[0]
  })

  app.get('/v1/chats/:id/messages', auth, async (req): Promise<Message[]> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const query = parse(z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query)
    await requireMember(ctx.db, id, req.user.id)
    return listMessages(ctx.db, id, query.before || undefined, query.limit)
  })

  app.post('/v1/chats/:id/messages', auth, async (req): Promise<Message> => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ clientId: zClientId, text: z.string().trim().min(1).max(4000) }), req.body)
    const [chat] = await chatSummaries(ctx.db, req.user.id, [id])
    if (!chat) throw notFound('Chat not found')
    // Official chats (LEC, EcoSure, …) only send; the assistant's is the one people write in.
    if (chat.kind === 'official' && !chat.assistant && !chat.support) throw new AppError('FORBIDDEN', 'You cannot reply in this chat')
    // Retries with the same clientId return the original message instead of duplicating it.
    const [dup] = await ctx.db.query<{ id: string }>('SELECT id FROM messages WHERE chat_id = $1 AND sender_id = $2 AND client_id = $3', [
      id,
      req.user.id,
      body.clientId,
    ])
    if (dup) return (await loadMessages(ctx.db, [dup.id]))[0]
    const message = await ctx.tx(async (q, out) => {
      const m = await postMessage(q, out, { chatId: id, senderId: req.user.id, clientId: body.clientId, kind: 'text', text: body.text })
      if (chat.support) await customerWrote(q, out, req.user, body.text)
      return m
    })
    if (chat.assistant) ctx.assistant.received(id, req.user, body.text)
    return message
  })

  app.post('/v1/chats/:id/read', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await requireMember(ctx.db, id, req.user.id)
    await markRead(ctx.db, id, req.user.id)
    return noContent(reply)
  })

  /** The person who made a group deletes it for everyone. */
  app.delete('/v1/chats/:id', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await ctx.tx((q, out) => deleteGroup(q, out, id, req.user.id))
    return noContent(reply)
  })

  /** Anyone else leaves the group. */
  app.post('/v1/chats/:id/leave', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await ctx.tx((q, out) => leaveGroup(q, out, id, req.user.id))
    return noContent(reply)
  })

  // ---------- money ----------
  app.post('/v1/payments/send', auth, async (req) => {
    const body = parse(
      z.object({
        chatId: zId,
        toUserId: zId,
        amount: zAmount,
        pin: zPin,
        kind: z.enum(['money', 'mpho']),
        note: z.string().optional(),
        clientId: zClientId,
      }),
      req.body,
    )
    return money.sendMoney(ctx, req.user, body)
  })

  app.post('/v1/payments/send-many', auth, async (req) => {
    const body = parse(
      z.object({
        recipients: z.array(z.object({ to: z.string().trim().min(1).max(40), amount: zAmount })).min(1).max(SEND_MANY_MAX),
        pin: zPin,
        note: z.string().optional(),
        clientId: zClientId,
      }),
      req.body,
    )
    return money.sendMany(ctx, req.user, body)
  })

  app.post('/v1/requests', auth, async (req, reply) => {
    const body = parse(
      z.object({
        chatId: zId,
        clientId: zClientId,
        amount: zAmount,
        kind: z.enum(['money', 'bill']),
        bill: zBill.optional(),
        account: z.string().optional(),
        detail: z.string().optional(),
        note: z.string().optional(),
      }),
      req.body,
    )
    reply.code(201)
    return money.createRequest(ctx, req.user, body)
  })

  // ---------- split bill ----------
  app.post('/v1/splits', auth, async (req, reply) => {
    const body = parse(
      z.object({
        chatId: zId,
        clientId: zClientId,
        method: z.enum(['equal', 'specific', 'enter']),
        total: zAmount.optional(),
        participants: z.array(z.object({ userId: zId, amount: zAmount.optional() })).min(1).max(256),
        note: z.string().optional(),
        pin: zPin,
        payTo: z
          .union([z.object({ subscriber: z.string().min(1).max(40) }), z.object({ merchantCode: z.string().min(1).max(40), organiserCovers: z.boolean() })])
          .optional(),
      }),
      req.body,
    )
    reply.code(201)
    return splits.createSplit(ctx, req.user, body)
  })

  app.get('/v1/splits', auth, async (req) => splits.listSplits(ctx.db, req.user.id))

  app.post('/v1/requests/:id/pay', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ pin: zPin, amount: zAmount.optional() }), req.body)
    return money.payRequest(ctx, req.user, id, body)
  })

  app.post('/v1/requests/:id/decline', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return money.declineRequest(ctx, req.user, id)
  })

  app.post('/v1/bills/pay', auth, async (req) => {
    const body = parse(z.object({ bill: zBill, account: z.string(), amount: zAmount, pin: zPin }), req.body)
    return money.payBill(ctx, req.user, body)
  })

  app.post('/v1/payments/tap', auth, async (req) => {
    const body = parse(z.object({ merchantCode: z.string(), amount: zAmount, pin: zPin.optional() }), req.body)
    return money.tap(ctx, req.user, body)
  })

  // ---------- agents ----------
  const agent = { preHandler: [authUser(ctx), requireRole('agent')] }

  app.post('/v1/agent/cash-in', agent, async (req) => {
    const body = parse(z.object({ customerMsisdn: z.string(), amount: zAmount, pin: zPin }), req.body)
    return money.cashIn(ctx, req.user, body)
  })

  app.post('/v1/agent/cash-out', agent, async (req, reply) => {
    const body = parse(z.object({ customerMsisdn: z.string(), amount: zAmount }), req.body)
    reply.code(201)
    return money.cashOut(ctx, req.user, body)
  })

  app.post('/v1/agent/register', agent, async (req, reply) => {
    const body = parse(z.object({ msisdn: z.string(), name: z.string(), pin: zPin }), req.body)
    reply.code(201)
    return money.registerCustomer(ctx, req.user, body)
  })

  app.get('/v1/agent/summary', agent, async (req): Promise<AgentSummary> => {
    const me = req.user
    const since = startOfMaseruDay()
    const [s] = await ctx.db.query<{ in_n: number; in_c: number; out_n: number; out_c: number }>(
      `SELECT
         count(*) FILTER (WHERE kind = 'cashin' AND from_user_id = $1) AS in_n,
         COALESCE(sum(amount_cents) FILTER (WHERE kind = 'cashin' AND from_user_id = $1), 0) AS in_c,
         count(*) FILTER (WHERE kind = 'cashout' AND to_user_id = $1) AS out_n,
         COALESCE(sum(amount_cents) FILTER (WHERE kind = 'cashout' AND to_user_id = $1), 0) AS out_c
       FROM transactions WHERE created_at >= $2 AND (from_user_id = $1 OR to_user_id = $1)`,
      [me.id, since],
    )
    const [fresh] = await ctx.db.query<{ balance_cents: number }>('SELECT balance_cents FROM users WHERE id = $1', [me.id])
    const commissionCents = Math.round(s.in_c * AGENT_COMMISSION.cashin + s.out_c * AGENT_COMMISSION.cashout)
    return {
      float: fresh.balance_cents / 100,
      cashInToday: { count: s.in_n, total: s.in_c / 100 },
      cashOutToday: { count: s.out_n, total: s.out_c / 100 },
      commissionToday: commissionCents / 100,
      recent: await listTransactions(ctx.db, me.id, 20),
    }
  })

  // ---------- merchants ----------
  const merchant = { preHandler: [authUser(ctx), requireRole('merchant')] }

  app.post('/v1/merchant/charge', merchant, async (req, reply) => {
    const body = parse(z.object({ customerMsisdn: z.string(), amount: zAmount, note: z.string().optional() }), req.body)
    reply.code(201)
    return money.charge(ctx, req.user, body)
  })

  app.get('/v1/merchant/summary', merchant, async (req): Promise<MerchantSummary> => {
    const me = req.user
    const [s] = await ctx.db.query<{ n: number; c: number }>(
      `SELECT count(*) AS n, COALESCE(sum(amount_cents), 0) AS c FROM transactions
       WHERE to_user_id = $1 AND kind IN ('merchant', 'tap', 'qr') AND created_at >= $2`,
      [me.id, startOfMaseruDay()],
    )
    const pending = await ctx.db.query<{ message_id: string }>(
      `SELECT r.message_id FROM requests r JOIN messages m ON m.id = r.message_id
       WHERE r.requester_id = $1 AND r.kind = 'merchant' AND r.status = 'pending' ORDER BY m.seq DESC LIMIT 50`,
      [me.id],
    )
    return {
      salesToday: { count: s.n, total: s.c / 100 },
      pending: (await loadMessages(ctx.db, pending.map((p) => p.message_id))).reverse(),
      recent: await listTransactions(ctx.db, me.id, 20),
    }
  })

  // ---------- receive money: QR, code or tap ----------
  app.get('/v1/merchants/:code', auth, async (req) => {
    const { code } = parse(z.object({ code: z.string().min(1).max(40) }), req.params)
    return intents.merchantView(await money.requireMerchant(ctx.db, code))
  })

  app.post('/v1/payments/merchant', auth, async (req) => {
    const body = parse(z.object({ merchantCode: z.string(), amount: zAmount, pin: zPin, note: z.string().optional() }), req.body)
    return money.payMerchantQr(ctx, req.user, body)
  })

  app.post('/v1/merchant/intents', merchant, async (req, reply) => {
    const body = parse(z.object({ amount: zAmount, note: z.string().optional() }), req.body)
    reply.code(201)
    return intents.createIntent(ctx, req.user, body)
  })

  // Agent cash-out at the counter: same request, paid the same ways, settled as a cash-out.
  app.post('/v1/agent/cashouts', agent, async (req, reply) => {
    const body = parse(z.object({ amount: zAmount, note: z.string().optional() }), req.body)
    reply.code(201)
    return intents.createIntent(ctx, req.user, body)
  })

  // Reading, cancelling and taking payment on an open request: merchants (sales) and agents (cash-outs).
  const business = { preHandler: [authUser(ctx), requireRole('merchant', 'agent')] }

  app.get('/v1/merchant/intents/:id', business, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return intents.getMerchantIntent(ctx, req.user, id)
  })

  app.post('/v1/merchant/intents/:id/cancel', business, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return intents.cancelIntent(ctx, req.user, id)
  })

  app.post('/v1/merchant/intents/:id/tap', business, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ tagId: z.string(), pin: zPin.optional() }), req.body)
    return intents.tapIntent(ctx, req.user, id, body)
  })

  app.get('/v1/intents/lookup', auth, async (req) => {
    const query = parse(z.object({ id: z.string().optional(), code: z.string().trim().optional(), business: z.string().trim().max(40).optional() }), req.query)
    return intents.lookupIntent(ctx, { id: query.id || undefined, code: query.code || undefined, business: query.business || undefined })
  })

  app.post('/v1/intents/:id/pay', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ pin: zPin, method: z.enum(['qr', 'code']) }), req.body)
    return intents.payIntent(ctx, req.user, id, body)
  })

  // ---------- pay merchant: the customer's payment code ----------
  app.post('/v1/paycode/enable', auth, async (req) => {
    const body = parse(z.object({ pin: zPin }), req.body)
    return paycodes.enableQuickPay(ctx, req.user, body.pin)
  })

  app.post('/v1/paycode/disable', auth, async (req) => paycodes.disableQuickPay(ctx, req.user))

  app.post('/v1/paycode', auth, async (req) => paycodes.issuePayCode(ctx, req.user))

  app.post('/v1/merchant/intents/:id/paycode', business, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    const body = parse(z.object({ code: z.string().max(40), pin: zPin.optional() }), req.body)
    return paycodes.payCodeIntent(ctx, req.user, id, body)
  })

  // ---------- receive money: a person's own QR ----------
  app.get('/v1/payees/:id', auth, async (req) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    return paycodes.payee(ctx, id)
  })

  app.post('/v1/payments/person', auth, async (req) => {
    const body = parse(
      z.object({ toUserId: zId, amount: zAmount, pin: zPin, note: z.string().optional(), clientId: zClientId }),
      req.body,
    )
    return paycodes.payPerson(ctx, req.user, body)
  })

  // ---------- NFC tags ----------
  app.get('/v1/me/tags', auth, async (req) => intents.listTags(ctx.db, req.user.id))

  app.post('/v1/me/tags', auth, async (req, reply) => {
    const body = parse(z.object({ tagId: z.string(), label: z.string() }), req.body)
    reply.code(201)
    return intents.addTag(ctx.db, req.user.id, body)
  })

  app.delete('/v1/me/tags/:id', auth, async (req, reply) => {
    const { id } = parse(z.object({ id: zId }), req.params)
    await intents.deleteTag(ctx.db, req.user.id, id)
    return noContent(reply)
  })
}
