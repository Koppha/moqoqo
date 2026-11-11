import type { FastifyBaseLogger } from 'fastify'
import type { Assistant } from './assistant/index'
import type { Config } from './config'
import type { Db, Queryable } from './db/index'
import type { Ledger } from './ecocash/index'
import type { BankGateway } from './gateways/banks'
import type { CardGateway } from './gateways/cards'
import type { EcoCashServices } from './gateways/ecocash'
import type { HomeAffairs } from './gateways/homeaffairs'
import type { PinlessGateway } from './gateways/pinless'
import type { RemitGateway } from './gateways/remit'
import type { Notifier } from './notify/index'
import { Hub } from './realtime/hub'
import { Outbox } from './realtime/outbox'
import { checkKyc } from './services/kyc'
import { afterTransfer, checkRisk } from './services/risk'

export interface Ctx {
  db: Db
  config: Config
  hub: Hub
  ledger: Ledger
  /** Card gateway (mock until a real one is chosen). */
  cards: CardGateway
  /** Bank rails (mock until integrated). */
  banks: BankGateway
  /** Remittance partner, money abroad (mock until a partner is chosen). */
  remit: RemitGateway
  /** EcoCash pinless payment payloads for split bills (mock until the API documentation arrives). */
  pinless: PinlessGateway
  /** EcoCash services API: other networks, airtime, bundles (mock until integrated). */
  services: EcoCashServices
  /** National ID register (mock until integrated). */
  homeAffairs: HomeAffairs
  log: FastifyBaseLogger
  /** Push, SMS and email, honouring each user's choices. */
  notifier: Notifier
  /** The EcoCash Assistant (set once the app is built). */
  assistant: Assistant
  /** Runs fn in a DB transaction and delivers the collected realtime events after COMMIT. */
  /** Called after COMMIT for every wallet that received money (split bills collect what is owed). */
  onCredit?: (userId: string) => void
  tx<T>(fn: (q: Queryable, out: Outbox) => Promise<T>): Promise<T>
  publish(out: Outbox): void
}

export function createCtx(parts: Omit<Ctx, 'tx' | 'publish' | 'assistant'>): Ctx {
  // The outbox of the transaction each Queryable belongs to, so ledger transfers can queue money alerts.
  const outboxes = new WeakMap<Queryable, Outbox>()
  const ledger: Ledger = {
    async transfer(q, input) {
      await checkKyc(q, input)
      const flags = await checkRisk(q, input)
      const result = await parts.ledger.transfer(q, input)
      await afterTransfer(q, result.tx, flags)
      outboxes.get(q)?.transfers.push(result)
      return result
    },
  }
  const ctx: Ctx = {
    ...parts,
    ledger,
    assistant: null as unknown as Assistant,
    publish(out) {
      for (const { userId, event } of out.events) ctx.hub.send(userId, event)
      for (const notice of out.notices) void ctx.notifier.send(notice)
      for (const { tx, balances } of out.transfers) void ctx.notifier.transfer(tx, balances)
      if (ctx.onCredit) for (const id of new Set(out.transfers.map((t) => t.tx.to_user_id).filter((x): x is string => !!x))) ctx.onCredit(id)
    },
    async tx(fn) {
      const out = new Outbox()
      const result = await ctx.db.tx((q) => {
        outboxes.set(q, out)
        return fn(q, out)
      })
      ctx.publish(out)
      return result
    },
  }
  return ctx
}
