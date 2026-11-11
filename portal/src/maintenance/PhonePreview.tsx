import { toMaseruParts } from '../time'

export type Lang = 'en' | 'st'

// Copy for the app's maintenance screen. The Sesotho strings are drafts pending review.
const COPY = {
  en: {
    title: 'Planned maintenance',
    back: 'Back at',
    on: 'on',
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  st: {
    title: 'Tlhokomelo e reriloeng',
    back: 'Re khutla ka',
    on: 'ka',
    days: ['Sontaha', 'Mantaha', 'Labobeli', 'Laboraro', 'Labone', 'Labohlano', 'Moqebelo'],
    months: ['Pherekhong', 'Hlakola', 'Hlakubele', 'Mmesa', 'Motsheanong', 'Phupjane', 'Phupu', 'Phato', 'Lwetse', 'Mphalane', 'Pudungwana', 'Tshitwe'],
  },
} as const

/** "Back at 16:00" when the window ends today (Maseru), else "Back at 04:00 on Tue 13 Oct". */
export function backAtText(lang: Lang, endsAt: string | null, now: Date): string {
  const c = COPY[lang]
  if (!endsAt) return `${c.back} …`
  const end = toMaseruParts(endsAt)
  if (end.date === toMaseruParts(now).date) return `${c.back} ${end.time}`
  const d = new Date(Date.parse(endsAt) + 2 * 3600 * 1000)
  return `${c.back} ${end.time} ${c.on} ${c.days[d.getUTCDay()]} ${d.getUTCDate()} ${c.months[d.getUTCMonth()]}`
}

/** A phone-shaped approximation of the app's full-screen maintenance page. */
export function PhonePreview({ lang, message, endsAt, now }: { lang: Lang; message: string; endsAt: string | null; now: Date }) {
  const c = COPY[lang]
  return (
    <figure className="phone" aria-label={`Preview of the app maintenance screen in ${lang === 'en' ? 'English' : 'Sesotho'}`}>
      <div className="phone-screen" lang={lang === 'en' ? 'en' : 'st'}>
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-status" aria-hidden="true">
          <span>{toMaseruParts(now).time}</span>
          <span>EcoCash</span>
        </div>
        <div className="phone-body">
          <div className="phone-icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <p className="phone-title">{c.title}</p>
          <p className="phone-message">{message.trim() || '…'}</p>
          <p className="phone-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            {backAtText(lang, endsAt, now)}
          </p>
        </div>
        <p className="phone-brand" aria-hidden="true">
          EcoCash Super App
        </p>
      </div>
    </figure>
  )
}
