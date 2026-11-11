import { useCallback, useEffect, useState } from 'react'
import type { SavedBill, SavedRecipient } from '../../shared/api'
import { api } from './api'

// Saved bills (accounts at billers, up to 5 each) and saved people, kept on the server for the person.

/** The person's saved bills, all of them or one biller's ('lec', 'service:<id>'). */
export function useSavedBills(target?: string): { bills: SavedBill[]; reload: () => void } {
  const [all, setAll] = useState<SavedBill[]>([])
  const reload = useCallback(() => {
    api<SavedBill[]>('/v1/saved-bills').then(setAll, () => {})
  }, [])
  useEffect(reload, [reload])
  return { bills: target ? all.filter((b) => b.target === target) : all, reload }
}

export function useSavedRecipients(): { people: SavedRecipient[]; reload: () => void } {
  const [people, setPeople] = useState<SavedRecipient[]>([])
  const reload = useCallback(() => {
    api<SavedRecipient[]>('/v1/saved-recipients').then(setPeople, () => {})
  }, [])
  useEffect(reload, [reload])
  return { people, reload }
}

export const saveBill = (target: string, account: string, nickname: string) =>
  api<SavedBill>('/v1/saved-bills', { body: { target, account, nickname } })

export const removeSavedBill = (id: string) => api(`/v1/saved-bills/${id}`, { method: 'DELETE' })

export const saveRecipient = (msisdn: string, nickname: string) => api<SavedRecipient>('/v1/saved-recipients', { body: { msisdn, nickname } })

export const removeRecipient = (id: string) => api(`/v1/saved-recipients/${id}`, { method: 'DELETE' })
