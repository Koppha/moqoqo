import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTACT_DEFAULTS, USSD_DEFAULTS, type AdminUser, type AppConfig, type MaintenanceWindow } from '../../shared/api'
import { MaintenancePage } from './pages/Maintenance'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users'
import { mockFetch, renderApp, SUPPORT } from './test/utils'

const NOW = new Date('2026-10-12T08:00:00.000Z')

const windows: MaintenanceWindow[] = [
  {
    id: 'a',
    startsAt: '2026-10-12T07:00:00.000Z',
    endsAt: '2026-10-12T10:00:00.000Z',
    message: { en: 'Down', st: 'Fatše' },
    status: 'active',
    createdBy: 'thabo@etl.co.ls',
    createdAt: '2026-10-11T07:00:00.000Z',
  },
  {
    id: 's',
    startsAt: '2026-10-15T20:00:00.000Z',
    endsAt: '2026-10-15T22:00:00.000Z',
    message: { en: 'Down', st: 'Fatše' },
    status: 'scheduled',
    createdBy: 'thabo@etl.co.ls',
    createdAt: '2026-10-11T07:00:00.000Z',
  },
]

const agent: AdminUser = {
  ownerIdNumber: null,
  id: 'u1',
  msisdn: '+26662000021',
  name: 'Palesa Agent',
  role: 'agent',
  balance: 12000,
  kycTier: 2,
  code: 'AGENT-0101',
  status: 'active',
  createdAt: '2026-01-01T08:00:00.000Z',
  lastSeenAt: null,
}

const config: AppConfig = {
  ussd: USSD_DEFAULTS,
  maintenance: null,
  announcement: { en: 'Hello', st: 'Lumela' },
  minVersion: { customer: '1.2.0', business: null, ecosure: null, society: null }, deviceSecurity: { blockRooted: false, blockDeveloperMode: false },
  serverTime: NOW.toISOString(),
  branding: { logo: null, miniAppIcons: {} },
  contact: CONTACT_DEFAULTS,
}

afterEach(() => vi.unstubAllGlobals())

function expectReadOnly(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription(/read-only/)
}

describe('support role (read-only)', () => {
  it('disables every maintenance write control and explains why', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ 'GET /admin/v1/maintenance': () => ({ body: windows }) })
    renderApp(<MaintenancePage clock={() => NOW} />, { admin: SUPPORT })
    const table = await screen.findByRole('table')

    expect(screen.getByRole('note')).toHaveTextContent(/support.*read-only/i)
    const schedule = screen.getByRole('button', { name: /Schedule maintenance/ })
    expectReadOnly(schedule)
    for (const name of [/^Edit/, /^End now$/, /^Cancel window/]) {
      for (const b of within(table).getAllByRole('button', { name })) expectReadOnly(b)
    }
    expectReadOnly(screen.getAllByRole('button', { name: 'End now' })[0]) // banner button too

    await user.click(schedule)
    await user.click(within(table).getByRole('button', { name: /^Cancel window/ }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('disables Add user and the user actions', async () => {
    const user = userEvent.setup()
    mockFetch({
      'GET /admin/v1/users': () => ({ body: { items: [agent], total: 1, page: 1, pageSize: 25 } }),
      'GET /admin/v1/users/u1': () => ({ body: agent }),
      'GET /admin/v1/transactions': () => ({ body: { items: [], total: 0, page: 1, pageSize: 25 } }),
    })
    renderApp(<UsersPage />, { admin: SUPPORT })
    expectReadOnly(screen.getByRole('button', { name: /Add user/ }))
    await user.click(await screen.findByRole('button', { name: 'Palesa Agent' }))
    const panel = await screen.findByRole('dialog', { name: 'Palesa Agent' })
    for (const name of ['Suspend', 'Reset PIN', 'Top up float']) expectReadOnly(within(panel).getByRole('button', { name }))
  })

  it('disables the app settings form', async () => {
    mockFetch({ 'GET /v1/app-config': () => ({ body: config }) })
    renderApp(<SettingsPage />, { admin: SUPPORT })
    const save = await screen.findByRole('button', { name: 'Save settings' })
    expectReadOnly(save)
    expect(screen.getByLabelText('Announcement in English')).toBeDisabled()
    expect(screen.getByLabelText('Customer app')).toBeDisabled()
  })

  it('admins get enabled controls', async () => {
    mockFetch({ 'GET /admin/v1/maintenance': () => ({ body: windows }) })
    renderApp(<MaintenancePage clock={() => NOW} />)
    await screen.findByRole('table')
    expect(screen.getByRole('button', { name: /Schedule maintenance/ })).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
