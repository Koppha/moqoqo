import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Feedback, Place } from '../../shared/api'
import { FeedbackPage } from './pages/Feedback'
import { PlacesPage, validatePlace, type PlaceValues } from './pages/Places'
import { validateContact } from './pages/Settings'
import { mockFetch, renderApp, SUPPORT } from './test/utils'

const agent: Place = {
  id: 'pl-1', kind: 'agent', name: 'Kingsway Agent', address: 'Kingsway, next to Pioneer Mall, Maseru', lat: -29.3151, lng: 27.4869,
  hours: 'Mon–Sat 08:00–18:00', code: 'AGENT-0101', enabled: true, updatedAt: '2026-11-01T08:00:00.000Z',
}
const atm: Place = { id: 'pl-2', kind: 'atm', name: 'Pioneer Mall ATM', address: 'Pioneer Mall, Maseru', lat: -29.32, lng: 27.49, hours: '24 hours', enabled: false, updatedAt: '2026-11-01T08:00:00.000Z' }

const values = (over: Partial<PlaceValues> = {}): PlaceValues => ({
  kind: 'agent', name: 'Ha Abia Agent', address: 'Ha Abia, Maseru', lat: '-29.33', lng: '27.50', hours: '', phone: '', code: '', enabled: true, ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('Places', () => {
  it('refuses coordinates outside Lesotho (a swapped pair)', () => {
    expect(validatePlace(values()).body).toEqual({ kind: 'agent', name: 'Ha Abia Agent', address: 'Ha Abia, Maseru', lat: -29.33, lng: 27.5, enabled: true })
    const swapped = validatePlace(values({ lat: '27.50', lng: '-29.33' }))
    expect(swapped.body).toBeNull()
    expect(swapped.errors.lat).toMatch(/Outside Lesotho/)
    expect(swapped.errors.lng).toMatch(/Outside Lesotho/)
    expect(validatePlace(values({ lat: '' })).errors.lat).toMatch(/click the map/)
  })

  it('lists places, filters by kind and search', async () => {
    const user = userEvent.setup()
    mockFetch({ 'GET /admin/v1/places': () => ({ body: [agent, atm] }) })
    renderApp(<PlacesPage />)
    expect(await screen.findByText('Kingsway Agent')).toBeInTheDocument()
    expect(screen.getByText('Pioneer Mall ATM')).toBeInTheDocument()
    expect(screen.getByText('AGENT-0101')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Kind'), 'atm')
    expect(screen.queryByText('Kingsway Agent')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Kind'), '')
    await user.type(screen.getByLabelText('Search places'), 'kingsway')
    expect(screen.queryByText('Pioneer Mall ATM')).not.toBeInTheDocument()
    expect(screen.getByText('Kingsway Agent')).toBeInTheDocument()
  })

  it('adds a place, but not with coordinates outside Lesotho', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/places': () => ({ body: [agent] }),
      'POST /admin/v1/places': (c) => ({ body: { ...(c.body as object), id: 'pl-3', updatedAt: '2026-11-07T08:00:00.000Z' } }),
    })
    renderApp(<PlacesPage />)
    await screen.findByText('Kingsway Agent')
    await user.click(screen.getByRole('button', { name: 'Add place' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Kind'), 'merchant')
    await user.type(within(dialog).getByLabelText('Name'), 'Shoprite Maseru')
    await user.type(within(dialog).getByLabelText(/^Address/), 'Maseru Mall')
    await user.type(within(dialog).getByLabelText(/^Latitude/), '27.48')
    await user.type(within(dialog).getByLabelText(/^Longitude/), '-29.31')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getAllByText(/Outside Lesotho/)).toHaveLength(2)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await user.clear(within(dialog).getByLabelText(/^Latitude/))
    await user.type(within(dialog).getByLabelText(/^Latitude/), '-29.31')
    await user.clear(within(dialog).getByLabelText(/^Longitude/))
    await user.type(within(dialog).getByLabelText(/^Longitude/), '27.48')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ kind: 'merchant', name: 'Shoprite Maseru', address: 'Maseru Mall', lat: -29.31, lng: 27.48, enabled: true })
  })

  it('deletes a place after confirming', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      'GET /admin/v1/places': () => ({ body: [agent] }),
      'DELETE /admin/v1/places/pl-1': () => ({ status: 204 }),
    })
    renderApp(<PlacesPage />)
    await user.click(await screen.findByRole('button', { name: 'Kingsway Agent' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete place' }))
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })

  it('is read-only for support staff', async () => {
    mockFetch({ 'GET /admin/v1/places': () => ({ body: [agent] }) })
    renderApp(<PlacesPage />, { admin: SUPPORT })
    await screen.findByText('Kingsway Agent')
    expect(screen.getByRole('button', { name: 'Add place' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('Feedback', () => {
  const fb = (id: string, rating: number, text: string | null): Feedback => ({
    id, rating, text, app: 'customer', appVersion: '1.4.0', user: { id: 'u1', name: 'Palesa Mohapi', msisdn: '26662000021' }, createdAt: '2026-11-06T08:00:00.000Z',
  })

  it('lists feedback and filters by rating', async () => {
    const user = userEvent.setup()
    mockFetch({ 'GET /admin/v1/feedback': () => ({ body: [fb('f1', 5, 'Love it'), fb('f2', 2, 'Slow to open')] }) })
    renderApp(<FeedbackPage />)
    expect(await screen.findByText('Love it')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2 of 5 stars' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Rating'), '2')
    expect(screen.queryByText('Love it')).not.toBeInTheDocument()
    expect(screen.getByText('Slow to open')).toBeInTheDocument()
  })
})

describe('Contact us settings', () => {
  it('validates the contact details', () => {
    const ok = { phone: '199', whatsapp: '', email: 'ecocash@etl.co.ls', website: 'https://www.etl.co.ls', shareLink: 'https://www.etl.co.ls/ecocash' }
    expect(validateContact(ok).body).toEqual(ok)
    const bad = validateContact({ ...ok, whatsapp: '58000000', email: 'nope', shareLink: '' })
    expect(bad.body).toBeNull()
    expect(Object.keys(bad.errors).sort()).toEqual(['email', 'shareLink', 'whatsapp'])
  })
})
