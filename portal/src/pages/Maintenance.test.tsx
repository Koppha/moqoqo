import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MaintenanceBody, MaintenanceWindow } from '../../../shared/api'
import { DEFAULT_MESSAGE } from '../maintenance/form'
import { mockFetch, renderApp } from '../test/utils'
import { MaintenancePage } from './Maintenance'

// 2026-10-12 10:00 Maseru.
const NOW = new Date('2026-10-12T08:00:00.000Z')
const clock = () => NOW

const scheduled: MaintenanceWindow = {
  id: 'm2',
  startsAt: '2026-10-14T20:00:00.000Z',
  endsAt: '2026-10-14T23:00:00.000Z',
  message: DEFAULT_MESSAGE,
  status: 'scheduled',
  createdBy: 'thabo@etl.co.ls',
  createdAt: '2026-10-10T07:00:00.000Z',
}
const ended: MaintenanceWindow = { ...scheduled, id: 'm1', status: 'ended', startsAt: '2026-09-01T20:00:00.000Z', endsAt: '2026-09-01T22:00:00.000Z' }

afterEach(() => vi.unstubAllGlobals())

describe('Maintenance page', () => {
  it('lists windows with status chips and creator', async () => {
    mockFetch({ 'GET /admin/v1/maintenance': () => ({ body: [scheduled, ended] }) })
    renderApp(<MaintenancePage clock={clock} />)
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Scheduled')).toBeInTheDocument()
    expect(within(table).getByText('Ended')).toBeInTheDocument()
    expect(within(table).getAllByText('thabo@etl.co.ls')).toHaveLength(2)
    // 20:00 UTC = 22:00 Maseru
    expect(within(table).getByText('Wed 14 Oct 2026, 22:00')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockFetch({ 'GET /admin/v1/maintenance': () => ({ body: [] }) })
    renderApp(<MaintenancePage clock={clock} />)
    expect(await screen.findByText('No maintenance windows yet')).toBeInTheDocument()
  })

  it("shows a clear \"can't reach the server\" state on network failure", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    renderApp(<MaintenancePage clock={clock} />)
    expect(await screen.findByText("Can't reach the EcoCash Super App server")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('validates the form: end after start, and both messages required', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ 'GET /admin/v1/maintenance': () => ({ body: [] }) })
    renderApp(<MaintenancePage clock={clock} />)
    await user.click(await screen.findByRole('button', { name: /Schedule maintenance/ }))

    const form = screen.getByRole('form', { name: 'Schedule maintenance' })
    // Prefilled with the default texts and a flagged Sesotho draft.
    expect(within(form).getByLabelText('Message in English')).toHaveValue(DEFAULT_MESSAGE.en)
    expect(within(form).getByText('Needs review by a Sesotho speaker')).toBeInTheDocument()

    await user.clear(within(form).getByLabelText('End date'))
    await user.type(within(form).getByLabelText('End date'), '2026-10-12')
    await user.clear(within(form).getByLabelText('End time'))
    await user.type(within(form).getByLabelText('End time'), '10:30') // before the default 11:00 start
    await user.clear(within(form).getByLabelText(/Message in Sesotho/))
    await user.click(within(form).getByRole('button', { name: 'Schedule maintenance' }))

    expect(await within(form).findByText('The end must be after the start.')).toBeInTheDocument()
    expect(within(form).getByText('Enter the Sesotho message.')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('"Start now" confirms, then posts startsAt = now with both messages', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/maintenance': () => ({ body: [] }),
      'POST /admin/v1/maintenance': (c) => {
        const b = c.body as MaintenanceBody
        return { body: { id: 'm9', ...b, status: 'active', createdBy: 'thabo@etl.co.ls', createdAt: NOW.toISOString() } }
      },
    })
    renderApp(<MaintenancePage clock={clock} />)
    await user.click(await screen.findByRole('button', { name: /Schedule maintenance/ }))
    const form = screen.getByRole('form', { name: 'Schedule maintenance' })

    await user.click(within(form).getByLabelText(/Start now/))
    expect(within(form).queryByLabelText('Start date')).not.toBeInTheDocument()
    expect(within(form).getByText(/Now — Mon 12 Oct 2026, 10:00/)).toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Start maintenance now' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start maintenance now?' })
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Start maintenance now' }))

    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1))
    const body = calls.find((c) => c.method === 'POST')!.body as MaintenanceBody
    expect(body.startsAt).toBe(NOW.toISOString())
    expect(body.endsAt).toBe('2026-10-12T11:00:00.000Z') // default end: 13:00 Maseru
    expect(body.message).toEqual(DEFAULT_MESSAGE)
    expect(await screen.findByText('Maintenance has started.')).toBeInTheDocument()
    // The new active window appears in the list with an End now action.
    expect(await screen.findAllByRole('button', { name: 'End now' })).not.toHaveLength(0)
  })

  it('live preview follows the message and language', async () => {
    const user = userEvent.setup()
    mockFetch({ 'GET /admin/v1/maintenance': () => ({ body: [] }) })
    renderApp(<MaintenancePage clock={clock} />)
    await user.click(await screen.findByRole('button', { name: /Schedule maintenance/ }))
    const preview = screen.getByRole('figure', { name: /in English/ })
    expect(within(preview).getByText('Planned maintenance')).toBeInTheDocument()
    expect(within(preview).getByText('Back at 13:00')).toBeInTheDocument()

    const en = screen.getByLabelText('Message in English')
    await user.clear(en)
    await user.type(en, 'Back soon')
    expect(within(preview).getByText('Back soon')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Sesotho' }))
    const st = screen.getByRole('figure', { name: /in Sesotho/ })
    expect(within(st).getByText(DEFAULT_MESSAGE.st)).toBeInTheDocument()
    expect(within(st).getByText('Re khutla ka 13:00')).toBeInTheDocument()
  })

  it('cancels a scheduled window after confirmation', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/maintenance': () => ({ body: [scheduled] }),
      'POST /admin/v1/maintenance/m2/cancel': () => ({ body: { ...scheduled, status: 'cancelled' } }),
    })
    renderApp(<MaintenancePage clock={clock} />)
    await user.click(await screen.findByRole('button', { name: /Cancel window starting/ }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel this maintenance window?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel window' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/v1/maintenance/m2/cancel'))).toBe(true))
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
  })
})
