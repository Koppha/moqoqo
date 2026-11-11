import type { Href } from 'expo-router'
import * as QuickActions from 'expo-quick-actions'
import { useQuickActionRouting, type RouterAction } from 'expo-quick-actions/router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import type { Role } from '../../shared/api'
import { useT } from '../i18n'

/** Plain path strings: shortcut params must be serializable. */
type Path = Extract<Href, string>
type Shortcut = { id: string; title: string; android: string; ios: string; href: Path }

/**
 * Home-screen shortcuts (long-press the app icon), like WeChat's Money / Scan / My QR Code.
 * Android icons are bundled by the expo-quick-actions plugin in app.config.ts; iOS uses SF Symbols.
 * Call from the signed-in layouts: it sets the items for this role and language and opens the
 * chosen screen (also when the shortcut launched the app).
 */
export function useAppShortcuts(role: Role | undefined) {
  const t = useT()
  useQuickActionRouting()

  useEffect(() => {
    if (Platform.OS === 'web' || !role) return
    const items: Shortcut[] =
      role === 'customer'
        ? [
            { id: 'money', title: t.money.title, android: 'shortcut_money', ios: 'symbol:wallet.pass', href: '/money' },
            { id: 'scan', title: t.pay.scanAction, android: 'shortcut_scan', ios: 'symbol:qrcode.viewfinder', href: '/pay' },
            { id: 'qr', title: t.receive.myQr, android: 'shortcut_qr', ios: 'symbol:qrcode', href: '/receive-money' },
          ]
        : role === 'merchant'
          ? [
              { id: 'receive', title: t.receive.title, android: 'shortcut_receive', ios: 'symbol:banknote', href: '/receive' },
              { id: 'qr', title: t.receive.myQr, android: 'shortcut_qr', ios: 'symbol:qrcode', href: '/my-qr' },
              { id: 'charge', title: t.biz.charge, android: 'shortcut_charge', ios: 'symbol:doc.text', href: '/biz-action/charge' },
            ]
          : [
              { id: 'cash-in', title: t.biz.cashIn, android: 'shortcut_cash_in', ios: 'symbol:arrow.down.circle', href: '/biz-action/cash-in' },
              { id: 'cash-out', title: t.biz.cashOut, android: 'shortcut_cash_out', ios: 'symbol:arrow.up.circle', href: '/receive?purpose=cashout' },
              { id: 'register', title: t.biz.register, android: 'shortcut_register', ios: 'symbol:person.badge.plus', href: '/biz-action/register' },
            ]
    QuickActions.setItems<RouterAction<Path>>(
      items.map((s) => ({ id: s.id, title: s.title, icon: Platform.OS === 'ios' ? s.ios : s.android, params: { href: s.href } })),
    ).catch(() => {})
  }, [role, t])
}

/** After sign-out the shortcuts would only lead to the login screen. */
export const clearAppShortcuts = () => {
  if (Platform.OS !== 'web') QuickActions.setItems([]).catch(() => {})
}
