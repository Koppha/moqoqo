import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantModel } from '../src/assistant/index'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

class FakeClaude implements AssistantModel {
  private script: BetaMessage[] = []
  next(...r: BetaMessage[]) { this.script.push(...r) }
  async create(_p: MessageCreateParamsNonStreaming): Promise<BetaMessage> {
    const r = this.script.shift()
    if (!r) throw new Error('no reply scripted')
    return r
  }
}
let n = 0
const msg = (content: any[], stop: BetaMessage['stop_reason'] = 'end_turn') =>
  ({ id: `m${++n}`, type: 'message', role: 'assistant', model: 'x', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as any

let t: TestServer
const claude = new FakeClaude()
let lerato: { token: string; user: any }
let admin: string

beforeAll(async () => {
  t = await startTestServer({ assistantModel: claude })
  lerato = await t.login(N.lerato)
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('help & support', () => {
  it('the assistant hands over to a person; staff answer in EcoCash Support', async () => {
    const chat = await chatByTitle(t, lerato.token, 'EcoCash Assistant')
    claude.next(
      msg([{ type: 'tool_use', id: 'tu1', name: 'hand_over_to_human', input: { topic: 'payments', summary: 'Sent M200 to the wrong number this morning.' } }], 'tool_use'),
      msg([{ type: 'text', text: 'I passed this to EcoCash Support (SUP-000001).' }]),
    )
    await t.call('POST', `/v1/chats/${chat.id}/messages`, { clientId: crypto.randomUUID(), text: 'I sent money to the wrong person, I want a human' }, lerato.token)
    await t.server.ctx.assistant.idle()

    const support = await chatByTitle(t, lerato.token, 'EcoCash Support')
    expect(support.support).toBe(true)
    expect(support.lastMessage.text).toContain('Sent M200 to the wrong number')

    const list = await t.call('GET', '/admin/v1/support/tickets?status=open', undefined, admin)
    const ticket = list.body.items[0]
    expect(ticket).toMatchObject({ topic: 'payments', status: 'open', user: { msisdn: N.lerato } })
    const detail = (await t.call('GET', `/admin/v1/support/tickets/${ticket.id}`, undefined, admin)).body
    expect(detail.aiConversation.some((m: any) => m.text?.includes('I want a human'))).toBe(true)

    // The customer adds something; staff answer; the ticket waits for the customer.
    await t.call('POST', `/v1/chats/${support.id}/messages`, { clientId: crypto.randomUUID(), text: 'It was 62103402' }, lerato.token)
    const answered = await t.call('POST', `/admin/v1/support/tickets/${ticket.id}/reply`, { text: 'We have asked the receiver to send it back.' }, admin)
    expect(answered.body.status).toBe('waiting')
    expect(answered.body.thread.at(-1).text).toContain('EcoCash Support')
    expect(answered.body.firstResponseAt).toBeTruthy()

    const closed = await t.call('POST', `/admin/v1/support/tickets/${ticket.id}/close`, undefined, admin)
    expect(closed.body.status).toBe('closed')
  })

  it('support stats show what the assistant did', async () => {
    const s = (await t.call('GET', '/admin/v1/support/stats?days=7', undefined, admin)).body
    expect(s).toMatchObject({ people: 1, questions: 1, handovers: 1, tickets: { closed: 1 } })
    expect(s.tools).toContainEqual({ name: 'hand_over_to_human', count: 1 })
    expect(s.selfServiceRate).toBe(0)
  })

  it('other official chats stay read-only', async () => {
    const lec = (await t.call('GET', '/v1/chats', undefined, lerato.token)).body.find((c: any) => c.title === 'LEC')
    expect((await t.call('POST', `/v1/chats/${lec.id}/messages`, { clientId: crypto.randomUUID(), text: 'hi' }, lerato.token)).status).toBe(403)
  })
})
