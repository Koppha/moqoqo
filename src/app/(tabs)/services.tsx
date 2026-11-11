import { StyleSheet, Text, View } from 'react-native'
import { MiniAppTile, ShortcutTile, useOpenMiniApp } from '../../components/MiniApps'
import { serviceIcon, useLocalized, useServices } from '../../lib/services'
import { openService } from '../../components/RecentsPanel'
import { Card, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { useLayout } from '../../lib/layout'
import { MINI_APPS, SECTION_ORDER } from '../../miniapps/registry'
import { colors } from '../../theme'

/** The mini-app catalogue, by section. */
export default function Services() {
  const t = useT()
  const open = useOpenMiniApp()
  const { tablet } = useLayout()
  const L = useLocalized()
  // Portal-defined services for the Services tab (Airtime, Bundles, …).
  const { services } = useServices('services')
  return (
    <Screen maxWidth={tablet ? 1100 : undefined}>
      <Text style={v.title}>{t.services.title}</Text>
      <Text style={v.subtitle}>{t.services.subtitle}</Text>
      {services.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <Text style={v.section}>{t.svc.everyday}</Text>
          <View style={v.grid}>
            {services.map((sv) => (
              <ShortcutTile key={sv.id} icon={serviceIcon(sv)} color={sv.color} label={L(sv.name)} onPress={() => openService(sv.id)} />
            ))}
          </View>
        </Card>
      )}
      <View style={tablet && v.columns}>
        {SECTION_ORDER.map((section) => {
          const apps = MINI_APPS.filter((a) => a.section === section && !a.homeOnly)
          return (
            <Card key={section} style={[{ marginBottom: 14 }, tablet && v.half]}>
              <Text style={v.section}>{t.services.sections[section]}</Text>
              <View style={v.grid}>
                {apps.map((app) => <MiniAppTile key={app.id} app={app} onPress={() => open(app)} />)}
              </View>
            </Card>
          )
        })}
      </View>
    </Screen>
  )
}

const v = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13.5, color: colors.muted, marginTop: 4, marginBottom: 16 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  half: { width: '49%' },
})
