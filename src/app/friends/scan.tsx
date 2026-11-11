import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Header, Icon, Screen } from '../../components/ui'
import { useT } from '../../i18n'
import { userIdFromQr } from '../../lib/friends'
import { useMoqoqo } from '../../state/useMoqoqo'
import { colors, radius } from '../../theme'

/** Scan a friend's personal QR code (theirs on Friends › My QR); opens their page to add them. */
export default function ScanFriend() {
  const t = useT()
  const { toast } = useMoqoqo()
  const [permission, requestPermission] = useCameraPermissions()
  const done = useRef(false)

  const onScan = ({ data }: { data: string }) => {
    if (done.current) return
    const u = userIdFromQr(data)
    if (!u) return toast(t.friends.notFriendQr)
    done.current = true
    router.replace({ pathname: '/add', params: { u } })
  }

  return (
    <Screen>
      <Header title={t.friends.scanTitle} />
      {!permission ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        : !permission.granted ? (
          <Card style={s.ask}>
            <Icon name="camera-outline" size={40} color={colors.primary} />
            <Text style={s.lead}>{t.friends.cameraNeeded}</Text>
            <Button label={t.friends.allowCamera} onPress={requestPermission} />
          </Card>
        ) : (
          <View style={s.cameraBox}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
            <View style={s.frame} pointerEvents="none" />
          </View>
        )}
      <Text style={s.hint}>{t.friends.scanHint}</Text>
    </Screen>
  )
}

const s = StyleSheet.create({
  ask: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  lead: { fontSize: 15, color: colors.text, textAlign: 'center' },
  cameraBox: { height: 340, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  frame: { width: 220, height: 220, borderRadius: 24, borderWidth: 3, borderColor: '#fff' },
  hint: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 14 },
})
