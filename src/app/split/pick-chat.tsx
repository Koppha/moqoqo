import { router } from 'expo-router'
import { PeopleSearch } from '../../components/PeopleSearch'
import { Header, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { useChats } from '../../state/AppState'
import { useMoqoqo } from '../../state/useMoqoqo'

/**
 * Split bill, step 1: who the bill goes to. One search over recent chats, EcoCash friends and the phone's contacts
 * (people with EcoCash only, not official accounts); a typed number works too. More people can join on the next step.
 */
export default function PickChat() {
  const t = useT()
  const { startChat } = useMoqoqo()
  const chats = useChats().filter((c) => !c.official && !c.request)

  const open = (chatId: string) => router.push({ pathname: '/split/new', params: { chatId } })

  return (
    <Screen>
      <Header title={t.split.selectChat} />
      <PeopleSearch chats={chats} onChat={open} onPerson={async (p) => {
        const id = await startChat(p.msisdn)
        if (id) open(id)
      }} />
    </Screen>
  )
}
