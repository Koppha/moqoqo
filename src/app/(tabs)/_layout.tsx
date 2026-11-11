import { useMemo } from 'react'
import { AppTabs, type CycleStep } from '../../components/AppTabs'
import { useT } from '../../i18n'
import { useAppShortcuts } from '../../lib/shortcuts'
import { useAuth } from '../../state/Auth'

export default function TabLayout() {
  const t = useT()
  useAppShortcuts(useAuth().session?.user.role)
  // Tap to pay, QR and scan: the centre button shows them in turn, symbol and word together.
  const centre = useMemo<CycleStep[]>(() => [
    { icon: 'wifi', label: t.tabs.tap },
    { icon: 'qr-code', label: t.tabs.qr },
    { icon: 'scan', label: t.tabs.scan },
  ], [t])
  return (
    <AppTabs items={[
      { name: 'index', href: '/', icon: 'home', label: t.tabs.home },
      { name: 'chats', href: '/chats', icon: 'chatbubbles', label: t.tabs.chats },
      { name: 'tap', href: '/tap', icon: 'wifi', label: t.tabs.tap, center: true, cycle: centre },
      { name: 'services', href: '/services', icon: 'grid', label: t.tabs.services },
      { name: 'me', href: '/me', icon: 'person', label: t.tabs.me },
    ]} />
  )
}
