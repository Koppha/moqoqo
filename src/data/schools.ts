// School fees: the schools people can pick, and when fees are usually due. Payments go to the EcoCash school fees
// biller (bill 'school') with the school's code and the learner's number as the reference, so the school can match
// them. DEMO DATA: the list and the term dates are placeholders until schools are onboarded with their real codes
// and each school's own calendar (ideally from the server, like the portal's billers).

export interface School {
  code: string
  name: string
}

export const SCHOOLS: School[] = [
  { code: 'LHS', name: 'Lesotho High School' },
  { code: 'MACH', name: 'Machabeng College' },
  { code: 'SMHS', name: "St Mary's High School" },
  { code: 'SHHS', name: 'Sacred Heart High School' },
  { code: 'MPS', name: 'Maseru Preparatory School' },
]

/** Code for a school typed by hand (not in the list): the name goes in the reference instead. */
export const OTHER_SCHOOL = 'OTHER'

export type Term = 1 | 2 | 3

/**
 * When each term's fees are usually due (month 1-12, day). Placeholders: Lesotho schools mostly open in January,
 * April/May and August/September, but every school sets its own dates, so the app says "check your school's letter".
 */
export const TERM_DUE: Record<Term, { month: number; day: number }> = {
  1: { month: 1, day: 15 },
  2: { month: 4, day: 25 },
  3: { month: 8, day: 25 },
}

/** The next due date of each term from `now` on (this year's, or next year's when it has passed), soonest first. */
export function upcomingDueDates(now = new Date()): { term: Term; date: Date }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return ([1, 2, 3] as Term[])
    .map((term) => {
      const { month, day } = TERM_DUE[term]
      let date = new Date(now.getFullYear(), month - 1, day)
      if (date < today) date = new Date(now.getFullYear() + 1, month - 1, day)
      return { term, date }
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** The term whose fees are due next: the one to pay for now. */
export const currentTerm = (now = new Date()): Term => upcomingDueDates(now)[0].term

/** The reference the school sees: "LHS-20931", or the typed school's name for one not in the list. */
export function schoolAccount(schoolCode: string, otherName: string, studentNumber: string): string {
  const student = studentNumber.trim().replace(/\s+/g, '')
  if (schoolCode !== OTHER_SCHOOL) return `${schoolCode}-${student}`.slice(0, 40)
  const name = otherName.trim().replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').slice(0, 24)
  return `${name}-${student}`.slice(0, 40)
}

export const schoolName = (schoolCode: string, otherName: string) =>
  schoolCode === OTHER_SCHOOL ? otherName.trim() : SCHOOLS.find((s) => s.code === schoolCode)?.name ?? schoolCode
