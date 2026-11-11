import { router, Stack } from 'expo-router'
import { useEffect, useRef } from 'react'
import { takeAfterSignIn } from '../../lib/afterSignIn'
import { APP } from '../../lib/variant'
import { EcoSureProvider } from '../../miniapps/ecosure/data'
import { es } from '../../miniapps/ecosure/theme'
import { useAuth } from '../../state/Auth'

/**
 * EcoSure mini app: its own stack (tabs + flows) and shared data, inside EcoCash Super App. Before sign-in (only in the
 * standalone EcoSure app) a guest can look at cover and prices; quotes and everything else need a profile.
 */
export default function EcoSureLayout() {
  const signedIn = useAuth().status !== 'signedOut'
  // A guest who asked for a quote created a profile first: back to that quote now.
  const wasSignedIn = useRef(signedIn)
  useEffect(() => {
    const signedOut = wasSignedIn.current && !signedIn
    wasSignedIn.current = signedIn
    // Signed out in the EcoSure app: back to sign-in (over the welcome page), not left on the guest quotes.
    if (signedOut && APP === 'ecosure') {
      router.replace('/welcome')
      router.push('/login')
      return
    }
    if (!signedIn) return
    const next = takeAfterSignIn()
    if (next) router.push(next)
  }, [signedIn])
  return (
    <EcoSureProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: es.background }, animation: 'slide_from_right' }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="buy" />
          <Stack.Screen name="dependants" />
          <Stack.Screen name="sponsor" />
          <Stack.Screen name="migrate" />
          <Stack.Screen name="done" />
        </Stack.Protected>
        <Stack.Screen name="quotes" />
        <Stack.Screen name="quote/[product]" />
      </Stack>
    </EcoSureProvider>
  )
}
