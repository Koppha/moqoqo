import { reloadAppAsync, requireOptionalNativeModule } from 'expo'
import * as SecureStore from 'expo-secure-store'
import { Appearance, Platform } from 'react-native'

// Design tokens taken from the reference: soft grey canvas, white rounded cards,
// deep purple accent, near-black hero header, orange→purple wallet card. A dark set for Me › Display.
//
// Styles across the app are made once, when their screen's module loads, so the colours are chosen once at start-up:
// from the saved display mode (system, light or dark), read synchronously here. Changing the mode saves it and
// reloads the app, which then starts with the other set. The reload is made seamless: the screen fades to the new
// background first, and the app comes back (within HANDOFF_MS) without the splash or the PIN, on the same screen.

export type DisplayMode = 'system' | 'light' | 'dark'
const MODE_KEY = 'display_mode_v1'

function readMode(): DisplayMode {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(MODE_KEY) : SecureStore.getItem(MODE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export const displayMode: DisplayMode = readMode()

const HANDOFF_KEY = 'display_handoff_v1'
const HANDOFF_MS = 15_000
/** Left by setDisplayMode just before it reloads: when, and the screen to come back to. */
export interface DisplayHandoff { at: number; path: string }

function readHandoff(): DisplayHandoff | null {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(HANDOFF_KEY) : SecureStore.getItem(HANDOFF_KEY)
    if (!raw) return null
    // Used once: a later start is an ordinary one.
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(HANDOFF_KEY)
    else SecureStore.deleteItemAsync(HANDOFF_KEY).catch(() => {})
    const h = JSON.parse(raw) as DisplayHandoff
    const age = Date.now() - h.at
    return age >= 0 && age < HANDOFF_MS && typeof h.path === 'string' ? h : null
  } catch {
    return null
  }
}

/**
 * Set when this start is the app coming back from a display change a moment ago (the person was signed in and
 * unlocked then): no splash, no PIN, back on the same screen.
 */
export const displayHandoff: DisplayHandoff | null = readHandoff()

/** The full-screen fade (DisplayFade) registers here; setDisplayMode waits for it before reloading. */
let fadeTo: ((bg: string) => Promise<void>) | null = null
export function setDisplayFader(f: ((bg: string) => Promise<void>) | null) {
  fadeTo = f
}
/** The colours in use: the saved mode, or the phone's own setting for "system". */
export const isDark = displayMode === 'dark' || (displayMode === 'system' && Appearance.getColorScheme() === 'dark')

/** Saves the mode and, when the colours change, fades to them and reloads, coming back to `path` still unlocked. */
export async function setDisplayMode(mode: DisplayMode, path = '/') {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(MODE_KEY, mode)
  else await SecureStore.setItemAsync(MODE_KEY, mode)
  const next = mode === 'dark' || (mode === 'system' && Appearance.getColorScheme() === 'dark')
  if (next === isDark) return
  const nextBg = (next ? dark : light).bg
  await fadeTo?.(nextBg)
  // What shows while the app reloads (release builds): the new background, so there is no flash of the old one.
  await setWindowBackground(nextBg)
  const handoff: DisplayHandoff = { at: Date.now(), path }
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(HANDOFF_KEY, JSON.stringify(handoff))
  else await SecureStore.setItemAsync(HANDOFF_KEY, JSON.stringify(handoff))
  await reloadAppAsync('Display mode changed')
}

const light = {
  bg: '#EEF0F6',
  surface: '#FFFFFF',
  surface2: '#F5F6FA',
  text: '#14151A',
  muted: '#8B8E99',
  border: '#ECEEF3',
  primary: '#5B2C9F',
  primaryDark: '#3F1D73',
  primarySoft: '#EFE8FA',
  hero: '#0E0F14',
  heroText: '#FFFFFF',
  heroMuted: '#A6A8B3',
  success: '#16A34A',
  successSoft: '#E6F6EC',
  warn: '#D97706',
  warnSoft: '#FFF3DD',
  danger: '#DC2626',
  bubbleThem: '#FFFFFF',
}

const dark: typeof light = {
  bg: '#0E0F14',
  surface: '#1A1B23',
  surface2: '#23242D',
  text: '#F2F3F7',
  muted: '#9A9DA8',
  border: '#2B2D37',
  primary: '#9B6BE3',
  primaryDark: '#7A4CC4',
  primarySoft: '#2A2140',
  hero: '#07080B',
  heroText: '#FFFFFF',
  heroMuted: '#A6A8B3',
  success: '#22C55E',
  successSoft: '#123222',
  warn: '#F59E0B',
  warnSoft: '#3A2A0E',
  danger: '#F87171',
  bubbleThem: '#1F2029',
}

export const colors = isDark ? dark : light

/** The phone's window behind the app, seen while it starts or reloads. Builds without expo-system-ui skip it. */
async function setWindowBackground(color: string) {
  // Loading expo-system-ui without its native part throws as the module loads, so ask for the native part first.
  if (!requireOptionalNativeModule('ExpoSystemUI')) return
  try {
    await (await import('expo-system-ui')).setBackgroundColorAsync(color)
  } catch {
    // Not in this build: the window keeps its default.
  }
}
void setWindowBackground(colors.bg)

export const gradients = {
  card: ['#F2711C', '#E0482F', '#7A2FB0'] as const,
  hero: ['#1B1036', '#0E0F14'] as const,
  mpho: ['#C81E1E', '#E8590C'] as const,
}

export const radius = { sm: 12, md: 18, lg: 18, xl: 26, pill: 999 }

export const shadow = {
  shadowColor: '#1B1F3B',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
}

/**
 * A brand colour used directly on the page (an icon without its circle): unchanged in light mode; in dark mode, very
 * dark colours (e.g. the card network navy) are mixed towards white until they stand out from the background.
 */
export function onBackground(hex: string): string {
  if (!isDark || !/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const lum = (c: number[]) => c.reduce((a, v, i) => a + (v / 255) * [0.2126, 0.7152, 0.0722][i], 0)
  let mix = rgb
  for (let t = 0.15; lum(mix) < 0.22 && t <= 0.75; t += 0.15) mix = rgb.map((v) => Math.round(v + (255 - v) * t))
  return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Colour for avatar circles, so each contact or biller keeps the same colour. */
const AVATAR = ['#5B2C9F', '#E0482F', '#16A34A', '#0EA5E9', '#D97706', '#DB2777']
export const avatarColor = (key: string) =>
  AVATAR[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]
