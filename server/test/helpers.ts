import { deflateSync } from 'node:zlib'
import { WebSocket } from 'ws'
import type { ServerEvent } from '../../shared/api'
import { loadConfig, type Config } from '../src/config'
import { hashSecret, newId } from '../src/lib/crypto'
import type { AppDeps } from '../src/app'
import { createServer, type Server } from '../src/server'

export const ADMIN = { email: 'admin@test.local', password: 'admin-pass-123' }
export const N = {
  lerato: '+26662000021',
  mme: '+26662103401',
  thabo: '+26662555010',
  palesa: '+26662300112',
  taxi: '+26663550042',
  cafe: '+26662888001',
  agent: '+26662777001',
}

export interface Res<T = any> {
  status: number
  body: T
}

export interface TestServer {
  server: Server
  call<T = any>(method: string, url: string, body?: unknown, token?: string): Promise<Res<T>>
  login(msisdn: string, app?: 'customer' | 'business', pin?: string): Promise<{ token: string; user: any }>
  adminLogin(email?: string, password?: string): Promise<string>
  createSupportAdmin(email: string, password: string): Promise<void>
  close(): Promise<void>
}

/** Fresh in-memory PGlite with the demo seed. */
export async function startTestServer(deps: AppDeps = {}, overrides: Partial<Config> = {}): Promise<TestServer> {
  const config = { ...loadConfig({}), dataDir: null, databaseUrl: null, adminEmail: ADMIN.email, adminPassword: ADMIN.password, deviceBinding: false, ...overrides }
  const server = await createServer(config, { logger: false, assistantModel: null, ...deps })
  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await server.app.inject({
      method: method as any,
      url,
      payload: body === undefined ? undefined : (body as any),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    return { status: res.statusCode, body: res.body ? res.json() : undefined }
  }
  return {
    server,
    call,
    async login(msisdn, app = 'customer', pin = '1234') {
      const r = await call('POST', '/v1/auth/login', { msisdn, pin, app })
      if (r.status !== 200) throw new Error(`login ${msisdn} failed: ${JSON.stringify(r.body)}`)
      return r.body
    },
    async adminLogin(email = ADMIN.email, password = ADMIN.password) {
      const r = await call('POST', '/admin/v1/login', { email, password })
      if (r.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(r.body)}`)
      return r.body.token
    },
    async createSupportAdmin(email, password) {
      const { hash, salt } = await hashSecret(password)
      await server.db.query(
        `INSERT INTO admins (id, email, name, role, password_hash, password_salt) VALUES ($1, $2, 'Support', 'support', $3, $4)`,
        [newId(), email, hash, salt],
      )
    },
    close: () => server.close(),
  }
}

/** Finds a chat in the viewer's list by title. */
export async function chatByTitle(t: TestServer, token: string, title: string) {
  const r = await t.call('GET', '/v1/chats', undefined, token)
  const chat = r.body.find((c: any) => c.title === title)
  if (!chat) throw new Error(`chat ${title} not found in ${r.body.map((c: any) => c.title).join(', ')}`)
  return chat
}

export async function lastMessage(t: TestServer, token: string, chatId: string) {
  const r = await t.call('GET', `/v1/chats/${chatId}/messages?limit=1`, undefined, token)
  return r.body[0]
}

export const balanceOf = async (t: TestServer, token: string): Promise<number> => (await t.call('GET', '/v1/me', undefined, token)).body.balance

/** A real WebSocket client that records every event. */
export class WsClient {
  events: ServerEvent[] = []
  closeCode: number | null = null
  private ws: WebSocket
  private waiters: (() => void)[] = []

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ws.on('message', (data) => {
      this.events.push(JSON.parse(data.toString()))
      for (const w of this.waiters.splice(0)) w()
    })
    this.ws.on('close', (code) => {
      this.closeCode = code
      for (const w of this.waiters.splice(0)) w()
    })
    this.ws.on('error', () => {})
  }

  send(data: unknown) {
    this.ws.send(JSON.stringify(data))
  }

  async waitFor<T extends ServerEvent['type']>(type: T, pred: (e: Extract<ServerEvent, { type: T }>) => boolean = () => true, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const hit = this.events.find((e) => e.type === type && pred(e as any))
      if (hit) return hit as Extract<ServerEvent, { type: T }>
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`timed out waiting for ${type}; got ${JSON.stringify(this.events.map((e) => e.type))}`)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  async waitClose(timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    while (this.closeCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    return this.closeCode
  }

  close() {
    this.ws.close()
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A real PNG of the given size (one colour). */
export function png(w: number, h: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x5b)])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
