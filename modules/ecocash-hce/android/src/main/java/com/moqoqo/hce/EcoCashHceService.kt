package com.moqoqo.hce

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * Answers a merchant's NFC reader. The reader selects our application ID (F045434F43415348, "ECOCASH" after the
 * proprietary F0 prefix); we answer "EC1:" + the current one-time pay code + status 9000, or 6985 ("conditions not
 * satisfied") when the Tap screen isn't open. The merchant's app sends the code to the server, which checks it like a
 * scanned payment code (single use, short-lived, PIN above the no-PIN limit).
 */
class EcoCashHceService : HostApduService() {
  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
    val apdu = commandApdu ?: return NOT_SUPPORTED
    if (!isSelectOurAid(apdu)) return NOT_SUPPORTED
    val code = PayCodeStore.current() ?: return NOT_READY
    PayCodeStore.onRead?.invoke()
    return (PREFIX + code).toByteArray(Charsets.US_ASCII) + OK
  }

  override fun onDeactivated(reason: Int) {
    // Nothing to tidy: the code stays until the app clears or replaces it.
  }

  private fun isSelectOurAid(apdu: ByteArray): Boolean {
    // CLA 00, INS A4 (SELECT), P1 04 (by name), P2 00, Lc, AID…
    if (apdu.size < 5 + AID.size) return false
    if (apdu[0] != 0x00.toByte() || apdu[1] != 0xA4.toByte() || apdu[2] != 0x04.toByte()) return false
    val lc = apdu[4].toInt() and 0xFF
    if (lc != AID.size) return false
    return apdu.copyOfRange(5, 5 + lc).contentEquals(AID)
  }

  companion object {
    private const val PREFIX = "EC1:"
    private val AID = byteArrayOf(0xF0.toByte(), 0x45, 0x43, 0x4F, 0x43, 0x41, 0x53, 0x48)
    private val OK = byteArrayOf(0x90.toByte(), 0x00)
    private val NOT_READY = byteArrayOf(0x69.toByte(), 0x85.toByte())
    private val NOT_SUPPORTED = byteArrayOf(0x6D.toByte(), 0x00)
  }
}
