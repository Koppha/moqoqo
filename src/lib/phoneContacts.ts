import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts'
import { toMsisdn } from '../../shared/api'

// Picking someone from the phone's own contacts (the system picker), for any field that takes a phone number.

export interface PickedContact {
  name: string
  /** Lesotho numbers on the contact, as 8 digits (no +266), in the contact's order. */
  numbers: string[]
}

/** 8-digit Lesotho number from what's saved in the contact ("+266 6200 0021", "62000021", "0026662000021"). */
export function lesothoNumber(raw: string): string | null {
  return toMsisdn(raw)?.slice(4) ?? null
}

/** Opens the phone's contact picker. null = cancelled; numbers is empty when the contact has no Lesotho number. */
export async function pickContact(): Promise<PickedContact | null | 'denied'> {
  const perm = await requestPermissionsAsync().catch(() => null)
  if (!perm?.granted) return 'denied'
  const contact = await Contact.presentPicker()
  if (!contact) return null
  const [details, phones] = await Promise.all([contact.getDetails([ContactField.FULL_NAME]).catch(() => null), contact.getPhones().catch(() => [])])
  const numbers = [...new Set(phones.map((p) => lesothoNumber(p.number ?? '')).filter((n): n is string => !!n))]
  return { name: details?.fullName ?? '', numbers }
}

export interface PhoneContact {
  name: string
  /** Lesotho numbers, as 8 digits. */
  numbers: string[]
}

/** Every contact with a Lesotho number (name and numbers only), or 'denied'. For Friends › Contacts. */
export async function allContacts(): Promise<PhoneContact[] | 'denied'> {
  const perm = await requestPermissionsAsync().catch(() => null)
  if (!perm?.granted) return 'denied'
  const rows = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES] as const)
  // A number saved twice (a duplicate contact, or one synced from WhatsApp or the SIM) shows once.
  const seen = new Set<string>()
  return rows.flatMap((r) => {
    const numbers = [...new Set((r.phones ?? []).map((p) => lesothoNumber(p.number ?? '')).filter((n): n is string => !!n))].filter((n) => !seen.has(n))
    numbers.forEach((n) => seen.add(n))
    return numbers.length ? [{ name: r.fullName || `+266 ${numbers[0]}`, numbers }] : []
  })
}

/** Whether the phone already lets us read contacts (never asks). */
export async function contactsAllowed(): Promise<boolean> {
  return (await getPermissionsAsync().catch(() => null))?.granted ?? false
}
