import Constants from 'expo-constants'
import { router, type Href } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import type { RegisterDeviceBody } from '../../shared/api'
import { api } from './api'
import { APP } from './variant'

// System notifications for things that happen while the user may not be looking
// (someone paid your request, a token arrived). Local ones carry data { url }; pushes from the
// EcoCash Super App server carry data { chatId } (a chat message) or { screen } (money alerts, security).
// Which ones a user gets, and on which channel (push, SMS, email), is chosen in Me › Notifications.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

const CHANNEL = 'default'
let granted: boolean | null = null
let pushToken: string | null = null

/**
 * Ask once, at a moment that explains itself (e.g. after sending a request).
 * Resolves to whether notifications may be shown. Safe to call repeatedly.
 */
export async function enableNotifications(): Promise<boolean> {
  if (granted !== null) {
    // Signed in again (maybe as someone else): tell the server this phone belongs to the current wallet.
    if (granted) registerForPush()
    return granted
  }
  if (Platform.OS === 'web') return (granted = false)

  // Android 13+ only shows the permission prompt once a channel exists.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Payments',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#5B2C9F',
    })
  }

  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  granted = status === 'granted'
  if (granted) registerForPush()
  return granted
}

/** Expo push token for this device, or null until registered (needs an EAS project ID and a real device). */
export const getPushToken = () => pushToken
/** Why this phone has no push token (e.g. Firebase isn't set up in this build), for support and debugging. */
let pushProblem: string | null = null
export const getPushProblem = () => pushProblem

/** Signing out: this phone stops getting the wallet's pushes (the next person to sign in registers it again). */
export async function unregisterPush() {
  if (!pushToken) return
  await api('/v1/devices/unregister', { body: { expoPushToken: pushToken } }).catch(() => {})
}

async function registerForPush() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) {
    pushProblem = 'No EAS project ID: run eas init'
    return
  }
  try {
    pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data
    await api('/v1/devices', { body: { expoPushToken: pushToken, platform: Platform.OS === 'ios' ? 'ios' : 'android', app: APP } satisfies RegisterDeviceBody })
    pushProblem = null
  } catch (e) {
    // Android needs Firebase (google-services.json in the build and the FCM V1 key in EAS); iOS simulators and
    // Expo Go on Android cannot get a token at all. Pushes then arrive only while the app is open in the background.
    pushProblem = (e as Error).message
    if (__DEV__) console.warn('No push token:', pushProblem)
  }
}

/**
 * A push that arrived over the live connection (app in the background, no push service). Shown like a remote push,
 * with the same data, so tapping it opens the same screen. Silently skipped if the user hasn't allowed notifications.
 */
export async function showPush(title: string, body: string, data: Record<string, string>) {
  if (Platform.OS === 'web') return
  if ((await Notifications.getPermissionsAsync()).status !== 'granted') return
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Payments', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], lightColor: '#5B2C9F' })
  }
  await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: { channelId: CHANNEL } })
}

export type PushPermission = 'on' | 'off' | 'blocked'
/** This phone's notification permission: on, off (we may ask), or blocked (only the phone's settings can change it). */
export async function pushPermission(): Promise<PushPermission> {
  if (Platform.OS === 'web') return 'blocked'
  const p = await Notifications.getPermissionsAsync()
  return p.status === 'granted' ? 'on' : p.canAskAgain ? 'off' : 'blocked'
}

/** After sign-in or unlock: when allowed, (re)register this phone's push token for the wallet now signed in. */
export async function registerIfAllowed() {
  if ((await pushPermission()) === 'on') await enableNotifications()
}

/** A local notification after `seconds`, so the person can background the app and see it in the tray. */
export async function previewPush(title: string, body: string, seconds: number) {
  if (Platform.OS === 'web' || (await pushPermission()) !== 'on') return
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { url: '/notifications' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: CHANNEL },
  })
}

/** Show a notification now. Returns false when notifications are off, so callers can fall back to a toast. */
export async function notify(title: string, body: string, url?: Href): Promise<boolean> {
  if (!granted) return false
  // `{ channelId }` = show now, on our channel (a bare `null` trigger uses Expo's fallback channel on Android).
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: url ? { url } : {} }, trigger: { channelId: CHANNEL } })
  return true
}

/** Open the screen a notification points at, including when the tap launched the app. */
export function useNotificationRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return
    const open = (n: Notifications.Notification) => {
      const data = n.request.content.data ?? {}
      if (typeof data.url === 'string') router.push(data.url as Href)
      else if (typeof data.chatId === 'string') router.push({ pathname: '/chat/[id]', params: { id: data.chatId } })
      else if (data.screen === 'transactions') router.push('/transactions')
      else if (data.screen === 'notifications') router.push('/notifications')
      else if (data.screen === 'pending') router.push('/pending')
      else if (data.screen === 'society') router.push('/society')
      else if (data.screen === 'friends') router.push('/friends')
    }
    const last = Notifications.getLastNotificationResponse()
    if (last) open(last.notification)
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification))
    return () => sub.remove()
  }, [])
}
