import { AppTabs } from '../../../components/AppTabs'
import { APP } from '../../../lib/variant'
import { useEsT } from '../../../miniapps/ecosure/strings'

/** EcoSure's own tabs: Home, My policy, Claims, Payments; the standalone EcoSure app adds Me (in EcoCash Super App that's EcoCash Super App's own Me). */
export default function EcoSureTabs() {
  const t = useEsT()
  return (
    <AppTabs items={[
      { name: 'index', href: '/ecosure', icon: 'home', label: t.tabs.home },
      { name: 'policy', href: '/ecosure/policy', icon: 'shield-checkmark', label: t.tabs.policy },
      { name: 'claims', href: '/ecosure/claims', icon: 'clipboard', label: t.tabs.claims },
      { name: 'pay', href: '/ecosure/pay', icon: 'card', label: t.tabs.pay },
      ...(APP === 'ecosure' ? [{ name: 'me', href: '/ecosure/me' as const, icon: 'person' as const, label: t.tabs.me }] : []),
    ]} />
  )
}
