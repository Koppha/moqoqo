package com.moqoqo.siminfo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The SIM cards in the phone: network (MCC/MNC), carrier name and, where the SIM stores it, the phone number.
 * Without READ_PHONE_STATE only the default SIM's network is known; without READ_PHONE_NUMBERS no number.
 */
class SimInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SimInfo")

    AsyncFunction("getSims") {
      val ctx = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      readSims(ctx)
    }
  }

  private fun granted(ctx: Context, permission: String) =
    ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  @SuppressLint("MissingPermission", "HardwareIds")
  private fun readSims(ctx: Context): List<Map<String, Any?>> {
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    if (!granted(ctx, Manifest.permission.READ_PHONE_STATE)) {
      // No permission: the default SIM's operator is still readable.
      if (tm.simState != TelephonyManager.SIM_STATE_READY) return emptyList()
      val op = tm.simOperator ?: ""
      return listOf(mapOf(
        "slot" to 0,
        "mcc" to op.take(3).ifEmpty { null },
        "mnc" to op.drop(3).ifEmpty { null },
        "carrier" to tm.simOperatorName,
        "number" to null,
      ))
    }
    val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
    val canReadNumber = granted(ctx, Manifest.permission.READ_PHONE_NUMBERS)
    return (sm.activeSubscriptionInfoList ?: emptyList()).map { info ->
      val number: String? = if (!canReadNumber) null else try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) sm.getPhoneNumber(info.subscriptionId)
        else @Suppress("DEPRECATION") info.number
      } catch (e: SecurityException) {
        null
      }
      val mcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.mccString else @Suppress("DEPRECATION") info.mcc.toString()
      val mnc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.mncString else @Suppress("DEPRECATION") info.mnc.toString().padStart(2, '0')
      mapOf(
        "slot" to info.simSlotIndex,
        "mcc" to mcc,
        "mnc" to mnc,
        "carrier" to info.carrierName?.toString(),
        "number" to number?.ifEmpty { null },
      )
    }
  }
}
