// EcoCash Super App's mini apps. EcoCash Super App is the super app shell (identity, PIN/biometrics, EcoCash wallet, chat); each mini app
// is built into the app (src/miniapps/<id>, routes under src/app/<id>) and listed here once, so Home and Services
// show the same catalogue. Items without `href` are placeholders that show a short note.
import type { Href } from 'expo-router'
import type { IconName } from '../components/ui'
import type { Strings } from '../i18n'

export type MiniAppSection = keyof Strings['services']['sections']
type ItemKey = keyof Strings['services']['items']
type ToastKey = keyof Strings['services']['toasts']

export interface MiniApp {
  id: ItemKey
  section: MiniAppSection
  icon: IconName
  color: string
  href?: Href
  toast?: ToastKey
  isNew?: boolean
  /** A portal service this tile opens: the tile shows that service's icon and colour, so both tiles look the same. */
  service?: string
  /** Left out of the Services page sections, when Services already lists it elsewhere (Buy airtime is in Airtime & more). */
  homeOnly?: boolean
  /** Shown in the Home services grid, in this order. */
  home?: number
}

export const MINI_APPS: MiniApp[] = [
  { id: 'ecosure', section: 'insurance', icon: 'shield-checkmark', color: '#5B2FD1', href: '/ecosure', isNew: true, home: 1 },
  { id: 'money', section: 'money', icon: 'qr-code', color: '#5B2C9F', href: '/money', home: 2 },
  { id: 'receive', section: 'money', icon: 'wallet', color: '#E8590C', href: '/receive-money' },
  { id: 'split', section: 'money', icon: 'document-text', color: '#0EA5E9', href: '/split', home: 5 },
  { id: 'insights', section: 'money', icon: 'pie-chart', color: '#7C3AED', href: '/insights', isNew: true },
  { id: 'scan', section: 'money', icon: 'storefront', color: '#16A34A', href: '/pay', home: 1.5 },
  { id: 'topup', section: 'money', icon: 'card', color: '#1A1F71', href: '/topup' },
  { id: 'bank', section: 'money', icon: 'business', color: '#0F766E', href: '/bank' },
  { id: 'remit', section: 'money', icon: 'globe', color: '#2563EB', href: '/remit', isNew: true },
  { id: 'cashout', section: 'money', icon: 'cash-outline', color: '#15803D', href: '/cashout', isNew: true },
  { id: 'atm', section: 'money', icon: 'cash', color: '#15803D', href: '/atm' },
  { id: 'paybill', section: 'bills', icon: 'receipt', color: '#0F766E', href: '/bills', isNew: true, home: 6 },
  { id: 'airtime', section: 'bills', icon: 'call', color: '#16A34A', href: { pathname: '/service/[id]', params: { id: 'svc-airtime' } }, isNew: true, home: 3, homeOnly: true, service: 'svc-airtime' },
  { id: 'lec', section: 'bills', icon: 'flash', color: '#F59E0B', href: '/lec' },
  { id: 'wasco', section: 'bills', icon: 'water', color: '#0EA5E9', href: { pathname: '/service/[id]', params: { id: 'bill-wasco' } } },
  { id: 'school', section: 'bills', icon: 'school', color: '#5B2C9F', href: '/school', isNew: true, home: 8 },
  { id: 'society', section: 'community', icon: 'people', color: '#0F766E', href: '/society', isNew: true, home: 7 },
  { id: 'donate', section: 'community', icon: 'heart-circle', color: '#DB2777', href: '/donate', isNew: true },
  { id: 'burial', section: 'community', icon: 'people-circle', color: '#6B7280', toast: 'burial' },
  { id: 'church', section: 'community', icon: 'heart', color: '#DB2777', toast: 'church' },
  { id: 'business', section: 'business', icon: 'storefront', color: '#5B2C9F', href: '/business', isNew: true },
  { id: 'taxi', section: 'business', icon: 'bus', color: '#E0482F', href: '/taxi' },
  { id: 'softpos', section: 'business', icon: 'storefront', color: '#16A34A', href: '/taxi' },
  { id: 'payroll', section: 'business', icon: 'briefcase', color: '#0F766E', toast: 'payroll' },
  { id: 'home', section: 'more', icon: 'home', color: '#E0482F', toast: 'home' },
  { id: 'agents', section: 'more', icon: 'location', color: '#5B2C9F', href: '/places' },
  { id: 'wool', section: 'more', icon: 'leaf', color: '#65A30D', toast: 'wool' },
]

export const SECTION_ORDER: MiniAppSection[] = ['insurance', 'money', 'bills', 'community', 'business', 'more']

/** The Home grid: the first apps by `home` order (the last cell is "See all"). */
export const homeApps = (n: number) =>
  MINI_APPS.filter((a) => a.home !== undefined).sort((a, b) => a.home! - b.home!).slice(0, n)
