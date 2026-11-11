import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import type { EsSponsorship } from '../../../shared/api'
import { useMoqoqo } from '../../state/useMoqoqo'
import { ecosure } from '../../miniapps/ecosure/api'
import { useEcoSure } from '../../miniapps/ecosure/data'
import { coverName, maloti, normaliseMsisdn } from '../../miniapps/ecosure/format'
import { useEsT } from '../../miniapps/ecosure/strings'
import { es, esType, space } from '../../miniapps/ecosure/theme'
import { Badge, Card, EsScreen, Field, Loading, PrimaryButton, SmallButton } from '../../miniapps/ecosure/ui'

/** Sponsor: pay for a family member's EcoSure cover. They accept in their EcoSure. Rules TBC with SEFS. */
export default function Sponsor() {
  const t = useEsT()
  const { fail } = useMoqoqo()
  const { sponsorships, refresh } = useEcoSure()
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const msisdn = normaliseMsisdn(number)
    if (!msisdn) return Alert.alert(t.theirNumber, t.badNumber)
    setBusy(true)
    try {
      const s = await ecosure.sponsor(msisdn)
      setNumber('')
      await refresh()
      router.push({ pathname: '/ecosure/done', params: { title: t.sponsorSent, body: t.sponsorSentBody(s.member.name.split(' ')[0]) } })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const act = async (id: string, action: 'accept' | 'decline' | 'cancel') => {
    try {
      await ecosure.sponsorAction(id, action)
      await refresh()
    } catch (e) {
      fail(e)
    }
  }

  const row = (s: EsSponsorship, mine: boolean) => (
    <Card key={s.id} style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: es.text, flex: 1 }}>{mine ? s.member.name : s.sponsor.name}</Text>
        <Badge label={t.sponsorStatus[s.status]} tone={s.status === 'active' ? 'success' : s.status === 'awaiting' ? 'info' : 'warning'} />
      </View>
      <Text style={esType.small}>{s.policy.packageName} {coverName(s.policy.cover, t)} · {t.perMonth(maloti(s.policy.premium))}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {mine && s.status === 'active' ? <SmallButton label={t.payTheirs} onPress={() => router.push({ pathname: '/ecosure/pay', params: { ref: s.policy.number } })} /> : null}
        {!mine && s.status === 'awaiting' ? (
          <>
            <SmallButton label={t.accept} onPress={() => act(s.id, 'accept')} />
            <SmallButton label={t.decline} color={es.textSoft} onPress={() => act(s.id, 'decline')} />
          </>
        ) : null}
        {(s.status === 'active' || (mine && s.status === 'awaiting')) ? <SmallButton label={t.stop} color={es.danger} onPress={() => act(s.id, 'cancel')} /> : null}
      </View>
    </Card>
  )

  const mine = sponsorships?.mine.filter((s) => s.status === 'awaiting' || s.status === 'active') ?? []
  const forMe = sponsorships?.forMe.filter((s) => s.status === 'awaiting' || s.status === 'active') ?? []

  return (
    <EsScreen title={t.sponsorTitle} cta={<PrimaryButton label={t.sendSponsor} onPress={send} loading={busy} />}>
      <Text style={esType.body}>{t.sponsorIntro}</Text>
      {!sponsorships ? <Loading /> : (
        <>
          {mine.length ? <><Text style={esType.h3}>{t.peopleYouSponsor}</Text>{mine.map((s) => row(s, true))}</> : null}
          {forMe.length ? <><Text style={esType.h3}>{t.sponsoringYou}</Text>{forMe.map((s) => row(s, false))}</> : null}
        </>
      )}
      <Text style={[esType.h3, { marginTop: space(2) }]}>{t.addSponsorship}</Text>
      <Field label={t.theirNumber} placeholder="6200 0021" keyboardType="phone-pad" value={number} onChangeText={setNumber} />
      <Text style={esType.small}>{t.sponsorHint}</Text>
    </EsScreen>
  )
}
