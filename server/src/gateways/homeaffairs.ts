// Home Affairs (Lesotho national ID register): name, date of birth and gender for an ID number.
//
// MockHomeAffairs stands in until ETL has access to the real service. A real adapter implements `HomeAffairs`.

export interface IdRecord {
  fullName: string
  dob: string // YYYY-MM-DD
  gender: 'female' | 'male'
}

export interface HomeAffairs {
  /** null = Home Affairs has no such ID. */
  lookup(idNumber: string): Promise<IdRecord | null>
}

/** Demo IDs for the seeded wallets (see README). */
export const DEMO_IDS: Record<string, IdRecord> = {
  '9001010001': { fullName: 'Lerato Mokhothu', dob: '1990-01-01', gender: 'female' },
  '6203150002': { fullName: "'Mamello Mokhothu", dob: '1962-03-15', gender: 'female' },
  '8807220003': { fullName: 'Thabo Mokhothu', dob: '1988-07-22', gender: 'male' },
  '9511300004': { fullName: 'Palesa Letsie', dob: '1995-11-30', gender: 'female' },
  '7504100005': { fullName: 'Tšeliso Mokoena', dob: '1975-04-10', gender: 'male' },
  '8209090006': { fullName: "'Mamello Ramone", dob: '1982-09-09', gender: 'female' },
  '7901010007': { fullName: 'Lebohang Abia', dob: '1979-01-01', gender: 'male' },
}

const FIRST = { female: ['Lineo', 'Nthabiseng', "'Maseeiso", 'Refiloe', 'Mpho'], male: ['Teboho', 'Tumelo', 'Katleho', 'Lehlohonolo', 'Thabang'] }
const LAST = ['Mofolo', 'Lebona', 'Sekhonyana', 'Ramakatane', 'Phiri', 'Molapo']

/**
 * Mock: the demo IDs above, and any other 8–13 digit number as a made-up person: the first six digits are the date
 * of birth (YYMMDD) when they form a date, the seventh digit's parity the gender. Numbers ending 000 are unknown.
 */
export class MockHomeAffairs implements HomeAffairs {
  async lookup(idNumber: string): Promise<IdRecord | null> {
    const id = idNumber.replace(/\D/g, '')
    if (DEMO_IDS[id]) return DEMO_IDS[id]
    if (!/^\d{8,13}$/.test(id) || id.endsWith('000')) return null
    const yy = Number(id.slice(0, 2))
    const year = yy > 30 ? 1900 + yy : 2000 + yy
    let dob = `${year}-${id.slice(2, 4)}-${id.slice(4, 6)}`
    if (Number.isNaN(Date.parse(dob)) || Number(id.slice(2, 4)) > 12) dob = '1990-06-15'
    const gender = Number(id[6]) % 2 === 0 ? 'female' : 'male'
    const n = Number(id.slice(-3))
    return { fullName: `${FIRST[gender][n % 5]} ${LAST[n % LAST.length]}`, dob, gender }
  }
}
