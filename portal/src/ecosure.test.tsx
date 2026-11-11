import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EsClaim, EsPolicy, Page } from '../../shared/api'
import type { AdminEsClaim, AdminEsQuote } from './api'
import { EcoSurePage, formatDay } from './pages/EcoSure'
import { KIND_LABEL } from './pages/Transactions'
import { mockFetch, renderApp, SUPPORT } from './test/utils'

const holder = { id: 'u1', msisdn: '+26662000021', name: 'Lerato Mokhothu', role: 'customer' as const }

const claim: AdminEsClaim = {
  id: 'c1',
  reference: 'CLM-2026-00001',
  policyNumber: 'ES-000101',
  member: { id: 'm2', name: 'Neo Mokhothu', relationship: 'child' },
  dateOfDeath: '2026-10-13',
  cause: 'natural',
  status: 'submitted',
  documents: [
    { label: 'Death certificate', fileName: 'death.pdf' },
    { label: 'Medical certificate (natural cause)', fileName: 'medical.png' },
  ],
  steps: [
    { label: 'Submitted', at: '2026-10-16T08:00:00.000Z', done: true },
    { label: 'Documents verified', done: false },
    { label: 'Under assessment', done: false },
    { label: 'Decision and payout', done: false },
  ],
  createdAt: '2026-10-16T08:00:00.000Z',
  updatedAt: '2026-10-16T08:00:00.000Z',
  holder,
}

const quote: AdminEsQuote = {
  reference: 'Q-2026-000002',
  productCode: 'ST-MOTOR',
  productName: 'Motor Vehicle',
  status: 'submitted',
  documents: [{ label: 'Registration papers / VAT11', fileName: 'vat11.pdf' }],
  createdAt: '2026-10-16T08:00:00.000Z',
  contactName: 'Lerato Mokhothu',
  msisdn: '+26662000021',
  answers: { 'Vehicle model': 'Toyota Vitz 2016', Use: 'Private' },
}

const policy: EsPolicy = {
  id: 'p1',
  number: 'ES-000101',
  productCode: 'FUN-STD',
  packageName: 'EcoSure Standard',
  cover: 'family',
  premium: 84,
  status: 'grace',
  nextDue: '2026-11-16',
  holder: { name: 'Lerato Mokhothu', idNumber: '1', dob: '1990-01-01', gender: 'female', msisdn: '+26662000021' },
  members: [{ id: 'm1', name: 'Lerato Mokhothu', relationship: 'main' }],
  sponsoredBy: { name: 'Thabo' },
  createdAt: '2026-10-16T08:00:00.000Z',
}

const page = <T,>(items: T[]): Page<T> => ({ items, total: items.length, page: 1, pageSize: 25 })

afterEach(() => vi.unstubAllGlobals())

describe('EcoSure page', () => {
  it('labels the new ledger kinds and formats dates', () => {
    expect(KIND_LABEL.ecosure).toBe('EcoSure premium')
    expect(KIND_LABEL.claim).toBe('EcoSure payout')
    expect(formatDay('2026-11-16')).toBe('16 Nov 2026')
  })

  it('verifies a claim’s documents from its panel', async () => {
    const user = userEvent.setup()
    const verified: EsClaim = { ...claim, status: 'documents_verified', steps: claim.steps.map((s, i) => (i === 1 ? { ...s, done: true, at: claim.createdAt } : s)) }
    const { calls } = mockFetch({
      'GET /admin/v1/ecosure/claims': () => ({ body: page([claim]) }),
      'POST /admin/v1/ecosure/claims/c1/decision': () => ({ body: verified }),
    })
    renderApp(<EcoSurePage />)
    expect(screen.getByRole('tab', { name: 'Claims' })).toHaveAttribute('aria-selected', 'true')
    await user.click(await screen.findByRole('button', { name: 'CLM-2026-00001' }))
    const panel = screen.getByRole('dialog', { name: 'Claim CLM-2026-00001' })
    expect(within(panel).getByText('Neo Mokhothu · Child')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Open Medical certificate (natural cause)' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Verify documents' }))
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { action: 'verify_documents' } })
    expect(await within(panel).findByRole('button', { name: 'Start assessment' })).toBeInTheDocument()
  })

  it('rejecting needs a reason', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/ecosure/claims': () => ({ body: page([claim]) }),
      'POST /admin/v1/ecosure/claims/c1/decision': (c) => ({ body: { ...claim, status: 'rejected', reason: (c.body as { reason: string }).reason } }),
    })
    renderApp(<EcoSurePage />)
    await user.click(await screen.findByRole('button', { name: 'CLM-2026-00001' }))
    await user.click(screen.getByRole('button', { name: 'Reject…' }))
    const dialog = screen.getByRole('dialog', { name: 'Reject CLM-2026-00001' })
    await user.click(within(dialog).getByRole('button', { name: 'Reject claim' }))
    expect(within(dialog).getByText(/Give the reason/)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    await user.type(within(dialog).getByLabelText('Reason'), 'Documents do not match')
    await user.click(within(dialog).getByRole('button', { name: 'Reject claim' }))
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { action: 'reject', reason: 'Documents do not match' } })
  })

  it('prices a submitted quote', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/ecosure/claims': () => ({ body: page([]) }),
      'GET /admin/v1/ecosure/quotes': () => ({ body: page([quote]) }),
      'POST /admin/v1/ecosure/quotes/Q-2026-000002/price': () => ({ body: { ...quote, status: 'priced', monthlyPremium: 450.5, expiresAt: '2026-11-15T08:00:00.000Z' } }),
    })
    renderApp(<EcoSurePage />)
    await user.click(screen.getByRole('tab', { name: 'Quotes' }))
    await user.click(await screen.findByRole('button', { name: 'Q-2026-000002' }))
    const panel = screen.getByRole('dialog', { name: 'Quote Q-2026-000002' })
    expect(within(panel).getByText('Toyota Vitz 2016')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Price quote…' }))
    const dialog = screen.getByRole('dialog', { name: 'Price Q-2026-000002' })
    await user.type(within(dialog).getByLabelText('Monthly premium (M)'), '450.50')
    await user.click(within(dialog).getByRole('button', { name: 'Send price' }))
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { monthlyPremium: 450.5 } })
    expect(await within(panel).findByText('M450.50 a month')).toBeInTheDocument()
  })

  it('lists policies with their status and sponsor', async () => {
    const user = userEvent.setup()
    mockFetch({
      'GET /admin/v1/ecosure/claims': () => ({ body: page([]) }),
      'GET /admin/v1/ecosure/policies': () => ({ body: page([policy]) }),
    })
    renderApp(<EcoSurePage />)
    await user.click(screen.getByRole('tab', { name: 'Policies' }))
    const table = await screen.findByRole('table', { name: 'Policies' })
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent('ES-000101')
    expect(row).toHaveTextContent('Grace period')
    expect(row).toHaveTextContent('16 Nov 2026')
    expect(row).toHaveTextContent('Thabo')
  })

  it('support accounts cannot decide claims', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ 'GET /admin/v1/ecosure/claims': () => ({ body: page([claim]) }) })
    renderApp(<EcoSurePage />, { admin: SUPPORT })
    await user.click(await screen.findByRole('button', { name: 'CLM-2026-00001' }))
    const verify = screen.getByRole('button', { name: 'Verify documents' })
    expect(verify).toHaveAttribute('aria-disabled', 'true')
    await user.click(verify)
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
})
