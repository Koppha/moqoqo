import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { BrandSplash } from '../components/BrandSplash'
import { BiometricOffer, LockScreen } from '../components/LockScreen'
import { PushPrompt } from '../components/PushPrompt'
import { DisplayFade } from '../components/DisplayFade'
import { DeviceGate } from '../components/DeviceGate'
import { MaintenanceGate } from '../components/Maintenance'
import { Toast } from '../components/Toast'
import { I18nProvider } from '../i18n'
import { useOrientationPolicy } from '../lib/layout'
import { useNotificationRouting } from '../lib/notifications'
import { useOnboardingSeen } from '../lib/onboarding'
import { APP } from '../lib/variant'
import { AppStateProvider } from '../state/AppState'
import type { AppKind } from '../../shared/api'
import { AuthProvider, useAppMode, useAuth } from '../state/Auth'
import { DialogProvider } from '../state/Dialogs'
import { Sync } from '../state/Sync'
import { FloatingApps } from '../components/FloatingApps'
import { IdleSignOut } from '../components/IdleSignOut'
import { NetworkGuard } from '../components/NetworkGuard'
import { SimWatch } from '../components/SimWatch'
import { colors, displayHandoff, isDark } from '../theme'
import { InsecureReleaseGate, PrivacyCover } from '../components/PrivacyCover'

// Keep the native splash up until the app's own splash (or, in the EcoSure app, the first screen) is ready.
void SplashScreen.preventAutoHideAsync().catch(() => {})

/** The standalone EcoSure app has no branded splash of its own: drop the native one once ready. */
function HideNativeSplash({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (ready) SplashScreen.hide()
  }, [ready])
  return null
}

/** Mounted only once the navigator exists, so a notification tap that launched the app can navigate. */
function NotificationRouting() {
  useNotificationRouting()
  return null
}

function RootNavigator() {
  const { status } = useAuth()
  const onboarded = useOnboardingSeen()
  // Brief: reading the stored session and whether this phone saw the introduction. The splash covers it, rather
  // than flashing the login screen.
  const ready = status !== 'loading' && onboarded !== null
  const signedIn = status !== 'signedOut'
  // EcoCash Super App with a business open from the EcoCash Business mini app shows the business screens.
  const mode = useAppMode()
  return (
    <>
      {ready && <Navigator signedIn={signedIn} onboarded={!!onboarded} mode={mode} />}
      {/* Back from a display change: no splash, the screen fades in from the new colours instead. */}
      {APP === 'ecosure' || displayHandoff ? <HideNativeSplash ready={ready} /> : <BrandSplash ready={ready} />}
      <DisplayFade ready={ready} />
    </>
  )
}

