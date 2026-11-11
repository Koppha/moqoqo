// EcoSure design tokens: the purple theme from EcoSure's approved prototype (EcoSure/app/src/theme).
// The mini app keeps its own look inside EcoCash Super App, like a brand's mini program.

export const es = {
  primary: '#5B2FD1',
  primaryLight: '#7A4CF0',
  lilac: '#F1EBFF',
  lilacStrong: '#EDE5FF',
  lilacMuted: '#D8CDEF',
  background: '#F6F3FF',
  surface: '#FFFFFF',
  border: '#ECE6F7',
  divider: '#F0EAFB',
  inputBorder: '#E2D9F5',
  text: '#1A1D2E',
  textSoft: '#3A3F55',
  textMuted: '#6B6585',
  onPrimary: '#FFFFFF',
  success: '#1D6B3C',
  successBg: '#DDF5E7',
  successDot: '#2E9E5B',
  warning: '#6B4E00',
  warningBg: '#FFF4D6',
  danger: '#B42318',
  dangerBg: '#FDE7E5',
  dot: '#E0485F',
  blue: '#2A56C6',
  /** Selected cards and the info banner: the blue end of the hero gradient. */
  accent: '#4361EE',
  accentBg: '#EEF2FF',
  coral: '#B8325A',
}

export const esGradients = {
  primary: ['#7A4CF0', '#5B2FD1'],
  /** Headers, selected pills and call-to-action buttons: blue to purple. */
  hero: ['#3F7BEF', '#7A3FE4'],
  family: ['#8B63F2', '#5B2FD1'],
  blue: ['#4C8DF0', '#2A56C6'],
  coral: ['#E05A6E', '#B8325A'],
} as const

export type EsGradient = keyof typeof esGradients

export const esRadius = { sm: 10, md: 14, lg: 16, xl: 22, pill: 999 }

export const space = (n: number) => n * 4

export const esType = {
  h1: { fontSize: 24, fontWeight: '800' as const, color: es.text },
  h2: { fontSize: 17, fontWeight: '800' as const, color: es.text },
  h3: { fontSize: 15, fontWeight: '800' as const, color: es.text },
  body: { fontSize: 14, color: es.textSoft, lineHeight: 20 },
  small: { fontSize: 12, color: es.textMuted, lineHeight: 16 },
  label: { fontSize: 12, fontWeight: '600' as const, color: es.textSoft },
}
