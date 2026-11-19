import crypto from 'node:crypto'
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantModel } from '../src/assistant/index'
import { chatByTitle, N, startTestServer, type TestServer } from './helpers'

// The AI receptionist (the EcoCash Assistant as front desk): it explains held and refused payments itself, and hands
// urgent cases to the right team first.

class FakeClaude implements AssistantModel {
  readonly requests: MessageCreateParamsNonStreaming[] = []
  private script: BetaMessage[] = []
  next(...r: BetaMessage[]) { this.script.push(...r) }
  async create(p: MessageCreateParamsNonStreaming): Promise<BetaMessage> {
    this.requests.push(structuredClone(p))
    const r = this.script.shift()
    if (!r) throw new Error('no reply scripted')
    return r
  }
}
let n = 0
const msg = (content: any[], stop: BetaMessage['stop_reason'] = 'end_turn') =>
  ({ id: `m${++n}`, type: 'message', role: 'assistant', model: 'x', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as any
const useTool = (name: string, input: unknown) => msg([{ type: 'tool_use', id: `tu${++n}`, name, input }], 'tool_use')
const say = (words: string) => msg([{ type: 'text', text: words }])

let t: TestServer
const claude = new FakeClaude()
let me: { token: string; user: any }
let admin: string
let chatId: string

const ask = async (words: string) => {
  await t.call('POST', `/v1/chats/${chatId}/messages`, { clientId: crypto.randomUUID(), text: words }, me.token)
  await t.server.ctx.assistant.idle()
}
/** What the last tool call returned to the model. */
const lastToolResult = () => {
  const turn = claude.requests.at(-1)!.messages.at(-1)!
  return (turn.content as any[])[0].content as string
}

beforeAll(async () => {
  t = await startTestServer({ assistantModel: claude })
  me = await t.login(N.lerato)
  admin = await t.adminLogin()
  chatId = (await chatByTitle(t, me.token, 'EcoCash Assistant')).id
})
afterAll(() => t.close())

describe('AI receptionist', () => {
  it('explains a held payment in plain words, without the safety rules behind it', async () => {
    await t.call('POST', `/admin/v1/users/${me.user.id}/sim-swaps/simulate`, { hoursAgo: 1 }, admin)
    const out = await t.call('POST', '/v1/bank-transfers', { bankCode: 'SLB', accountNumber: '12345678901', amount: 50, pin: '1234', clientId: crypto.randomUUID() }, me.token)
    expect(out.body.error.code).toBe('RISK_BLOCKED')

    claude.next(useTool('get_refused_payments', {}), useTool('get_account_security', {}), say('Your payment was held because your SIM changed.'))
    await ask('Why was my bank payment refused?')
    const reqs = claude.requests.slice(-2)
    const refused = (reqs[0].messages.at(-1)!.content as any[])[0].content as string
    expect(refused).toContain('new SIM card recently')
    expect(refused).toContain('M50.00')
    expect(refused).not.toMatch(/score|points|threshold/i)
    const security = JSON.parse(lastToolResult())
    expect(security.simChangeHold).toMatchObject({ until: expect.any(String), reportedByTheirPhone: false })
    expect(security.phonesSetUp).toBeGreaterThanOrEqual(0)
  })

  it('urgent cases go to the right team first, with the channel recorded', async () => {
    claude.next(
      useTool('hand_over_to_human', { topic: 'other', summary: 'Asks how to change the language.', urgent: false }),
      say('Passed on.'),
    )
    await ask('Talk to a person about the language please')
    claude.next(
      useTool('hand_over_to_human', { topic: 'account', summary: 'Says their SIM was changed without them and money is missing.', urgent: true }),
      say('This is urgent; passed on.'),
    )
    await ask('My SIM stopped working and money is gone!')
    expect(lastToolResult()).toMatch(/opened as urgent for the Accounts team/)

    const list = (await t.call('GET', '/admin/v1/support/tickets?status=open', undefined, admin)).body.items
    expect(list[0]).toMatchObject({ priority: 'urgent', topic: 'account', channel: 'chat' })
    expect(list[1]).toMatchObject({ priority: 'normal', topic: 'other' })

    const support = await chatByTitle(t, me.token, 'EcoCash Support')
    const thread = (await t.call('GET', `/v1/chats/${support.id}/messages?limit=20`, undefined, me.token)).body
    expect(thread.at(-1).text).toMatch(/urgent request SUP-\d+.*Accounts team/)
  })

  it('fraud is always urgent', async () => {
    claude.next(useTool('hand_over_to_human', { topic: 'fraud', summary: 'A caller asked for their PIN.', urgent: false }), say('Passed on.'))
    await ask('Someone called asking for my PIN')
    expect(lastToolResult()).toContain('as urgent for the Fraud and security team')
  })

  it('the instructions make it a front desk and drop retired features', () => {
    const system = (claude.requests[0].system as any[])[0].text as string
    expect(system).toContain('front desk')
    expect(system).toContain('Mokhatlo')
    expect(system).not.toMatch(/Motšelo|taxi/i)
    expect(claude.requests[0].tools!.map((x: any) => x.name)).toEqual(expect.arrayContaining(['get_account_security', 'get_refused_payments']))
  })
})
