// EcoSure calls, on EcoCash Super App's API client (same session, errors and maintenance handling).
import type {
  EsAddMemberBody, EsBuyBody, EsBuyResult, EsClaim, EsClaimBody, EsCover, EsPayBody, EsPayment, EsPayResult, EsPolicy,
  EsPolicyLookup, EsProduct, EsQuote, EsQuoteBody, EsSponsorship, EsSponsorships, EsUpdatePolicyBody, EsUpload, EsUploadBody,
} from '../../../shared/api'
import { api } from '../../lib/api'

const base = '/v1/ecosure'

export const ecosure = {
  products: () => api<EsProduct[]>(`${base}/products`),
  policies: () => api<EsPolicy[]>(`${base}/policies`),
  buy: (body: EsBuyBody) => api<EsBuyResult>(`${base}/policies`, { body }),
  update: (id: string, body: EsUpdatePolicyBody) => api<EsPolicy>(`${base}/policies/${id}`, { method: 'PATCH', body }),
  migrate: (id: string, cover: EsCover) => api<EsPolicy>(`${base}/policies/${id}/migrate`, { body: { cover } }),
  addMember: (id: string, body: EsAddMemberBody) => api<EsPolicy>(`${base}/policies/${id}/members`, { body }),
  removeMember: (id: string, memberId: string) => api<EsPolicy>(`${base}/policies/${id}/members/${memberId}`, { method: 'DELETE' }),
  lookup: (ref: string) => api<EsPolicyLookup>(`${base}/policies/lookup?ref=${encodeURIComponent(ref)}`),
  pay: (body: EsPayBody) => api<EsPayResult>(`${base}/payments`, { body }),
  payments: () => api<EsPayment[]>(`${base}/payments`),
  upload: (body: EsUploadBody) => api<EsUpload>(`${base}/uploads`, { body }),
  claims: () => api<EsClaim[]>(`${base}/claims`),
  claim: (body: EsClaimBody) => api<EsClaim>(`${base}/claims`, { body }),
  quotes: () => api<EsQuote[]>(`${base}/quotes`),
  quote: (body: EsQuoteBody) => api<EsQuote>(`${base}/quotes`, { body }),
  sponsorships: () => api<EsSponsorships>(`${base}/sponsorships`),
  sponsor: (msisdn: string) => api<EsSponsorship>(`${base}/sponsorships`, { body: { msisdn } }),
  sponsorAction: (id: string, action: 'accept' | 'decline' | 'cancel') => api<EsSponsorship>(`${base}/sponsorships/${id}/${action}`, { method: 'POST' }),
}
