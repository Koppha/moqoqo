import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { PeopleSearch } from '../../components/PeopleSearch'
import { Header, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { useChats } from '../../state/AppState'
import { useMoqoqo } from '../../state/useMoqoqo'

/**
 * School fees › Ask family to pay: who gets the Ntefelle request. Same search as Split bill (recent chats, EcoCash
 * friends, contacts, a typed number). The request carries the learner's reference; whoever pays, the money goes
 * straight to the school.
 */
export default function AskSchoolFees() {
  const t = useT()
  const { account, detail, amount } = useLocalSearchParams<{ account: string; detail: string; amount?: string }>()
  const { state, createRequest, startChat } = useMoqoqo()
  const chats = useChats().filter((c) => !c.official && !c.request)
  // A chat just started with someone new: ask once it is in the app's state (the request needs its members).
  const [started, setStarted] = useState<string | null>(null)
  const asked = useRef<string | null>(null)

  const send = async (chatId: string) => {
    const preset = Number(amount) > 0 ? Number(amount) : undefined
    if (await createRequest(chatId, 'school', preset, { account, detail })) router.replace({ pathname: '/chat/[id]', params: { id: chatId } })
  }

  useEffect(() => {
    if (!started || !state.chats[started] || asked.current === started) return
    asked.current = started
    void send(started)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, state.chats])

  return (
    <Screen>
      <Header title={t.school.askTitle} />
      <PeopleSearch chats={chats} onChat={send} onPerson={async (p) => {
        const id = await startChat(p.msisdn)
        if (id) setStarted(id)
      }} />
    </Screen>
  )
}
