import { describe, expect, it } from 'vitest'
import { formatDuration, formatMaseru, formatMaseruTime, maseruToIso, sameMaseruDay, toMaseruParts } from './time'

describe('Africa/Maseru time helpers', () => {
  it('converts Maseru wall-clock input to UTC (UTC+2, no DST)', () => {
    expect(maseruToIso('2026-10-12', '14:30')).toBe('2026-10-12T12:30:00.000Z')
    // Summer and winter give the same offset.
    expect(maseruToIso('2026-01-15', '08:00')).toBe('2026-01-15T06:00:00.000Z')
    expect(maseruToIso('2026-07-15', '08:00')).toBe('2026-07-15T06:00:00.000Z')
  })

  it('crosses midnight correctly', () => {
    expect(maseruToIso('2026-10-13', '01:00')).toBe('2026-10-12T23:00:00.000Z')
    expect(toMaseruParts('2026-12-31T23:30:00.000Z')).toEqual({ date: '2027-01-01', time: '01:30' })
  })

  it('round-trips UTC -> Maseru parts -> UTC', () => {
    for (const iso of ['2026-10-12T12:30:00.000Z', '2026-02-28T22:59:00.000Z', '2028-02-29T00:00:00.000Z', '2026-06-30T21:45:00.000Z']) {
      const { date, time } = toMaseruParts(iso)
      expect(maseruToIso(date, time)).toBe(iso)
    }
  })

  it('round-trips Maseru parts -> UTC -> Maseru parts', () => {
    const iso = maseruToIso('2026-03-01', '00:15')!
    expect(toMaseruParts(iso)).toEqual({ date: '2026-03-01', time: '00:15' })
  })

  it('rejects invalid or incomplete input', () => {
    expect(maseruToIso('', '10:00')).toBeNull()
    expect(maseruToIso('2026-10-12', '')).toBeNull()
    expect(maseruToIso('2026-02-31', '10:00')).toBeNull()
    expect(maseruToIso('2026-10-12', '24:00')).toBeNull()
  })

  it('formats for display in Maseru time regardless of the browser zone', () => {
    expect(formatMaseru('2026-10-12T12:30:00.000Z')).toBe('Mon 12 Oct 2026, 14:30')
    expect(formatMaseru('2026-10-12T22:05:00.000Z')).toBe('Tue 13 Oct 2026, 00:05')
    expect(formatMaseruTime('2026-10-12T22:05:00.000Z')).toBe('00:05')
    expect(formatMaseru(null)).toBe('—')
    expect(formatMaseru('not a date')).toBe('—')
  })

  it('compares Maseru calendar days, not UTC days', () => {
    expect(sameMaseruDay('2026-10-12T08:00:00Z', '2026-10-12T21:30:00Z')).toBe(true)
    expect(sameMaseruDay('2026-10-12T08:00:00Z', '2026-10-12T22:30:00Z')).toBe(false)
  })

  it('formats durations', () => {
    expect(formatDuration(45 * 60000)).toBe('45 min')
    expect(formatDuration(150 * 60000)).toBe('2 h 30 min')
    expect(formatDuration(27 * 3600000)).toBe('1 day 3 h')
  })
})
