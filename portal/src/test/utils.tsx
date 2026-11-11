import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import type { Admin } from '../../../shared/api'
import { AuthProvider } from '../auth'
import { ToastProvider } from '../components/Toast'

export const ADMIN: Admin = { id: 'a1', email: 'thabo@etl.co.ls', name: 'Thabo Mokoena', role: 'admin' }
export const SUPPORT: Admin = { id: 'a2', email: 'lineo@etl.co.ls', name: 'Lineo Support', role: 'support' }

export interface MockCall {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

type Handler = (call: MockCall) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>

/**
 * Replaces global fetch. Routes are keyed "METHOD /path" (query string ignored).
 * Unmatched requests answer 404 NOT_FOUND. Returns the recorded calls.
 */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: MockCall[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = new URL(url, 'http://localhost').pathname
    const call: MockCall = {
      method,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(call)
    const handler = routes[`${method} ${path}`]
    if (!handler) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No mock for ${method} ${path}` } }), { status: 404 })
    const { status = 200, body } = await handler(call)
    if (status === 204) return new Response(null, { status })
    return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

export function renderApp(ui: ReactElement, { admin = ADMIN, path = '/' }: { admin?: Admin | null; path?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider initialAdmin={admin}>
          <Routes>
            <Route path="/login" element={<p>Login page</p>} />
            <Route path="*" element={ui} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}
