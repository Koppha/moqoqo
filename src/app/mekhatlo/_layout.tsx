import { AppTabs } from '../../components/AppTabs'
import { useT } from '../../i18n'

/** The standalone Mekhatlo app: the user's societies, their chats, and Me. Society screens open on top of these. */
export default function MekhatloTabs() {
  const t = useT()
  return (
    <AppTabs items={[
      { name: 'index', href: '/mekhatlo', icon: 'people', label: t.society.title },
      { name: 'chats', href: '/mekhatlo/chats', icon: 'chatbubbles', label: t.tabs.chats },
      { name: 'me', href: '/mekhatlo/me', icon: 'person', label: t.tabs.me },
    ]} />
  )
}
