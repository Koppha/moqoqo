/// <reference types="node" />
import { existsSync } from 'node:fs'
import type { ConfigContext, ExpoConfig } from 'expo/config'

// One codebase, four apps:
//   default             → EcoCash Super App (customers)        com.ecocashsuper.app
//   APP_VARIANT=business → EcoCash Business (agents and merchants, Famoco terminals)  com.ecocashsuper.business
//   APP_VARIANT=ecosure  → EcoSure on its own (the same EcoSure as the mini app)      com.ecocashsuper.ecosure
//   APP_VARIANT=society  → Mekhatlo on its own (the same Society/Mekhatlo as the mini app)  com.ecocashsuper.mekhatlo
// EXPO_PUBLIC_API_URL points any of them at an EcoCash Super App server (default: this machine via adb reverse).
const business = process.env.APP_VARIANT === 'business'
const ecosure = process.env.APP_VARIANT === 'ecosure'
const society = process.env.APP_VARIANT === 'society'
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'
// Firebase config for Android push (Expo push goes through FCM on Android). EAS builds take it from the
// GOOGLE_SERVICES_JSON file variable; local builds from ./google-services.json. Without it the app builds but gets
// no push token. One Firebase project holds all four apps (com.ecocashsuper.app, .business, .ecosure, .mekhatlo).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined)
// Home-screen icons uploaded in the portal (Branding), fetched by `npm run fetch-branding` before a build: EcoCash Super App's
// icon, and EcoSure's mini app icon for the standalone EcoSure app. Without them the built-in artwork stays.
const brandIcon = ecosure
  ? (existsSync('./assets/brand/ecosure-icon.png') ? './assets/brand/ecosure-icon.png' : null)
  : society
    ? (existsSync('./assets/brand/society-icon.png') ? './assets/brand/society-icon.png' : null)
    : (existsSync('./assets/brand/icon.png') ? './assets/brand/icon.png' : null)

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: business ? 'EcoCash Business' : ecosure ? 'EcoSure' : society ? 'Mekhatlo' : config.name ?? 'EcoCash Super App',
  slug: config.slug ?? 'moqoqo',
  ...(ecosure ? { icon: './assets/ecosure/icon.png' } : society ? { icon: './assets/mekhatlo/icon.png' } : {}),
  ...(brandIcon ? { icon: brandIcon } : {}),
  scheme: business ? 'moqoqobiz' : ecosure ? 'ecosure' : society ? 'mekhatlo' : config.scheme,
  android: {
    ...config.android,
    package: business ? 'com.ecocashsuper.business' : ecosure ? 'com.ecocashsuper.ecosure' : society ? 'com.ecocashsuper.mekhatlo' : config.android?.package,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    ...(brandIcon ? { adaptiveIcon: { foregroundImage: brandIcon, backgroundColor: '#FFFFFF' } } : ecosure ? { adaptiveIcon: { foregroundImage: './assets/ecosure/adaptive-foreground.png', backgroundImage: './assets/ecosure/adaptive-background.png', monochromeImage: './assets/ecosure/adaptive-monochrome.png' } }
      : society ? { adaptiveIcon: { foregroundImage: './assets/mekhatlo/adaptive-foreground.png', backgroundImage: './assets/mekhatlo/adaptive-background.png', monochromeImage: './assets/mekhatlo/adaptive-monochrome.png' } } : {}),
    // Nothing records audio; expo-camera would otherwise add the microphone permission.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    // Sign-up reads the SIM cards (network and, where stored, the number): modules/sim-info.
    permissions: [...(config.android?.permissions ?? []), 'android.permission.READ_PHONE_STATE', 'android.permission.READ_PHONE_NUMBERS'],
  },
  ios: {
    ...config.ios,
    bundleIdentifier: business ? 'com.ecocashsuper.business' : ecosure ? 'com.ecocashsuper.ecosure' : society ? 'com.ecocashsuper.mekhatlo' : config.ios?.bundleIdentifier,
  },
  // Android release builds refuse plain http:// unless allowed. Only a local/test server is http;
  // production (behind ETL's proxy) is https, so this stays off there.
  plugins: [
    // The splash shows the EcoCash logo, as the animated splash starts with it; the standalone EcoSure app shows its own icon.
    ...(config.plugins ?? []).map((p) =>
      ecosure && Array.isArray(p) && p[0] === 'expo-splash-screen'
        ? (['expo-splash-screen', { ...p[1], image: './assets/ecosure/icon.png', imageWidth: 160, dark: { ...p[1]?.dark, image: './assets/ecosure/icon.png' } }] as [string, object])
        : p),
    ...(apiUrl.startsWith('http://') ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }] as [string, object]] : []),
    // Customers scan merchants' and friends' QR codes. Merchant terminals read customers' NFC cards and
    // stickers, and scan the payment code on a customer's phone.
    ['expo-camera', {
      cameraPermission: business ? "Allow $(PRODUCT_NAME) to scan customers' payment codes."
        : ecosure ? 'Allow $(PRODUCT_NAME) to take photos of documents for quotes and claims.'
        : society ? 'Allow $(PRODUCT_NAME) to scan QR codes to pay your society.'
        : 'Allow $(PRODUCT_NAME) to scan QR codes to pay.',
      recordAudioAndroid: false,
    }] as [string, object],
    ...(business ? [['react-native-nfc-manager', { nfcPermission: 'Allow $(PRODUCT_NAME) to read customers’ phones to take payments.' }] as [string, object]] : []),
    // Pick people from the phone's contacts (Send money, phone-number fields).
    ['expo-contacts', { contactsPermission: 'Allow $(PRODUCT_NAME) to open your contacts so you can pick who to pay.' }] as [string, object],
    // School fees: term due dates go in the phone's calendar with a reminder. Events only, never reminders lists.
    ['expo-calendar', { calendarPermission: 'Allow $(PRODUCT_NAME) to add school fee due dates to your calendar.', remindersPermission: false }] as [string, object],
    // Long-press the app icon: Money / Scan / My QR code (customers), role-specific actions (business).
    // The items themselves are set at runtime (src/lib/shortcuts.ts); this only bundles their Android icons.
    ['expo-quick-actions', {
      // EcoSure and Mekhatlo have no shortcuts.
      androidIcons: Object.fromEntries(
        (business ? ['receive', 'qr', 'charge', 'cash_in', 'cash_out', 'register'] : ecosure || society ? [] : ['money', 'scan', 'qr']).map((n) => [
          `shortcut_${n}`,
          { foregroundImage: `./assets/shortcuts/shortcut_${n}.png`, backgroundColor: '#FFFFFF' },
        ]),
      ),
    }] as [string, object],
  ],
  extra: {
    ...config.extra,
    variant: business ? 'business' : ecosure ? 'ecosure' : society ? 'society' : 'customer',
    apiUrl,
  },
})
