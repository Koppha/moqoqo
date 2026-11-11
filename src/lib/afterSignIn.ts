import type { Href } from 'expo-router'

// Where to continue once someone signs in: the standalone EcoSure app sends a guest who wants a quote to create a
// profile first, then brings them back to that quote. Kept in memory only: it's for this visit.
let pending: Href | null = null

export function continueAfterSignIn(href: Href) {
  pending = href
}

/** The screen to open now that the person has signed in (once), if any. */
export function takeAfterSignIn(): Href | null {
  const href = pending
  pending = null
  return href
}
