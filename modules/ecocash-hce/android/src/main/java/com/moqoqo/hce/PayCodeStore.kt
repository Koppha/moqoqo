package com.moqoqo.hce

/**
 * The one-time pay code the phone hands to a merchant's reader. Kept in memory only (never on disk), set by the
 * app while the Tap screen is open and cleared when it closes. Each code is single use and expires on the server
 * within minutes, so a code read twice or late is refused there.
 */
object PayCodeStore {
  @Volatile private var code: String? = null
  @Volatile private var expiresAt: Long = 0L

  /** Told when a reader took the code, so the screen can say "Paying…". */
  @Volatile var onRead: (() -> Unit)? = null

  fun set(value: String, expiresAtMs: Long) {
    code = value
    expiresAt = expiresAtMs
  }

  fun clear() {
    code = null
    expiresAt = 0L
  }

  /** The code if it is still valid, else null. */
  fun current(): String? {
    val c = code ?: return null
    return if (System.currentTimeMillis() < expiresAt) c else null
  }
}
