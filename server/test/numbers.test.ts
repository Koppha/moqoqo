import { describe, expect, it } from 'vitest'
import { localNumber, phoneNetwork, toMsisdn } from '../../shared/api'
import { normalizeMsisdn } from '../src/lib/msisdn'

describe('Lesotho numbers in any form', () => {
  const forms = ['62000021', '6200 0021', '+266 6200 0021', '+26662000021', '26662000021', '266 62 000 021', '0026662000021', '00266 6200-0021', '(+266) 6200 0021']
  it.each(forms)('%s is +26662000021', (f) => {
    expect(toMsisdn(f)).toBe('+26662000021')
    expect(normalizeMsisdn(f)).toBe('+26662000021')
    expect(phoneNetwork(f)).toBe('econet')
  })
  it('typing with the prefix ends with the local digits', () => {
    expect(localNumber('+2')).toBe('2')
    expect(localNumber('+266')).toBe('')
    expect(localNumber('+266 62')).toBe('62')
    expect(localNumber('26662000021')).toBe('62000021')
  })
  it('refuses what is not a Lesotho mobile', () => {
    for (const bad of ['1234', '72000021', '+27 82 000 0021', '620000']) expect(toMsisdn(bad)).toBeNull()
    expect(() => normalizeMsisdn('72000021')).toThrow()
  })
})
