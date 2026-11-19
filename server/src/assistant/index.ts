import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ASSISTANT_HOURLY_LIMIT } from '../../../shared/api'
import type { Ctx } from '../context'
import { postMessage } from '../services/chats'
import { getUser, type UserRow } from '../services/users'
import { logAssistant } from '../services/support'
import { assistantAccount } from './account'
import { SYSTEM_PROMPT } from './prompt'
import { maseru, TOOL_LIST, TOOLS, type ToolEnv } from './tools'
import { openText, sealText } from '../lib/vault'

/** The one call the assistant makes to Claude; tests pass a fake. */
export interface AssistantModel {
  create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>
}

export interface AssistantOptions {
  model: string
  effort: 'low' | 'medium' | 'high'
}

export interface Assistant {
  /** True when a model is configured (ANTHROPIC_API_KEY set, or a test fake). */
  readonly enabled: boolean
  /** A person wrote in their assistant chat: queue the text and answer when the current reply (if any) is done. */
  received(chatId: string, user: UserRow, text: string): void
  /** Resolves when no reply is being written (tests, shutdown). */
  idle(): Promise<void>
}

/** Claude through the Anthropic SDK, with Anthropic's default fallback model if Claude declines on policy grounds. */
export function anthropicModel(apiKey: string): AssistantModel {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 })
  return {
    create: (params) => client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
  }
}

/** Most API round trips for one reply (each tool call is one). */
const MAX_STEPS = 8
/** History kept for Claude; older turns are dropped (with their thinking) once it grows past HISTORY_MAX. */
const HISTORY_MAX = 80
const HISTORY_KEEP = 40

const SORRY = {
  off: "The EcoCash Assistant isn't switched on yet. Please try again later.",
  busy: "I'm having trouble answering right now. Please try again in a moment.",
  limit: `You've sent me a lot of messages in the last hour (the limit is ${ASSISTANT_HOURLY_LIMIT}). Please try again a bit later.`,
  refused: "Sorry, I can't help with that one. I can help with your EcoCash wallet, payments and EcoSure.",
}

