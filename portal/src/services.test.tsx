import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDef } from '../../shared/api'
import { ServicesPage } from './pages/Services'
import { mockFetch, renderApp, SUPPORT } from './test/utils'

const mpesa: ServiceDef = {
  id: 'svc-mpesa', code: 'MPESA', name: { en: 'M-Pesa', st: 'M-Pesa' }, description: { en: 'Send to M-Pesa', st: '' }, icon: 'phone-portrait', color: '#E60000',
  placement: 'send', sort: 20, enabled: true, executor: 'ecocash_transfer', confirmName: true,
  fields: [
    { key: 'mpesa_number', type: 'phone', label: { en: 'M-Pesa number', st: 'Nomoro' }, required: true, networks: ['vodacom'] },
    { key: 'amount', type: 'amount', label: { en: 'Amount', st: 'Chelete' }, required: true },
  ],
  fee: { fixed: 3, percent: 0 }, limits: { min: 1, max: 5000 },
}

afterEach(() => vi.unstubAllGlobals())

describe('Services page', () => {
  it('lists services and saves an edited field', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/services': () => ({ body: [mpesa] }),
      'PUT /admin/v1/services/svc-mpesa': (c) => ({ body: { ...mpesa, ...(c.body as object) } }),
    })
    renderApp(<ServicesPage />)
    expect(await screen.findByText('M-Pesa')).toBeInTheDocument()
    expect(screen.getByText('M-Pesa number, Amount')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    const fixed = within(dialog).getByLabelText('Fixed fee (M)')
    await user.clear(fixed)
    await user.type(fixed, '4')
    await user.click(within(dialog).getByRole('button', { name: 'Add field' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    const put = calls.find((c) => c.method === 'PUT')?.body as any
    expect(put.fee.fixed).toBe(4)
    expect(put.fields).toHaveLength(3)
    expect(put.id).toBeUndefined()
  })

  it('is read-only for support staff', async () => {
    mockFetch({ 'GET /admin/v1/services': () => ({ body: [mpesa] }) })
    renderApp(<ServicesPage />, { admin: SUPPORT })
    await screen.findByText('M-Pesa')
    expect(screen.getByRole('button', { name: 'New service' })).toHaveAttribute('aria-disabled', 'true')
  })
})
