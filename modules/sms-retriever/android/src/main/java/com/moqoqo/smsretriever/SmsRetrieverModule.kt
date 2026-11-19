package com.moqoqo.smsretriever

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

/**
 * Reads the sign-up SMS code without any SMS permission (Google SMS Retriever API, CBL/LCA DFS guidelines 3.2.5b-iv).
 * Android hands this app an SMS only when it starts with "<#>" and ends with this app's 11-character hash (appHash),
 * within 5 minutes of start(). The message reaches JS as the `onMessage` event.
 */
class SmsRetrieverModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("SmsRetriever")

    Events("onMessage", "onTimeout")

    AsyncFunction("start") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      register(ctx)
      SmsRetriever.getClient(ctx).startSmsRetriever()
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { promise.resolve(false) }
    }

    Function("stop") {
      appContext.reactContext?.let { unregister(it) }
    }

    /** The hash the SMS must end with for this build (debug and release builds are signed differently). */
    Function("appHash") {
      val ctx = appContext.reactContext ?: return@Function null
      appHash(ctx)
    }

    OnDestroy {
      appContext.reactContext?.let { unregister(it) }
    }
  }

  private fun register(ctx: Context) {
    unregister(ctx)
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
        val extras = intent.extras ?: return
        val status: Status? = if (Build.VERSION.SDK_INT >= 33) {
          extras.getParcelable(SmsRetriever.EXTRA_STATUS, Status::class.java)
        } else {
          @Suppress("DEPRECATION") extras.get(SmsRetriever.EXTRA_STATUS) as? Status
        }
        when (status?.statusCode) {
          CommonStatusCodes.SUCCESS -> {
            val message = extras.getString(SmsRetriever.EXTRA_SMS_MESSAGE) ?: return
            sendEvent("onMessage", mapOf("message" to message))
          }
          CommonStatusCodes.TIMEOUT -> sendEvent("onTimeout", mapOf<String, Any>())
        }
      }
    }
    // Android 14+: the receiver must be exported, and only Google Play services (SEND_PERMISSION) may send to it.
    ContextCompat.registerReceiver(
      ctx, r, IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION), SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED,
    )
    receiver = r
  }

  private fun unregister(ctx: Context) {
    receiver?.let {
      try {
        ctx.unregisterReceiver(it)
      } catch (e: Exception) {
        // Already gone.
      }
    }
    receiver = null
  }

  /** Google's AppSignatureHelper: SHA-256 of "<package> <signing cert>", first 9 bytes, base64, 11 characters. */
  private fun appHash(ctx: Context): String? = try {
    val pkg = ctx.packageName
    val signatures = if (Build.VERSION.SDK_INT >= 28) {
      ctx.packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
    } else {
      @Suppress("DEPRECATION") ctx.packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures
    }
    signatures?.firstOrNull()?.let { sig ->
      val md = MessageDigest.getInstance("SHA-256")
      md.update("$pkg ${sig.toCharsString()}".toByteArray(Charsets.UTF_8))
      Base64.encodeToString(md.digest().copyOfRange(0, 9), Base64.NO_PADDING or Base64.NO_WRAP).substring(0, 11)
    }
  } catch (e: Exception) {
    null
  }
}
