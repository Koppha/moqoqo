import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { useT } from '../i18n'
import { pickContact, type PickedContact } from '../lib/phoneContacts'
import { useMoqoqo } from '../state/useMoqoqo'
import { colors } from '../theme'
import { Sheet, SheetOption } from './Sheet'
import { Icon } from './ui'

/**
 * Contacts icon inside a phone-number field (put it last in the field's row): opens the phone's contact list and gives
 * back an 8-digit Lesotho number (asking which one when the contact has several).
 */
export function ContactPickButton({ onPick }: { onPick: (number: string, name: string) => void }) {
  const t = useT()
  const { toast } = useMoqoqo()
  const [choice, setChoice] = useState<PickedContact | null>(null)

  const open = async () => {
    const r = await pickContact().catch(() => null)
    if (r === 'denied') return toast(t.contacts.denied)
    if (!r) return
    if (!r.numbers.length) return toast(t.contacts.noNumber(r.name))
    if (r.numbers.length === 1) return onPick(r.numbers[0], r.name)
    setChoice(r)
  }

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t.contacts.pick} onPress={open} style={s.icon} hitSlop={10}>
        <Icon name="people-circle-outline" size={26} color={colors.primary} />
      </Pressable>
      <Sheet visible={!!choice} title={choice?.name || t.contacts.which} onClose={() => setChoice(null)}>
        {choice?.numbers.map((n) => (
          <SheetOption key={n} icon="call-outline" title={`+266 ${n.slice(0, 4)} ${n.slice(4)}`} subtitle={n.startsWith('6') ? 'Econet' : 'Vodacom'}
            onPress={() => { setChoice(null); onPick(n, choice.name) }} />
        ))}
      </Sheet>
    </>
  )
}

const s = StyleSheet.create({
  icon: { paddingHorizontal: 4, justifyContent: 'center' },
})
