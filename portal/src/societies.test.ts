import { describe, expect, it } from 'vitest'
import { validateSim } from './pages/SocietyApplications'
import { validateSociety } from './pages/Societies'

describe('Mekhatlo forms', () => {
  it('accepts a Lesotho SIM number in any common form', () => {
    for (const raw of ['63999001', '+266 6399 9001', '26663999001', '6399-9001']) {
      expect(validateSim(raw, '').body).toEqual({ simNumber: '+26663999001', code: undefined })
    }
    expect(validateSim('1234', '').error).toMatch(/8-digit/)
    expect(validateSim('63999001', '12').error).toMatch(/4 digits/)
    expect(validateSim('63999001', '5150').body?.code).toBe('5150')
  })

  it('a Motšelo needs its monthly amount', () => {
    expect(validateSociety('Pot', '', '62000021', '1', 'motselo', '').error).toMatch(/each member pays/)
    expect(validateSociety('Pot', '', '62000021', '1', 'motselo', '200').body).toMatchObject({ kind: 'motselo', contribution: 200 })
  })
})