function Navigator({ signedIn, onboarded, mode }: { signedIn: boolean; onboarded: boolean; mode: AppKind }) {
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
        {/* Order matters: a blocked route falls back to the first screen still allowed. */}
        {/* The standalone Mekhatlo app opens on its own tabs (its societies, chats, Me). */}
        <Stack.Protected guard={signedIn && mode === 'society'}>
          <Stack.Screen name="mekhatlo" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && mode === 'customer'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="lec" />
          <Stack.Screen name="school/index" />
          <Stack.Screen name="school/ask" />
          <Stack.Screen name="insights" />
          <Stack.Screen name="money" />
          <Stack.Screen name="receive-money" />
          <Stack.Screen name="split/index" />
          <Stack.Screen name="split/pick-chat" />
          <Stack.Screen name="split/new" />
          <Stack.Screen name="split/history" />
          <Stack.Screen name="topup" />
          <Stack.Screen name="remit" />
          <Stack.Screen name="donate/index" />
          <Stack.Screen name="donate/new" />
          <Stack.Screen name="donate/[code]" />
          <Stack.Screen name="business" />
          <Stack.Screen name="send" />
          <Stack.Screen name="send-many" />
          <Stack.Screen name="bills/index" />
          <Stack.Screen name="bills/[category]" />
        </Stack.Protected>
        {/* Society (Mekhatlo): a mini app in EcoCash Super App, and the standalone Mekhatlo app. */}
        <Stack.Protected guard={signedIn && (mode === 'customer' || mode === 'society')}>
          <Stack.Screen name="society/index" />
          <Stack.Screen name="society/[id]" />
          <Stack.Screen name="society/apply" />
          <Stack.Screen name="society/loans" />
        </Stack.Protected>
        {/* Airtime and bundles (portal services), paying a merchant or agent, cash out and the bank: customers, and
            merchants and agents from their takings or float. */}
        <Stack.Protected guard={signedIn && (mode === 'customer' || mode === 'business')}>
          <Stack.Screen name="pay" />
          <Stack.Screen name="bank" />
          <Stack.Screen name="cashout" />
          <Stack.Screen name="service/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && mode === 'business'}>
          <Stack.Screen name="biz" />
          <Stack.Screen name="biz-profile" />
          <Stack.Screen name="biz-action/[kind]" />
          <Stack.Screen name="receive" />
          <Stack.Screen name="my-qr" />
        </Stack.Protected>
        {/* Cardless ATM cash: customers, and agents and merchants from their float or takings. */}
        <Stack.Protected guard={signedIn && (APP === 'customer' || APP === 'business')}>
          <Stack.Screen name="atm" />
        </Stack.Protected>
        {/* Signed out: the standalone EcoSure app opens on its welcome page (cover, quotes, a link to sign in); the
            other apps on sign-in. Before the EcoSure group, so a signed-out app falls back here, not to EcoSure. */}
        <Stack.Protected guard={!signedIn && APP === 'ecosure'}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        {/* EcoCash Super App's short introduction: before the first sign-in (once per phone), and from Me › Introduction. */}
        <Stack.Protected guard={mode === 'customer' && (signedIn || !onboarded)}>
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ animation: APP === 'ecosure' ? 'slide_from_right' : 'fade' }} />
          <Stack.Screen name="setup" />
          <Stack.Screen name="lost-phone" />
        </Stack.Protected>
        {/* Legal and safety: from Me, and from the terms at phone setup (signed out). */}
        <Stack.Screen name="legal" />
        {/* EcoSure: a mini app in EcoCash Super App, and the whole of the standalone EcoSure app (signed in, it opens on it: the
            first screen that app may show). Guests of the EcoSure app may get quotes; ecosure/_layout keeps the rest
            for signed-in customers. Declared once only: a screen named twice is governed by its first guard. */}
        <Stack.Protected guard={signedIn ? mode === 'customer' || mode === 'ecosure' : APP === 'ecosure'}>
          <Stack.Screen name="ecosure" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="places" />
          <Stack.Screen name="stop-orders/index" />
          <Stack.Screen name="stop-orders/new" />
          <Stack.Screen name="friends/index" />
          <Stack.Screen name="friends/scan" />
          <Stack.Screen name="friends/qr" />
          <Stack.Screen name="friends/contacts" />
          <Stack.Screen name="add" />
          <Stack.Screen name="group/new" />
          <Stack.Screen name="message-requests" />
          <Stack.Screen name="taxi" />
          <Stack.Screen name="transactions" />
          <Stack.Screen name="statement" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="change-pin" />
          <Stack.Screen name="pending" />
          <Stack.Screen name="devices" />
          <Stack.Screen name="news" />
        </Stack.Protected>
      </Stack>
      <NotificationRouting />
      <Sync />
      {signedIn && mode === 'customer' && <FloatingApps />}
      <LockScreen />
      <BiometricOffer />
      <PushPrompt />
    </>
  )
}

export default function RootLayout() {
  useOrientationPolicy()
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <AppStateProvider>
            <DialogProvider>
              <IdleSignOut>
                <RootNavigator />
              </IdleSignOut>
              <Toast />
              <MaintenanceGate />
              <DeviceGate />
              <NetworkGuard />
              <SimWatch />
              <PrivacyCover />
              <InsecureReleaseGate />
            </DialogProvider>
          </AppStateProvider>
        </AuthProvider>
      </I18nProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaProvider>
  )
}
