import { createContext, useContext, useState, type ReactNode } from 'react'
import { SOCIETY_NAMES, useSocietyNamePref, type SocietyNamePref } from '../lib/societyName'
import { STRINGS, type Lang, type Strings } from './strings'

export { LANGS, STRINGS, type Lang, type Strings } from './strings'

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void } | null>(null)

// Held in memory for now: persisting the choice across launches needs a storage module
// (e.g. expo-sqlite/kv-store), which requires a new development build.
export function I18nProvider({ children, initial = 'en' }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLang] = useState<Lang>(initial)
  return <Ctx value={{ lang, setLang }}>{children}</Ctx>
}

export function useLanguage() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLanguage must be used inside I18nProvider')
  return ctx
}

// The society mini app is "Society" in English and "Mekhatlo" in Sesotho, unless the person chose one name for every
// language (Society › name). Built once per language and choice.
const named = new Map<string, Strings>()
function withSocietyName(lang: Lang, pref: SocietyNamePref): Strings {
  const base = STRINGS[lang]
  if (pref === 'auto') return base
  const key = `${lang}:${pref}`
  let s = named.get(key)
  if (!s) {
    const name = SOCIETY_NAMES[pref]
    const swap = (text: string) => text.replace(/\b(Society|Mekhatlo)\b/g, name)
    const slides = base.onboarding.slides
    s = {
      ...base,
      society: { ...base.society, title: name },
      services: { ...base.services, items: { ...base.services.items, society: name } },
      onboarding: { ...base.onboarding, slides: { ...slides, apps: { ...slides.apps, body: swap(slides.apps.body) }, together: { ...slides.together, body: swap(slides.together.body) } } },
    }
    named.set(key, s)
  }
  return s
}

/** Strings for the current language: `const t = useT(); t.home.topUp` */
export function useT(): Strings {
  return withSocietyName(useLanguage().lang, useSocietyNamePref())
}
