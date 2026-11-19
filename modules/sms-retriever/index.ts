import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

// The sign-up SMS code read automatically on Android (Google SMS Retriever, no SMS permission; DFS guidelines
// 3.2.5b-iv). The SMS must start with "<#>" and end with this build's app hash (appHash()). iPhone uses the keyboard's
// one-time-code autofill instead. Not in the build (web, iPhone, an older dev build): nothing happens.
type Native = {
  start(): Promise<boolean>
  stop(): void
  appHash(): string | null
  addListener(event: 'onMessage', listener: (e: { message: string }) => void): { remove(): void }
  addListener(event: 'onTimeout', listener: () => void): { remove(): void }
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('SmsRetriever') : null

/** Listens for the next code SMS for 5 minutes; `onCode` gets the first run of `digits` digits in it. Returns stop. */
export function listenForCode(digits: number, onCode: (code: string) => void): () => void {
  if (!native) return () => {}
  const re = new RegExp(`\b(\d{${digits}})\b`)
  const sub = native.addListener('onMessage', ({ message }) => {
    const m = re.exec(message)
    if (m) onCode(m[1])
  })
  native.start().catch(() => false)
  return () => {
    sub.remove()
    try {
      native.stop()
    } catch {
      // Nothing to stop.
    }
  }
}

/** The 11-character hash SMS codes must end with for this build; null where unsupported. */
export function smsAppHash(): string | null {
  try {
    return native?.appHash() ?? null
  } catch {
    return null
  }
}
