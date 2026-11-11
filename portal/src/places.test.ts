import { describe, expect, it } from 'vitest'
import { validatePlace, type PlaceValues } from './pages/Places'

const ok: PlaceValues = { kind: 'atm', name: 'EcoCash ATM Pioneer Mall', address: 'Pioneer Mall, Maseru', lat: '-29.3226', lng: '27.4993', hours: '24 hours', phone: '', code: '', enabled: true }

describe('validatePlace', () => {
  it('turns the typed fields into a place, leaving out empty optional ones', () => {
    const { errors, body } = validatePlace(ok)
    expect(errors).toEqual({})
    expect(body).toEqual({ kind: 'atm', name: 'EcoCash ATM Pioneer Mall', address: 'Pioneer Mall, Maseru', lat: -29.3226, lng: 27.4993, hours: '24 hours', phone: undefined, code: undefined, enabled: true })
  })

  it('refuses a location outside Lesotho (latitude and longitude swapped)', () => {
    const { errors, body } = validatePlace({ ...ok, lat: '27.4993', lng: '-29.3226' })
    expect(body).toBeNull()
    expect(errors.lat).toMatch(/Outside Lesotho/)
    expect(errors.lng).toMatch(/Outside Lesotho/)
  })

  it('needs a name, an address and both coordinates', () => {
    const { errors } = validatePlace({ ...ok, name: ' ', address: '', lat: '', lng: 'abc' })
    expect(Object.keys(errors).sort()).toEqual(['address', 'lat', 'lng', 'name'])
  })
})
