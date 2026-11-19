import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTACT_DEFAULTS, USSD_DEFAULTS, type AppConfig, type Tariff } from '../../shared/api'
import { SettingsPage, validateTariff } from './pages/Settings'
import { KIND_LABEL } from './pages/Transactions'
import { mockFetch, renderApp, SUPPORT } from './test/utils'

const tariff: Tariff = { cardTopupFeePercent: 2, cardTopupFeeMin: 1, cardTopupMax: 5000, bankTransferFee: 10, bankTransferMax: 10000, dailyMax: 20000, atmFee: 5, atmMax: 3000 }
const config: AppConfig = { ussd: USSD_DEFAULTS, maintenance: null, announcement: null, minVersion: { customer: null, business: null, ecosure: null, society: null }, deviceSecurity: { blockRooted: false, blockDeveloperMode: false, requireSimMatch: true, idleMinutes: 15, sessionDays: 30, maxPinAttempts: 5, pinLockMinutes: 15 }, serverTime: '2026-10-12T08:00:00.000Z', branding: { logo: null, miniAppIcons: {} }, contact: CONTACT_DEFAULTS }
const values = (over: Partial<Record<keyof Tariff, string>> = {}) =>
  ({ ...Object.fromEntries(Object.entries(tariff).map(([k, v]) => [k, String(v)])), ...over }) as Record<keyof Tariff, string>

afterEach(() => vi.unstubAllGlobals())

describe('fees & limits', () => {
  it('validates the six values', () => {
    expect(validateTariff(values())).toEqual({ errors: {}, body: tariff })
    expect(validateTariff(values({ cardTopupFeePercent: '25' })).errors.cardTopupFeePercent).toBe('At most 20%.')
    expect(validateTariff(values({ bankTransferFee: '-1' })).errors.bankTransferFee).toBe("Can't be negative.")
    expect(validateTariff(values({ cardTopupMax: '20000' })).errors.cardTopupMax).toBe('At most M10,000.')
    expect(validateTariff(values({ cardTopupFeeMin: '1.005' })).errors.cardTopupFeeMin).toBe('At most 2 decimals.')
    expect(validateTariff(values({ dailyMax: '' })).errors.dailyMax).toBe('Enter a number.')
    expect(validateTariff(values({ dailyMax: '100' })).errors.dailyMax).toMatch(/at least/)
  })

  it('admins save the tariff', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /v1/app-config': () => ({ body: config }),
      'GET /admin/v1/tariff': () => ({ body: tariff }),
      'PUT /admin/v1/tariff': (c) => ({ body: c.body }),
    })
    renderApp(<SettingsPage />)
    const fee = await screen.findByLabelText('Bank transfer fee (M)')
    await user.clear(fee)
    await user.type(fee, '12.50')
    await user.click(screen.getByRole('button', { name: 'Save fees & limits' }))
    await screen.findByText(/Fees and limits saved/)
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ...tariff, bankTransferFee: 12.5 })
  })

  it('is read-only for support', async () => {
    mockFetch({ 'GET /v1/app-config': () => ({ body: config }), 'GET /admin/v1/tariff': () => ({ body: tariff }) })
    renderApp(<SettingsPage />, { admin: SUPPORT })
    expect(await screen.findByLabelText('Daily maximum (M)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save fees & limits' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('labels the new transaction kinds', () => {
    expect([KIND_LABEL.topup, KIND_LABEL.withdraw, KIND_LABEL.fee]).toEqual(['Card top-up', 'Bank transfer', 'Fee'])
  })
})
