import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiModel, FraudCaseDetail } from '../../shared/api'
import { AuthProvider } from './auth'
import { ToastProvider } from './components/Toast'
import { AiGovernancePage } from './pages/AiGovernance'
import { CasesPage } from './pages/Cases'
import { ADMIN, mockFetch, renderApp, SUPPORT } from './test/utils'

afterEach(() => vi.unstubAllGlobals())

const stats = { decisions: 120, byOutcome: { allow: 110, flag: 8, block: 2, info: 0 }, confirmedFraud: 3, falsePositives: 1, precision: 0.75, scoreBuckets: [80, 20, 5, 3, 2, 2, 4, 2, 1, 1], avgScore: { lastWeek: 12, before: 11 } }
const score: AiModel = { key: 'fraud_score', version: 2, mode: 'active', params: { flagAt: 60, blockAt: 0, caseAt: 80 }, changedBy: 'thabo@etl.co.ls', changedAt: '2026-11-10T08:00:00.000Z', note: 'Tuned', provider: 'In-house, explainable', available: true, stats }
const summary: AiModel = { ...score, key: 'case_summary', version: 0, mode: 'active', params: {}, changedBy: null, changedAt: null, note: null, provider: 'Anthropic claude-opus-5-5', stats: { ...stats, scoreBuckets: [] } }

describe('AI governance', () => {
  it('shows what each model decides and how often staff agree, and saves a change only with a reason', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/ai/models': () => ({ body: [score, summary] }),
      'PUT /admin/v1/ai/models/fraud_score': (c) => ({ body: { ...score, version: 3, ...(c.body as object) } }),
    })
    renderApp(<AiGovernancePage />)
    expect(await screen.findByRole('heading', { name: /Behavioural fraud score/ })).toBeInTheDocument()
    expect(screen.getAllByText('75%')).toHaveLength(2)
    expect(screen.getAllByText(/Human oversight/).length).toBe(2)

    await user.click(screen.getByRole('radio', { name: 'Shadow (log only)' }))
    const save = screen.getByRole('button', { name: 'Save as version 3' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Why are you changing it?'), 'Test new thresholds')
    await user.click(save)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toMatchObject({ mode: 'shadow', params: { flagAt: 60 }, note: 'Test new thresholds' })
  })

  it('is read-only for support staff', async () => {
    mockFetch({ 'GET /admin/v1/ai/models': () => ({ body: [score] }) })
    renderApp(<AiGovernancePage />, { admin: SUPPORT })
    await screen.findByRole('heading', { name: /Behavioural fraud score/ })
    expect(screen.getByRole('radio', { name: 'Off' })).toBeDisabled()
  })
})

const detail: FraudCaseDetail = {
  id: 'c1', ref: 'CASE-000001', user: { id: 'u1', msisdn: '+26662000021', name: 'Lerato Mokoena', role: 'customer' }, status: 'open', priority: 'high',
  title: 'Unusual behaviour (risk score)', assignedTo: null, alertCount: 1, openAlerts: 1, amount: 600, frozen: false, strRef: null, strFiledAt: null,
  createdAt: '2026-11-11T08:00:00.000Z', updatedAt: '2026-11-11T08:00:00.000Z', closedAt: null,
  alerts: [{
    id: 'a1', user: { id: 'u1', msisdn: '+26662000021', name: 'Lerato Mokoena', role: 'customer' }, rule: 'behaviour_score', action: 'flagged', severity: 'high',
    detail: 'Score 85: new phone; empties the wallet', amount: 600, kind: 'cashout', status: 'open', reviewedBy: null, createdAt: '2026-11-11T08:00:00.000Z',
    score: 85, decisionId: 'd1', caseId: 'c1', caseRef: 'CASE-000001',
  }],
  events: [{ id: 'e1', actor: 'system', kind: 'created', text: 'Opened automatically by a serious alert.', createdAt: '2026-11-11T08:00:00.000Z' }],
  transactions: [{ reference: 'MP2611110001', kind: 'cashout', direction: 'out', amount: 600, counterparty: 'Agent Ntate', createdAt: '2026-11-11T08:00:00.000Z', flagged: true }],
  wallet: { status: 'active', balance: 0, kycTier: 2, createdAt: '2026-10-01T08:00:00.000Z', phones: 2 },
  summary: { text: 'What happened: the customer cashed out the whole balance.', createdAt: '2026-11-11T09:00:00.000Z', by: 'AI summary for thabo@etl.co.ls' },
}

const renderCase = () =>
  render(
    <MemoryRouter initialEntries={['/cases/c1']}>
      <ToastProvider>
        <AuthProvider initialAdmin={ADMIN}>
          <Routes><Route path="/cases/:id" element={<CasesPage />} /></Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  )

describe('case', () => {
  it('shows the alerts, payments and the AI draft labelled as such, and closes with a finding', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/cases/c1': () => ({ body: detail }),
      'POST /admin/v1/cases/c1/close': () => ({ body: { ...detail, status: 'closed_fraud', openAlerts: 0, closedAt: '2026-11-11T10:00:00.000Z' } }),
    })
    renderCase()
    expect(await screen.findByRole('heading', { name: /CASE-000001/ })).toBeInTheDocument()
    expect(screen.getByText(/Written by AI \(Claude\).*never a finding/)).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Alerts in this case' })).getByText('85')).toBeInTheDocument()
    expect(screen.getByText('MP2611110001')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close case' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /false alarm/ }))
    await user.type(within(dialog).getByLabelText('What you found'), 'Customer bought a car')
    await user.click(within(dialog).getByRole('button', { name: 'Close case' }))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ outcome: 'ok', note: 'Customer bought a car' })
    expect(await screen.findByText('Closed: fraud', { selector: '.tag, span' })).toBeInTheDocument()
  })
})
