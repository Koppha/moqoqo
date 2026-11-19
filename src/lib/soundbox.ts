import * as SecureStore from 'expo-secure-store'
import type { Transaction } from '../../shared/api'
import { APP } from './variant'

// Soundbox: the phone says out loud when money comes in ("Received M50 from Thabo"), like the speaker boxes at
// tills. On by default in EcoCash Business, off in the customer app; switched in Me.

const KEY = 'moqoqo.soundbox'
let enabled: boolean | null = null
const spoken = new Set<string>()

export async function getSoundbox(): Promise<boolean> {
  if (enabled === null) {
    const v = await SecureStore.getItemAsync(KEY).catch(() => null)
    enabled = v === null ? APP === 'business' : v === '1'
  }
  return enabled
}

export async function setSoundbox(on: boolean) {
  enabled = on
  await SecureStore.setItemAsync(KEY, on ? '1' : '0')
}

const say = (amount: string, from: string, lang: 'en' | 'st') =>
  lang === 'st' ? `U amohetse ${amount}${from ? ` ho tsoa ho ${from}` : ''}` : `Received ${amount}${from ? ` from ${from}` : ''}`

/** "M50.00" → "50 maloti" reads better aloud. */
const spokenAmount = (n: number) => {
  const [whole, cents] = Math.abs(n).toFixed(2).split('.')
  return `${Number(whole).toLocaleString('en')} maloti${cents !== '00' ? ` ${Number(cents)} lisente` : ''}`
}

/**
 * Says it in Sesotho when the phone has a Sesotho voice and the app is in Sesotho, else in English (most phones
 * ship no Sesotho text-to-speech voice yet).
 */
async function speak(amountMaloti: number, from: string, lang: 'en' | 'st') {
  try {
    // Loaded only here, so a build without the module never crashes.
    const Speech = await import('expo-speech')
    const voices = await Speech.getAvailableVoicesAsync().catch(() => [])
    const sesotho = lang === 'st' && voices.some((v) => v.language.toLowerCase().startsWith('st'))
    Speech.speak(say(spokenAmount(amountMaloti), from, sesotho ? 'st' : 'en'), { language: sesotho ? 'st-ZA' : 'en-ZA', rate: 0.95 })
  } catch {
    // No text-to-speech on this phone.
  }
}

/** Announces money in (once per transaction, only fresh ones), when the soundbox is on. */
export async function announce(tx: Transaction, lang: 'en' | 'st') {
  if (tx.amount <= 0 || spoken.has(tx.id) || Date.now() - new Date(tx.createdAt).getTime() > 2 * 60_000) return
  spoken.add(tx.id)
  if (!(await getSoundbox())) return
  await speak(tx.amount, tx.counterpartyName, lang)
}

/** Plays a sample, in the app's language, so people hear what it will sound like when they switch it on. */
export async function testSoundbox(lang: 'en' | 'st') {
  await speak(50, 'EcoCash Super App', lang)
}
