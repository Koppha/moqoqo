package com.moqoqo.hce

import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Tap to pay from JS: whether the phone can, and the pay code to hand to the next reader. */
class EcoCashHceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EcoCashHce")

    Events("onRead")

    OnCreate {
      PayCodeStore.onRead = { sendEvent("onRead", mapOf<String, Any>()) }
    }

    OnDestroy {
      PayCodeStore.onRead = null
      PayCodeStore.clear()
    }

    /** The phone has NFC card emulation (most Android phones with NFC). */
    Function("isSupported") {
      val context = appContext.reactContext ?: return@Function false
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
    }

    /** NFC is switched on in Settings. */
    Function("isEnabled") {
      val context = appContext.reactContext ?: return@Function false
      NfcAdapter.getDefaultAdapter(context)?.isEnabled == true
    }

    Function("setPayCode") { code: String, expiresAtMs: Double ->
      PayCodeStore.set(code, expiresAtMs.toLong())
    }

    Function("clear") {
      PayCodeStore.clear()
    }
  }
}