export function createAssistant(ctx: Ctx, model: AssistantModel | null, opts: AssistantOptions): Assistant {
  const queues = new Map<string, { user: UserRow; texts: string[] }>()
  const running = new Map<string, Promise<void>>()

  const say = (chatId: string, senderId: string, text: string) => ctx.tx((q, out) => postMessage(q, out, { chatId, senderId, kind: 'text', text }))

  const typing = (chatId: string, userId: string, on: boolean) => ctx.hub.send(userId, { type: 'chat.typing', chatId, typing: on })

  async function drain(chatId: string) {
    const assistant = await assistantAccount(ctx.db)
    for (let item = queues.get(chatId); item; item = queues.get(chatId)) {
      queues.delete(chatId)
      const user = (await getUser(ctx.db, item.user.id)) ?? item.user
      typing(chatId, user.id, true)
      try {
        await reply(chatId, user, assistant.id, item.texts)
      } catch (err) {
        ctx.log.error({ err, chatId }, 'assistant reply failed')
        await logAssistant(ctx.db, user.id, 'error')
        await say(chatId, assistant.id, SORRY.busy).catch(() => {})
      } finally {
        typing(chatId, user.id, false)
      }
    }
  }

  async function reply(chatId: string, user: UserRow, assistantId: string, texts: string[]) {
    if (!model) return void (await say(chatId, assistantId, SORRY.off))
    const [{ n }] = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE chat_id = $1 AND sender_id = $2 AND created_at > now() - interval '1 hour'`,
      [chatId, user.id],
    )
    if (n > ASSISTANT_HOURLY_LIMIT) {
      await logAssistant(ctx.db, user.id, 'limit')
      return void (await say(chatId, assistantId, SORRY.limit))
    }
    await logAssistant(ctx.db, user.id, 'question')

    await trimHistory(chatId)
    const firstNew = await appendTurns(chatId, [{ role: 'user', content: [{ type: 'text', text: `[${maseru(new Date())} Maseru time]\n${texts.join('\n')}` }] }])
    const messages = await loadHistory(chatId)
    const env: ToolEnv = { ctx, user, chatId, assistantId }
    let answered = false

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await model.create({
        model: opts.model,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM_PROMPT }],
        tools: TOOL_LIST,
        messages,
        output_config: { effort: opts.effort },
        cache_control: { type: 'ephemeral' },
      })
      if (res.stop_reason === 'refusal') {
        // Drop this exchange so the declined request isn't replayed with every later message.
        await ctx.db.query('DELETE FROM assistant_turns WHERE chat_id = $1 AND seq >= $2', [chatId, firstNew])
        await logAssistant(ctx.db, user.id, 'refusal')
        return void (await say(chatId, assistantId, SORRY.refused))
      }
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text.trim()] : [])).filter(Boolean).join('\n\n')
      if (text) {
        await say(chatId, assistantId, text)
        await logAssistant(ctx.db, user.id, 'answer')
      }
      answered ||= !!text

      const calls = res.content.filter((b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      const assistantTurn: BetaMessageParam = { role: 'assistant', content: res.content as BetaContentBlockParam[] }
      if (res.stop_reason !== 'tool_use' || !calls.length) {
        // A reply cut off at max_tokens can end in an unfinished tool call: keep the rest (a tool call needs its result).
        const kept = (res.content as BetaContentBlockParam[]).filter((b) => b.type !== 'tool_use')
        if (kept.length) await appendTurns(chatId, [{ role: 'assistant', content: kept }])
        if (!answered) await say(chatId, assistantId, SORRY.busy)
        return
      }
      const results: BetaContentBlockParam[] = []
      // Prepare tools show the user a card, which counts as an answer.
      answered ||= calls.some((c) => c.name.startsWith('prepare_') || c.name === 'open_screen')
      for (const call of calls) {
        await logAssistant(ctx.db, user.id, 'tool', call.name)
        results.push({ type: 'tool_result', tool_use_id: call.id, ...(await runTool(env, call.name, call.input)) })
      }
      const toolTurn: BetaMessageParam = { role: 'user', content: results }
      await appendTurns(chatId, [assistantTurn, toolTurn])
      messages.push(assistantTurn, toolTurn)
    }
    await say(chatId, assistantId, SORRY.busy)
  }

  async function runTool(env: ToolEnv, name: string, input: unknown): Promise<{ content: string; is_error?: boolean }> {
    const def = TOOLS[name]
    if (!def) return { content: `Unknown tool ${name}`, is_error: true }
    const parsed = def.input.safeParse(input ?? {})
    if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, is_error: true }
    try {
      return { content: await def.run(env, parsed.data) }
    } catch (err) {
      ctx.log.warn({ err: (err as Error).message, tool: name }, 'assistant tool failed')
      return { content: `That didn't work: ${(err as Error).message}`, is_error: true }
    }
  }

  async function appendTurns(chatId: string, turns: BetaMessageParam[]): Promise<number> {
    let first = 0
    for (const t of turns) {
      // Stored as the exact JSON text sent to the API, so replayed turns (and their thinking) stay byte for byte the same.
      const [row] = await ctx.db.query<{ seq: string }>('INSERT INTO assistant_turns (chat_id, role, content) VALUES ($1, $2, $3) RETURNING seq', [
        chatId,
        t.role,
        sealText(JSON.stringify(t.content)),
      ])
      if (!first) first = Number(row.seq)
    }
    return first
  }

  async function loadHistory(chatId: string): Promise<BetaMessageParam[]> {
    const rows = await ctx.db.query<{ role: 'user' | 'assistant'; content: string }>('SELECT role, content FROM assistant_turns WHERE chat_id = $1 ORDER BY seq', [chatId])
    return rows.map((r) => ({ role: r.role, content: JSON.parse(openText(r.content)) as BetaContentBlockParam[] }))
  }

  /**
   * Keeps the history bounded: past HISTORY_MAX turns, keep about the last HISTORY_KEEP, starting at a user's own
   * message (never at a tool result), and strip thinking from the kept assistant turns (it is only valid with the
   * exact earlier conversation, which is gone).
   */
  async function trimHistory(chatId: string) {
    const [{ n }] = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM assistant_turns WHERE chat_id = $1', [chatId])
    if (n <= HISTORY_MAX) return
    const rows = (await ctx.db.query<{ seq: string; role: string; content: string }>('SELECT seq, role, content FROM assistant_turns WHERE chat_id = $1 ORDER BY seq', [chatId])).map(
      (r) => ({ ...r, content: JSON.parse(openText(r.content)) as BetaContentBlockParam[] }),
    )
    let start = rows.length - HISTORY_KEEP
    while (start < rows.length && !(rows[start].role === 'user' && rows[start].content.every((b) => b.type === 'text'))) start++
    await ctx.db.tx(async (q) => {
      await q.query('DELETE FROM assistant_turns WHERE chat_id = $1 AND seq < $2', [chatId, start < rows.length ? rows[start].seq : Number(rows.at(-1)!.seq) + 1])
      for (const r of rows.slice(start)) {
        if (r.role !== 'assistant') continue
        const kept = r.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking')
        if (kept.length !== r.content.length) await q.query('UPDATE assistant_turns SET content = $2 WHERE seq = $1', [r.seq, sealText(JSON.stringify(kept))])
      }
    })
  }

  return {
    enabled: !!model,
    received(chatId, user, text) {
      const q = queues.get(chatId) ?? { user, texts: [] }
      q.texts.push(text)
      queues.set(chatId, q)
      if (running.has(chatId)) return
      const run = drain(chatId)
        .catch((err) => ctx.log.error({ err }, 'assistant failed'))
        .finally(() => running.delete(chatId))
      running.set(chatId, run)
    },
    async idle() {
      while (running.size) await Promise.all([...running.values()])
    },
  }
}
