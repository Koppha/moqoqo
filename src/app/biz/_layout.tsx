import { AppTabs } from '../../components/AppTabs'
import { useT } from '../../i18n'
import { useAppShortcuts } from '../../lib/shortcuts'
import { useAuth } from '../../state/Auth'

/** EcoCash Business (agents and merchants): Home, Chats, Me. */
export default function BusinessTabs() {
  const t = useT()
  useAppShortcuts(useAuth().session?.user.role)
  return (
    <AppTabs items={[
      { name: 'index', href: '/biz', icon: 'home', label: t.tabs.home },
      { name: 'chats', href: '/biz/chats', icon: 'chatbubbles', label: t.tabs.chats },
      { name: 'me', href: '/biz/me', icon: 'person', label: t.tabs.me },
    ]} />
  )
}
