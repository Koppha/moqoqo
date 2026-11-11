import { Image } from 'react-native'
import type { ServiceDef } from '../../shared/api'
import type { BillKey } from '../types'
import { apiUrl } from '../lib/server'
import { BILL_ICON, txIcon } from './icons'
import { MiniAppIcon } from './MiniAppIcon'
import { AppIcon, Avatar, type IconName } from './ui'

// Requests and transaction lines wear the same logos as Services and Pay bill (portal pictures), so a WASCO payment
// shows the WASCO logo everywhere. Without a logo: the built-in icon.

const logo = (uri: string, size: number) => (
  <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" accessibilityIgnoresInvertColors />
)

/** A bill request (LEC, WASCO, school, airtime, burial): its mini app logo from the portal, else its icon. */
export function BillIcon({ bill, name, size }: { bill: BillKey; name: string; size: number }) {
  const ic = BILL_ICON[bill]
  return <MiniAppIcon id={bill} size={size} fallback={<Avatar name={name} icon={ic.icon} color={ic.color} size={size} />} />
}

/**
 * A wallet transaction line. Service payments are labelled "<service name> · <account>" (and "<service name> fee"):
 * those show the service's picture or icon. LEC and EcoSure show their mini app logos.
 */
export function TxIcon({ description, amount, services, size }: { description: string; amount: number; services: ServiceDef[]; size: number }) {
  const svc = services.find((s) => description === s.name.en || description.startsWith(`${s.name.en} · `) || description === `${s.name.en} fee`)
  if (svc?.image) return logo(apiUrl() + svc.image, size)
  if (svc) return <AppIcon icon={svc.icon as IconName} color={svc.color} size={size} />
  const ic = txIcon(description, amount)
  const plain = <AppIcon icon={ic.icon} color={ic.color} size={size} />
  if (/^LEC\b/.test(description)) return <MiniAppIcon id="lec" size={size} fallback={plain} />
  if (/EcoSure/.test(description)) return <MiniAppIcon id="ecosure" size={size} fallback={plain} />
  return plain
}
