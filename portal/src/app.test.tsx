import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminStats, AdminUser, CreateUserBody } from '../../shared/api'
import { getToken, setToken } from './api'
import { AppRoutes } from './App'
import { AuthProvider } from './auth'
import { ToastProvider } from './components/Toast'
import { DashboardPage } from './pages/Dashboard'
import { UsersPage } from './pages/Users'
import { ADMIN, mockFetch, renderApp } from './test/utils'
import { normalizeMsisdn } from './format'

afterEach(() => vi.unstubAllGlobals())

const stats = (maintenance: AdminStats['maintenance']): AdminStats => ({
  users: { customer: 1520, agent: 42, merchant: 87 },
  suspended: 3,
  today: { transactions: 311, volume: 48250.5, messages: 2004, newUsers: 12 },
  maintenance,
})

function renderFullApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('login and session', () => {
  it('signs in and lands on the dashboard', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'POST /admin/v1/login': () => ({ body: { token: 'tok', admin: ADMIN } }),
      'GET /admin/v1/stats': () => ({ body: stats(null) }),
    })
    renderFullApp('/')
    await user.type(await screen.findByLabelText('Work email'), 'thabo@etl.co.ls')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(calls[0].body).toEqual({ email: 'thabo@etl.co.ls', password: 'secret' })
    expect(getToken()).toBe('tok')
    expect(screen.getByText('Thabo Mokoena')).toBeInTheDocument()
  })

  it('shows a friendly error for wrong credentials and for an unreachable server', async () => {
    const user = userEvent.setup()
    mockFetch({ 'POST /admin/v1/login': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'nope' } } }) })
    renderFullApp('/login')
    await user.type(screen.getByLabelText('Work email'), 'x@etl.co.ls')
    await user.type(screen.getByLabelText('Password'), 'bad')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That email and password combination is not right.')

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the EcoCash Super App server"))
  })

  it('a 401 from any page signs out and returns to the login page', async () => {
    setToken('old')
    sessionStorage.setItem('moqoqo.admin.profile', JSON.stringify(ADMIN))
    mockFetch({
      'GET /admin/v1/me': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }),
      'GET /admin/v1/stats': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }),
    })
    renderFullApp('/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Your session ended. Please sign in again.')).toBeInTheDocument()
    expect(getToken()).toBeNull()
  })

  it('sign out clears the session', async () => {
    const user = userEvent.setup()
    setToken('tok')
    sessionStorage.setItem('moqoqo.admin.profile', JSON.stringify(ADMIN))
    const { calls } = mockFetch({
      'GET /admin/v1/me': () => ({ body: ADMIN }),
      'GET /admin/v1/stats': () => ({ body: stats(null) }),
      'POST /admin/v1/logout': () => ({ status: 204 }),
    })
    renderFullApp('/')
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(getToken()).toBeNull()
    const logout = calls.find((c) => c.method === 'POST' && c.url.endsWith('/admin/v1/logout'))
    expect(logout?.headers.Authorization).toBe('Bearer tok')
  })
})

describe('dashboard', () => {
  it('shows stats and an ACTIVE maintenance banner', async () => {
    mockFetch({
      'GET /admin/v1/stats': () => ({
        body: stats({ id: 'm', startsAt: '2026-10-12T07:00:00Z', endsAt: '2026-10-12T10:00:00Z', message: { en: 'a', st: 'b' }, active: true }),
      }),
    })
    renderApp(<DashboardPage />)
    expect(await screen.findByText('Maintenance is ACTIVE until Mon 12 Oct 2026, 12:00.')).toBeInTheDocument()
    expect(screen.getByText('1,520')).toBeInTheDocument()
    expect(screen.getByText('M48,250.50')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage maintenance' })).toHaveAttribute('href', '/maintenance')
  })

  it('shows scheduled and none states', async () => {
    mockFetch({
      'GET /admin/v1/stats': () => ({
        body: stats({ id: 'm', startsAt: '2026-10-14T20:00:00Z', endsAt: '2026-10-14T22:00:00Z', message: { en: 'a', st: 'b' }, active: false }),
      }),
    })
    const { unmount } = renderApp(<DashboardPage />)
    expect(await screen.findByText('Maintenance scheduled for Wed 14 Oct 2026, 22:00')).toBeInTheDocument()
    unmount()
    mockFetch({ 'GET /admin/v1/stats': () => ({ body: stats(null) }) })
    renderApp(<DashboardPage />)
    expect(await screen.findByText('No maintenance scheduled.')).toBeInTheDocument()
  })
})

describe('users', () => {
  it('normalises Lesotho numbers', () => {
    expect(normalizeMsisdn('+266 6200 0021')).toBe('+26662000021')
    expect(normalizeMsisdn('62000021')).toBe('+26662000021')
    expect(normalizeMsisdn('26658001122')).toBe('+26658001122')
    expect(normalizeMsisdn('+27 82 000 0000')).toBeNull()
    expect(normalizeMsisdn('1234')).toBeNull()
  })

  it('adds a merchant with validation, +266 number and business name', async () => {
    const user = userEvent.setup()
    const created: AdminUser = {
      ownerIdNumber: null,
      id: 'u9',
      msisdn: '+26662001234',
      name: 'Mpho Taxi',
      role: 'merchant',
      businessName: 'Mpho Taxis',
      balance: 0,
      kycTier: 1,
      status: 'active',
      createdAt: '2026-10-12T08:00:00Z',
      lastSeenAt: null,
    }
    const { calls } = mockFetch({
      'GET /admin/v1/users': () => ({ body: { items: [], total: 0, page: 1, pageSize: 25 } }),
      'POST /admin/v1/users': () => ({ body: created }),
      'GET /admin/v1/users/u9': () => ({ body: created }),
      'GET /admin/v1/transactions': () => ({ body: { items: [], total: 0, page: 1, pageSize: 25 } }),
    })
    renderApp(<UsersPage />)
    expect(await screen.findByText('No users yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add user/ }))
    const dialog = screen.getByRole('dialog', { name: 'Add user' })
    await user.click(within(dialog).getByRole('radio', { name: 'Merchant' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add merchant' }))
    expect(within(dialog).getByText(/Enter a Lesotho mobile number/)).toBeInTheDocument()
    expect(within(dialog).getByText('Merchants need a business name.')).toBeInTheDocument()
    expect(within(dialog).getByText('The PIN must be exactly 4 digits.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Mobile number'), '6200 1234')
    await user.type(within(dialog).getByLabelText('Full name'), 'Mpho Taxi')
    await user.type(within(dialog).getByLabelText('Business name'), 'Mpho Taxis')
    await user.type(within(dialog).getByLabelText('Initial PIN'), '4821')
    await user.click(within(dialog).getByRole('button', { name: 'Add merchant' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const body = calls.find((c) => c.method === 'POST')!.body as CreateUserBody
    expect(body).toEqual({ msisdn: '+26662001234', name: 'Mpho Taxi', role: 'merchant', pin: '4821', businessName: 'Mpho Taxis' })
    expect(await screen.findByText('Merchant Mpho Taxi added.')).toBeInTheDocument()
  })
})
