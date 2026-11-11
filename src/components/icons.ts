import type { PublicUser, SocietyKind } from '../../shared/api'
import { colors } from '../theme'
import type { BillKey, Chat } from '../types'
import type { IconName } from './ui'

/** How each kind of society looks in lists and on its screen. */
export const KIND_LOOK: Record<SocietyKind, { icon: IconName; color: string }> = {
  society: { icon: 'people', color: colors.primary },
  motselo: { icon: 'wallet', color: '#7A2FB0' },
  burial: { icon: 'people-circle', color: '#6B7280' },
}

/** Icon for a person or business: billers and merchants get one, people get initials (undefined). */
export function chatIcon(u: PublicUser | undefined): IconName | undefined {
  if (!u) return undefined
  if (u.official && /LEC/i.test(u.name)) return 'flash'
  if (u.role === 'merchant') return /taxi/i.test(u.businessName ?? u.name) ? 'bus' : 'storefront'
  if (u.role === 'agent') return 'cash'
  return undefined
}

export const iconForChat = (c: Chat): IconName | undefined => (c.group ? 'people' : c.assistant ? 'sparkles' : c.support ? 'headset' : chatIcon(c.other))

export const BILL_ICON: Record<BillKey, { icon: IconName; color: string }> = {
  lec: { icon: 'flash', color: '#F59E0B' },
  wasco: { icon: 'water', color: '#0EA5E9' },
  school: { icon: 'school', color: '#5B2C9F' },
  airtime: { icon: 'call', color: '#16A34A' },
  burial: { icon: 'people-circle', color: '#6B7280' },
}

/** Icon and colour for a wallet transaction line. */
export function txIcon(description: string, amount: number): { icon: IconName; color: string } {
  if (/LEC/.test(description)) return BILL_ICON.lec
  if (/School/.test(description)) return BILL_ICON.school
  if (/Taxi/.test(description)) return { icon: 'bus', color: '#E0482F' }
  if (/Motšelo/.test(description)) return { icon: 'wallet', color: '#7A2FB0' }
  if (/Airtime/.test(description)) return BILL_ICON.airtime
  if (/Mpho/.test(description)) return { icon: 'gift', color: '#C81E1E' }
  if (/top-up/i.test(description)) return { icon: 'card', color: '#1A1F71' }
  if (/Bank|PostBank|^To /.test(description) && amount < 0) return { icon: 'business', color: '#0F766E' }
  if (/fee/i.test(description)) return { icon: 'receipt', color: '#6B7280' }
  if (/EcoSure/.test(description)) return { icon: 'shield-checkmark', color: '#5B2FD1' }
  return amount > 0 ? { icon: 'arrow-down', color: '#16A34A' } : { icon: 'arrow-up', color: '#5B2C9F' }
}
