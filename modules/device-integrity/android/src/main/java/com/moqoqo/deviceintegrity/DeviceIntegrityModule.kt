package com.moqoqo.deviceintegrity

import android.content.Context
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * What the phone says about its own safety, for the portal's device security: developer options and USB debugging
 * (Android settings), signs of root beyond expo-device's `su` search (test-keys builds, root manager apps), and
 * whether it is an emulator. A rooted phone can hide all of this; the server treats it as a best effort.
 */
class DeviceIntegrityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceIntegrity")

    AsyncFunction("check") {
      val ctx = appContext.reactContext ?: return@AsyncFunction mapOf(
        "developerOptions" to false, "usbDebugging" to false, "rootSigns" to false, "emulator" to isEmulator(),
      )
      mapOf(
        "developerOptions" to globalFlag(ctx, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED),
        "usbDebugging" to globalFlag(ctx, Settings.Global.ADB_ENABLED),
        "rootSigns" to rootSigns(ctx),
        "emulator" to isEmulator(),
      )
    }
  }

  private fun globalFlag(ctx: Context, name: String) = try {
    Settings.Global.getInt(ctx.contentResolver, name, 0) == 1
  } catch (e: Exception) {
    false
  }

  private val rootPackages = listOf(
    "com.topjohnwu.magisk", "eu.chainfire.supersu", "com.koushikdutta.superuser", "com.noshufou.android.su",
    "com.thirdparty.superuser", "com.kingroot.kinguser",
  )
  private val suPaths = listOf(
    "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/sbin/su", "/vendor/bin/su", "/su/bin/su", "/data/local/xbin/su",
    "/data/local/bin/su", "/system/app/Superuser.apk",
  )

  private fun rootSigns(ctx: Context): Boolean {
    if (Build.TAGS?.contains("test-keys") == true) return true
    if (suPaths.any { File(it).exists() }) return true
    val pm = ctx.packageManager
    return rootPackages.any { pkg ->
      try {
        @Suppress("DEPRECATION") pm.getPackageInfo(pkg, 0)
        true
      } catch (e: Exception) {
        false
      }
    }
  }

  private fun isEmulator(): Boolean =
    Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") || Build.MODEL.contains("Emulator") ||
      Build.MODEL.contains("Android SDK built for") || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish") ||
      Build.PRODUCT.contains("sdk")
}
