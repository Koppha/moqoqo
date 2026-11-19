package com.moqoqo.siminfo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
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

    // Airplane mode: no SIM has service then, and that is not a sign of a SIM swap.
    Function("airplaneMode") {
      val ctx = appContext.reactContext ?: return@Function false
      Settings.Global.getInt(ctx.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
    }
  }

  /**
   * Whether this SIM is registered on a mobile network right now. The registered network's code is only known while
   * registered, so an empty one means no service (a SIM whose number moved to another SIM card loses service).
   * Needs no extra permission.
   */
  private fun inService(tm: TelephonyManager, subId: Int?): Boolean? = try {
    val t = if (subId != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) tm.createForSubscriptionId(subId) else tm
    !t.networkOperator.isNullOrEmpty()
  } catch (e: Exception) {
    null
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
        "subId" to null,
        "inService" to inService(tm, null),
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
        // A new SIM card gets a new subscription id, even for the same number: how the app tells the card changed.
        "subId" to info.subscriptionId,
        "inService" to inService(tm, info.subscriptionId),
      )
    }
  }
}
