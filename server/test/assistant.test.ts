import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantModel } from '../src/assistant/index'
import { balanceOf, chatByTitle, N, startTestServer, type TestServer } from './helpers'

/** A stand-in for Claude: answers from a script and records every request. */
class FakeClaude implements AssistantModel {
  readonly requests: MessageCreateParamsNonStreaming[] = []
  private script: (BetaMessage | Error)[] = []
  next(...replies: (BetaMessage | Error)[]) {
    this.script.push(...replies)
  }
  async create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> {
    this.requests.push(structuredClone(params))
    const r = this.script.shift()
    if (!r) throw new Error('FakeClaude: no scripted reply')
    if (r instanceof Error) throw r
    return r
  }
}

let ids = 0
const reply = (content: any[], stop_reason: BetaMessage['stop_reason'] = 'end_turn'): BetaMessage =>
  ({ id: `msg_${++ids}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as any
const text = (t: string) => reply([{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: t }])
const tool = (name: string, input: unknown, before?: string) =>
  reply([...(before ? [{ type: 'text', text: before }] : []), { type: 'tool_use', id: `toolu_${++ids}`, name, input }], 'tool_use')

let t: TestServer
const claude = new FakeClaude()
let lerato: { token: string; user: any }
let chatId: string

const messages = async () => (await t.call('GET', `/v1/chats/${chatId}/messages?limit=100`, undefined, lerato.token)).body as any[]
const say = async (words: string) => {
  const r = await t.call('POST', `/v1/chats/${chatId}/messages`, { clientId: crypto.randomUUID(), text: words }, lerato.token)
  expect(r.status).toBe(200)
  await t.server.ctx.assistant.idle()
  return r.body
}
const lastFromAssistant = async () => (await messages()).filter((m) => m.senderId !== lerato.user.id).at(-1)

beforeAll(async () => {
  t = await startTestServer({ assistantModel: claude })
  lerato = await t.login(N.lerato)
  chatId = (await chatByTitle(t, lerato.token, 'EcoCash Assistant')).id
})
afterAll(() => t.close())

describe('EcoCash Assistant chat', () => {
  it('every person gets one official assistant chat with a welcome', async () => {
    const chats = (await t.call('GET', '/v1/chats', undefined, lerato.token)).body
    const mine = chats.filter((c: any) => c.assistant)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ kind: 'official', title: 'EcoCash Assistant', assistant: true })
    expect(mine[0].lastMessage.text).toContain("I never move money")
  })

  it('answers with the user own data through tools', async () => {
    claude.next(tool('get_wallet', {}), text('You have M1,240.50 in your wallet.'))
    await say('How much money do I have?')
    expect((await lastFromAssistant()).text).toBe('You have M1,240.50 in your wallet.')

    const [first, second] = claude.requests.slice(-2)
    expect(first.model).toBe('claude-opus-5-5')
    expect(typeof first.system === 'object' && first.system[0].text).toContain('You never move money')
    expect(first.tools!.map((x: any) => x.name)).toContain('prepare_send_money')
    expect(JSON.stringify(first.messages.at(-1))).toContain('How much money do I have?')
    // The tool result carries the real balance, and the earlier turns are replayed exactly.
    const result = (second.messages.at(-1)!.content as any[])[0]
    expect(result).toMatchObject({ type: 'tool_result' })
    expect(result.content).toContain('M1,240.50')
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages)
  })

  it('keeps the conversation, thinking included, for the next question', async () => {
    const before = claude.requests.length
    claude.next(text('Yes, it is.'))
    await say('Is that all of it?')
    const req = claude.requests[before]
    const turns = req.messages
    expect(turns.length).toBeGreaterThanOrEqual(5)
    expect(JSON.stringify(turns)).toContain('"signature":"sig"')
    expect(turns.at(-1)!.role).toBe('user')
  })

  it('prepares a payment as a card but never moves money', async () => {
    const balance = await balanceOf(t, lerato.token)
    claude.next(
      tool('find_contact', { query: 'Thabo' }),
      tool('prepare_send_money', { to: '+26662555010', amount: 50, note: 'Lunch' }, "Here's the payment to Thabo."),
      text('Tap the card, check it and confirm with your PIN.'),
    )
    await say('Send Thabo M50 for lunch')
    const all = await messages()
    const card = all.find((m) => m.kind === 'action')
    expect(card).toMatchObject({ kind: 'action', text: 'Send M50.00 to Thabo · Lunch', action: { type: 'send_money', msisdn: '+26662555010', name: 'Thabo', amount: 50, note: 'Lunch' } })
    expect(all.at(-1).text).toBe('Tap the card, check it and confirm with your PIN.')
    expect(await balanceOf(t, lerato.token)).toBe(balance)
    const contactResult = (claude.requests.at(-2)!.messages.at(-1)!.content as any[])[0]
    expect(contactResult.content).toContain('+26662555010')
  })

  it('asks instead of guessing when nobody matches', async () => {
    claude.next(tool('prepare_send_money', { to: 'Nobody Here', amount: 20 }), text('Who is that? Send me their number.'))
    const cards = (await messages()).filter((m) => m.kind === 'action').length
    await say('Send Nobody M20')
    expect((await messages()).filter((m) => m.kind === 'action')).toHaveLength(cards)
    const result = (claude.requests.at(-1)!.messages.at(-1)!.content as any[])[0]
    expect(result.content).toContain('No one matching')
  })

  it('rejects invalid tool input without running it', async () => {
    claude.next(tool('prepare_payment', { type: 'top_up', amount: -5 }), text('How much should I top up?'))
    await say('Top up')
    const result = (claude.requests.at(-1)!.messages.at(-1)!.content as any[])[0]
    expect(result.is_error).toBe(true)
  })

  it('says sorry on a refusal and forgets that exchange', async () => {
    const before = claude.requests.length
    claude.next(reply([], 'refusal'), text('Hello again!'))
    await say('something declined')
    expect((await lastFromAssistant()).text).toContain("can't help with that")
    await say('Hi')
    expect(JSON.stringify(claude.requests[before + 1].messages)).not.toContain('something declined')
  })

  it('says it is having trouble when Claude fails', async () => {
    claude.next(new Error('overloaded'))
    await say('Are you there?')
    expect((await lastFromAssistant()).text).toContain('having trouble')
  })

  it('shows a typing indicator and answers queued messages in order', async () => {
    claude.next(text('First answer'))
    claude.next(text('Second answer'))
    await t.call('POST', `/v1/chats/${chatId}/messages`, { clientId: crypto.randomUUID(), text: 'one' }, lerato.token)
    await t.call('POST', `/v1/chats/${chatId}/messages`, { clientId: crypto.randomUUID(), text: 'two' }, lerato.token)
    await t.server.ctx.assistant.idle()
    const texts = (await messages()).slice(-4).map((m) => m.text)
    expect(texts).toContain('Second answer')
  })

  it('only the assistant official chat can be written in', async () => {
    const lec = (await t.call('GET', '/v1/chats', undefined, lerato.token)).body.find((c: any) => c.kind === 'official' && !c.assistant)
    const r = await t.call('POST', `/v1/chats/${lec.id}/messages`, { clientId: crypto.randomUUID(), text: 'hello LEC' }, lerato.token)
    expect(r.status).toBe(403)
  })
})

describe('without an API key', () => {
  it('tells the user it is not switched on', async () => {
    const off = await startTestServer()
    try {
      const me = await off.login(N.thabo)
      const chat = await chatByTitle(off, me.token, 'EcoCash Assistant')
      await off.call('POST', `/v1/chats/${chat.id}/messages`, { clientId: crypto.randomUUID(), text: 'hi' }, me.token)
      await off.server.ctx.assistant.idle()
      const msgs = (await off.call('GET', `/v1/chats/${chat.id}/messages`, undefined, me.token)).body
      expect(msgs.at(-1).text).toContain("isn't switched on")
    } finally {
      await off.close()
    }
  })
})
