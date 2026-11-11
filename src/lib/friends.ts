import type { ChatSummary } from '../../shared/api'
import { api, ApiFailure } from './api'

// Shared by the Friends screens.

/** The server's own words for expected refusals ("already friends", "not on EcoCash"); null for anything else. */
export const friendlyError = (e: unknown): string | null =>
  e instanceof ApiFailure && e.code !== 'UNKNOWN' && e.code !== 'NETWORK' ? e.message : null

/** Fresh chat list (after joining a group or answering a message request). */
export const loadChats = () => api<ChatSummary[]>('/v1/chats')

/** The personal QR's link, and reading one back: <scheme>://add?u=<userId> (a receive QR, pay?u=, works too). */
export function userIdFromQr(data: string): string | null {
  const m = /(?:^|[/:])(?:add|pay)\?(?:[^#]*&)?u=([A-Za-z0-9-]+)/.exec(data)
  return m ? decodeURIComponent(m[1]) : null
}
