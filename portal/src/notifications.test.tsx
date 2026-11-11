import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminNotification, NotificationProviders, Page } from '../../shared/api'
import { NotificationsPage } from './pages/Notifications'
import { mockFetch, renderApp, SUPPORT } from './test/utils'

const providers: NotificationProviders = { push: false, sms: false, email: false, assistant: true }
const page: Page<AdminNotification> = {
  items: [{
    id: 'n1', user: { id: 'u1', msisdn: '+26662000021', name: 'Lerato Mokhothu', role: 'customer' }, channel: 'sms', category: 'money',
    recipient: '+26662000021', title: 'Money in', body: 'From Thabo: +M50.00. Ref MP1234567890.', status: 'mock', createdAt: '2026-10-19T10:00:00.000Z',
  }],
  total: 1, page: 1, pageSize: 20,
}

afterEach(() => vi.unstubAllGlobals())

describe('Notifications page', () => {
  it('lists what was sent and which providers are still mocks', async () => {
    mockFetch({ 'GET /admin/v1/notifications/providers': () => ({ body: providers }), 'GET /admin/v1/notifications': () => ({ body: page }) })
    renderApp(<NotificationsPage />)
    expect(await screen.findByText('From Thabo: +M50.00. Ref MP1234567890.')).toBeInTheDocument()
    expect(screen.getByText('Mock (not delivered)')).toBeInTheDocument()
    expect(await screen.findByText(/Set PUSH_ENABLED=true/)).toBeInTheDocument()
  })

  it('admins send news to people who opted in', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/notifications/providers': () => ({ body: providers }),
      'GET /admin/v1/notifications': () => ({ body: page }),
      'POST /admin/v1/notifications/news': () => ({ body: { recipients: 3 } }),
    })
    renderApp(<NotificationsPage />)
    await user.type(await screen.findByLabelText('Title'), 'LEC Friday')
    await user.type(screen.getByLabelText('Message'), '5% back on tokens')
    await user.click(screen.getByRole('button', { name: 'Send news' }))
    await screen.findByText(/Sent to 3 people/)
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'LEC Friday', body: '5% back on tokens' })
  })

  it('support staff cannot send news', async () => {
    mockFetch({ 'GET /admin/v1/notifications/providers': () => ({ body: providers }), 'GET /admin/v1/notifications': () => ({ body: page }) })
    renderApp(<NotificationsPage />, { admin: SUPPORT })
    expect(await screen.findByLabelText('Title')).toBeDisabled()
  })
})
