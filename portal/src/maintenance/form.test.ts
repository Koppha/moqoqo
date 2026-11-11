import { describe, expect, it } from 'vitest'
import { DEFAULT_MESSAGE, initialValues, validateMaintenance, type MaintenanceFormValues } from './form'

// 2026-10-12 10:00 in Maseru.
const NOW = new Date('2026-10-12T08:00:00.000Z')

const base: MaintenanceFormValues = {
  startNow: false,
  startDate: '2026-10-12',
  startTime: '22:00',
  endDate: '2026-10-13',
  endTime: '02:00',
  ...DEFAULT_MESSAGE,
}

describe('validateMaintenance', () => {
  it('accepts a valid future window and converts Maseru times to UTC', () => {
    const { errors, body } = validateMaintenance(base, NOW)
    expect(errors).toEqual({})
    expect(body).toEqual({
      startsAt: '2026-10-12T20:00:00.000Z',
      endsAt: '2026-10-13T00:00:00.000Z',
      message: { en: DEFAULT_MESSAGE.en, st: DEFAULT_MESSAGE.st },
    })
  })

  it('"Start now" sets startsAt to now and ignores the start inputs', () => {
    const { errors, body } = validateMaintenance({ ...base, startNow: true, startDate: '', startTime: '' }, NOW)
    expect(errors).toEqual({})
    expect(body?.startsAt).toBe(NOW.toISOString())
  })

  it('requires the end to be after the start', () => {
    const { errors, body } = validateMaintenance({ ...base, endDate: '2026-10-12', endTime: '21:00' }, NOW)
    expect(body).toBeNull()
    expect(errors.end).toMatch(/after the start/)
  })

  it('rejects an end equal to the start', () => {
    const { errors } = validateMaintenance({ ...base, endDate: '2026-10-12', endTime: '22:00' }, NOW)
    expect(errors.end).toMatch(/after the start/)
  })

  it('with "Start now", an end earlier than now is rejected', () => {
    const { errors, body } = validateMaintenance({ ...base, startNow: true, endDate: '2026-10-12', endTime: '09:00' }, NOW)
    expect(body).toBeNull()
    expect(errors.end).toBeTruthy()
  })

  it('requires the end to be in the future when editing an active window', () => {
    const lockedStart = '2026-10-12T06:00:00.000Z' // 08:00 Maseru, already started
    const { errors } = validateMaintenance({ ...base, endDate: '2026-10-12', endTime: '09:30' }, NOW, { lockedStart })
    expect(errors.end).toMatch(/future/)
    expect(errors.start).toBeUndefined()
    const ok = validateMaintenance({ ...base, endDate: '2026-10-12', endTime: '12:00' }, NOW, { lockedStart })
    expect(ok.body?.startsAt).toBe(lockedStart)
  })

  it('rejects a scheduled start in the past', () => {
    const { errors } = validateMaintenance({ ...base, startTime: '09:00' }, NOW)
    expect(errors.start).toMatch(/in the past/)
  })

  it('requires both the English and the Sesotho message', () => {
    const { errors, body } = validateMaintenance({ ...base, en: '  ', st: '' }, NOW)
    expect(body).toBeNull()
    expect(errors.en).toBeTruthy()
    expect(errors.st).toBeTruthy()
  })

  it('reports missing dates', () => {
    const { errors } = validateMaintenance({ ...base, startDate: '', endTime: '' }, NOW)
    expect(errors.start).toBeTruthy()
    expect(errors.end).toBeTruthy()
  })

  it('defaults to a valid 2-hour window from the next whole hour, with both messages prefilled', () => {
    const now = new Date('2026-10-12T08:20:00.000Z') // 10:20 Maseru
    const v = initialValues(now)
    expect(v).toMatchObject({ startDate: '2026-10-12', startTime: '11:00', endDate: '2026-10-12', endTime: '13:00' })
    expect(v.en).toBe(DEFAULT_MESSAGE.en)
    expect(v.st).toBe(DEFAULT_MESSAGE.st)
    expect(validateMaintenance(v, now).body).not.toBeNull()
  })
})
