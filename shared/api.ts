// EcoCash Super App API contract, shared by server/, portal/ and the Expo apps (customer + business).
// Pure types and constants only: no runtime imports, so every project can include this file.
//
// Conventions
// - Base path /v1 (apps) and /admin/v1 (portal). JSON in, JSON out.
// - Auth: `Authorization: Bearer <token>`; tokens are opaque, server-side sessions (revocable).
// - Money: maloti (LSL) as numbers with at most 2 decimals. The server stores cents.
// - Times: ISO 8601 strings in UTC.
// - Errors: non-2xx status with body ApiError.
// - While maintenance is active every /v1 route except /v1/app-config and /v1/ws answers 503 MAINTENANCE.
//   /admin/v1 keeps working so staff can end it.

// ---------- errors ----------

export type ErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'WRONG_PIN'
  | 'PIN_LOCKED' // too many wrong PINs; locked for a while
  | 'LIMIT_EXCEEDED'
  | 'NOT_REGISTERED' // no such wallet number
  | 'SUSPENDED' // account suspended by an admin
  | 'WRONG_APP' // e.g. a customer logging in to the business app
  | 'WRONG_ROLE' // business login: chose Merchant for an agent's number, or the other way round
  | 'CARD_DECLINED' // the card gateway declined the card or the charge
  | 'NOT_ECONET' // setting up EcoCash Super App on a phone needs an Econet SIM on Econet mobile data (not Wi-Fi)
  | 'PROFILE_NEEDED' // the standalone EcoSure app: this number has no EcoSure profile (and PIN) yet
  | 'DEVICE_BLOCKED' // this phone is rooted or jailbroken, or in developer mode, and the portal blocks such phones
  | 'SIM_SWAP_HOLD' // the number moved to a new SIM recently: no new phone setup until staff check the owner in person
  | 'SIM_NOT_IN_PHONE' // first sign-in on a phone: its SIM (or Econet's network) shows a different number
  | 'TERMS_REQUIRED' // setting up a phone: the customer must accept the terms of use first
  | 'RATE_LIMITED' // too many attempts from this connection; try again shortly
  | 'ID_MISMATCH' // the ID details don't match Home Affairs, or this ID isn't the one on the wallet
  | 'KYC_REQUIRED' // needs a higher KYC tier (cash-out, ATM) or over the tier-1 limit: Me › Update KYC
  | 'RISK_BLOCKED' // stopped by a fraud rule (e.g. too many payments too fast); staff review it in the portal
  | 'BLOCKED' // one of the two people blocked the other: no messages, money or requests between them one to one
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT' // e.g. request already paid
  | 'MAINTENANCE'
  | 'NETWORK' // client-side only: no response
  | 'UNKNOWN'

export interface ApiError {
  error: { code: ErrorCode; message: string; maintenance?: Maintenance }
}

// ---------- users ----------

export type Role = 'customer' | 'agent' | 'merchant'
/**
 * customer = EcoCash Super App, business = EcoCash Business, ecosure = the standalone EcoSure app, society = the
 * standalone Mekhatlo app (both the same as their mini apps). Mekhatlo signs in with the EcoCash number and PIN.
 */
export type AppKind = 'customer' | 'business' | 'ecosure' | 'society'
export const APP_KINDS: AppKind[] = ['customer', 'business', 'ecosure', 'society']
/** Each app's name, for messages and the portal. */
export const APP_NAMES: Record<AppKind, string> = { customer: 'EcoCash Super App', business: 'EcoCash Business', ecosure: 'EcoSure', society: 'Mekhatlo' }

export interface PublicUser {
  id: string
  msisdn: string // E.164, e.g. +26662000021
  name: string
  role: Role
  /** Verified organisation accounts (LEC, merchants with a business name). */
  official?: boolean
  businessName?: string
  /** Chosen by the person (Me › Username); others can find them by it. */
  username?: string
  /** Profile picture (Me › photo), an asset path like /v1/assets/<id>; none: initials. */
  photo?: string
}

export interface Me extends PublicUser {
  balance: number
  kycTier: 1 | 2
  /** Agents: AGENT-0101. Merchants: a plain number (1001, 1042). */
  code?: string
  /** Quick Pay is on: the customer accepted the Payment User Service Agreement and can show a payment code. */
  quickPay?: boolean
  /** Who may start a chat: everyone, or only friends (others land in Message requests). */
  messagePolicy?: MessagePolicy
  /** An app PIN opens the app (Me › Change PIN); without one, the EcoCash wallet PIN does. */
  appPin?: boolean
}

// ---------- auth (/v1/auth) ----------

/**
 * POST /v1/auth/login. Business app accepts agent and merchant roles only; customer app accepts all roles.
 * `role`: the business app's Merchant / Agent choice; a number of the other role gets 403 WRONG_ROLE (after the PIN check).
 */
export interface LoginBody {
  /** The wallet number, or the person's username (with or without @). */
  msisdn: string
  pin: string
  app: AppKind
  role?: 'agent' | 'merchant'
  /** This phone. A wallet is bound to one phone per app; on any other phone the login starts sign-up (Onboarding). */
  device?: DeviceInfo
  /** What the phone sees of its SIM and connection; setting up a phone needs Econet mobile data. */
  network?: NetworkCheck
}
export interface LoginResponse { token: string; user: Me }
/** Login from a phone that isn't bound yet (202): continue with the sign-up steps under /v1/onboarding/:id. */
export interface LoginNeedsSetup { onboarding: OnboardingStart }
export type LoginResult = LoginResponse | LoginNeedsSetup

// ---------- EcoCash Business as a mini app (/v1/businesses) ----------
// A person links the agent or merchant accounts they own (their verified ID must match the owner ID EcoCash recorded
// for the business, and they enter its PIN), once; the Business tile
// then opens one inside EcoCash Super App (a business session, no second sign-in). The business keeps its own wallet.
export interface LinkedBusiness { id: string; name: string; role: 'agent' | 'merchant'; code: string | null; msisdn: string }
/** POST /v1/businesses/link → LinkedBusiness. The business account's own PIN proves the person runs it. */
export interface LinkBusinessBody { msisdn: string; pin: string }
/** POST /v1/businesses/:id/open → LoginResponse: a session for the business account, opened from this EcoCash Super App. */
export const BUSINESS_LINKS_MAX = 10

// ---------- friends, invites, groups ----------
// Friends: a request the other person accepts or declines, then friends both ways. Add by number, username, or the
// personal QR code (moqoqo://add?u=<userId>). People not on EcoCash get an SMS invite; when they first sign in, the
// inviter's friend request is waiting. With messagePolicy 'friends', a chat started by anyone else is a message
// request (no notifications) until accepted. Groups made in the app invite people, who join or decline.

export type MessagePolicy = 'everyone' | 'friends'
export type FriendRelation = 'friend' | 'outgoing' | 'incoming' | 'none' | 'self'
export interface FriendRequest { id: string; from: PublicUser; to: PublicUser; createdAt: string }
export interface GroupInvite { id: string; chatId: string; title: string; from: PublicUser; memberCount: number; createdAt: string }
/** GET /v1/friends */
export interface FriendsOverview {
  friends: PublicUser[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  groupInvites: GroupInvite[]
  /** Chats waiting in Message requests. */
  messageRequests: number
}
/** POST /v1/friends/requests: one of these. → FriendRequest (201), or { accepted: true } when they had asked you already. */
export interface FriendRequestBody { msisdn?: string; username?: string; userId?: string }
/** POST /v1/contacts/match { msisdns } (up to 1000): which of the phone's contacts use EcoCash. */
export interface ContactMatch { msisdn: string; user: PublicUser; relation: FriendRelation }
/** POST /v1/invites { msisdn } → 201: an SMS invite to a number that isn't on EcoCash. */
export interface InviteBody { msisdn: string }
/** POST /v1/groups → ChatSummary of the new group; the members are invited and join when they accept. */
export interface CreateGroupBody { title: string; memberIds: string[] }
/** PUT /v1/me/privacy → Me */
export interface PrivacyBody { messagePolicy: MessagePolicy }
/** GET /v1/users/:id/relation → { user, relation }: the personal QR's preview. */
export interface UserRelation { user: PublicUser; relation: FriendRelation; blockedByMe?: boolean }

// ---------- blocking (/v1/blocks) ----------
/**
 * A person blocks another person (customers only, not merchants or agents). While it stands, neither can message,
 * send or request money, or send a friend request to the other one to one; their groups are unaffected. Blocking
 * also ends a friendship and declines open friend requests and money requests between them. The blocked person is
 * never told: they see "can't reach this person".
 * GET /v1/blocks → BlockedUser[]. POST /v1/blocks { userId } → BlockedUser[]. DELETE /v1/blocks/:userId → BlockedUser[].
 */
export interface BlockedUser { user: PublicUser; since: string }
export interface BlockBody { userId: string }
export const INVITES_PER_DAY = 20
export const GROUP_MAX_MEMBERS = 100

// ---------- usernames ----------
/** 3–20 characters: lowercase letters, digits, dot and underscore; starts with a letter. Case doesn't matter. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,19}$/
/** PUT /v1/me/username { username } → Me (CONFLICT if taken). GET /v1/users/lookup?username= → PublicUser. POST /v1/chats { username } too. */
export interface SetUsernameBody { username: string }

// ---------- sign-up on a phone: ID check, OTP, device binding ----------
//
// 1. POST /v1/auth/login with number + EcoCash PIN + device + network → 202 LoginNeedsSetup (new phone)
// 2. POST /v1/onboarding/:id/identity { idNumber } → Home Affairs name
// 3. POST /v1/onboarding/:id/confirm { nameConfirmed, dob, gender } → OTP sent by SMS
// 4. POST /v1/onboarding/:id/verify { otp } → LoginResponse; this phone is now the bound phone (the previous one is
//    signed out and kept in the history)
// Fingerprint / face is then set on the phone itself (or skipped).

/** Econet Telecom Lesotho's SIM network code (MCC 651, MNC 02). TO CONFIRM with ETL. */
export const ECONET_SIM = { mcc: '651', mnc: '02' } as const
export const OTP_LENGTH = 6
export const OTP_RESEND_SECONDS = 30

export interface DeviceInfo {
  /** Android ID / iOS identifier for vendor: the same for this app on this phone. */
  deviceId: string
  platform: 'android' | 'ios'
  model: string // "Pixel 7"
  osVersion: string
  appVersion: string
  /** What the app can tell about the phone's safety; the server refuses phones the portal's device security blocks. */
  integrity?: DeviceIntegrity
}

/**
 * Device safety, as the app reads it. rooted: rooted (Android) or jailbroken (iOS); a best effort that a determined
 * attacker can hide. developerMode: Android developer options or USB debugging on (iPhone: not detectable, false).
 */
export interface DeviceIntegrity { rooted: boolean; developerMode: boolean; emulator: boolean }

/** Set by admins in the portal (Settings › Device security): which phones the apps refuse to run on. */
export interface DeviceSecurity {
  blockRooted: boolean
  blockDeveloperMode: boolean
  /** First sign-in on a phone: refuse it when the phone's SIM (or Econet's network) shows a number other than the wallet's. */
  requireSimMatch: boolean
  /** Sign out after this many minutes without use (apps and portal). CBL/LCA DFS guidelines 3.2.8a: at most 15. */
  idleMinutes: number
  /** A session ends after this many days even when in use; the person signs in again. */
  sessionDays: number
  /** Wrong PINs (or staff passwords) in a row before that PIN or account is locked (guidelines 3.2.5b-v). */
  maxPinAttempts: number
  /** How long the lock lasts. */
  pinLockMinutes: number
}
// Placeholders until ETL decides; rooted phones are blocked by default (guidelines 3.2.3a).
export const DEFAULT_DEVICE_SECURITY: DeviceSecurity = {
  blockRooted: true, blockDeveloperMode: false, requireSimMatch: true, idleMinutes: 15, sessionDays: 30, maxPinAttempts: 5, pinLockMinutes: 15,
}
export const SECURITY_LIMITS = { idleMinutes: [1, 15], sessionDays: [1, 90], maxPinAttempts: [3, 10], pinLockMinutes: [5, 1440] } as const

/**
 * How sure we are, at a phone's first sign-in, that the wallet's SIM is in that phone. network: Econet's network
 * confirmed the number of the connection (header enrichment, to be connected). sim: the SIM in the phone reports the
 * wallet's number. econet_sim: an Econet SIM is in the phone but doesn't say its number. unknown: the phone shows no
 * SIMs (iPhone). mismatch: another number, let through because the portal doesn't require a match. simulated: a
 * test build pretending to be on Econet.
 */
export type SimCheck = 'network' | 'sim' | 'econet_sim' | 'unknown' | 'mismatch' | 'simulated' | 'travel'
export const SIM_CHECK_LABEL: Record<SimCheck, string> = {
  network: 'Number confirmed by Econet',
  sim: "Phone's SIM shows this number",
  econet_sim: 'Econet SIM, number not shown',
  unknown: "Phone doesn't show its SIM",
  mismatch: 'SIM shows another number (allowed by settings)',
  simulated: 'Test build (simulated)',
  travel: 'Travelling: set up with an email code, SIM not checked',
}

/** Why this phone is blocked under the policy, or null. Without a report (an older app) a blocking policy blocks: update first. */
export function deviceBlockReason(policy: DeviceSecurity, integrity: DeviceIntegrity | undefined): 'rooted' | 'developer' | 'unknown' | null {
  if (!policy.blockRooted && !policy.blockDeveloperMode) return null
  if (!integrity) return 'unknown'
  if (policy.blockRooted && integrity.rooted) return 'rooted'
  if (policy.blockDeveloperMode && integrity.developerMode) return 'developer'
  return null
}

export interface NetworkCheck {
  /** How the phone is connected right now. */
  type: 'cellular' | 'wifi' | 'none' | 'other'
  /** The SIMs the phone reports (Android; iPhones don't say). */
  sims: { mcc: string | null; mnc: string | null; carrier: string | null; number?: string | null }[]
  /** Test builds only: pretend to be on Econet (emulators have a test SIM). Refused unless the server allows it. */
  simulated?: boolean
}

export interface OnboardingStart {
  id: string
  /** Masked number, e.g. +266 62•• ••21 */
  msisdn: string
  expiresAt: string
}
export interface OnboardingIdentityBody { idNumber: string }
export interface OnboardingIdentity { fullName: string }
export interface OnboardingConfirmBody { nameConfirmed: boolean; dob: string; gender: 'female' | 'male' }
export interface OnboardingOtpSent {
  sentTo: string
  /** Where the code went: SMS to the wallet's number, or email while the person is travelling (codes by email on). */
  channel?: 'sms' | 'email'
  resendAfter: number
  /** Only while SMS is a mock (test servers): the code, since no SMS is really sent. */
  devCode?: string
}
/** POST /v1/onboarding/:id/resend → OnboardingOtpSent */
export interface OnboardingVerifyBody { otp: string }
/** POST /v1/onboarding/:id/verify → LoginResponse (or, creating an EcoSure profile, OnboardingNext: the ID is next) */

// EcoSure profile (the standalone EcoSure app). The person creates their own EcoSure PIN; the EcoCash PIN is never
// used to sign in to EcoSure (EcoCash approves payments itself). The SMS code comes first, so only the phone's owner
// can look up an ID at Home Affairs:
// 1. POST /v1/ecosure/profile { msisdn, device, network } → EcoSureProfileStart (code sent by SMS)
// 2. POST /v1/onboarding/:id/verify { otp } → OnboardingNext { next: 'identity' }
// 3. POST /v1/onboarding/:id/identity, then /confirm → OnboardingNext { next: 'pin' }
// 4. POST /v1/onboarding/:id/pin { pin } → LoginResponse; this phone is bound. Doing it again resets a forgotten PIN.
export interface EcoSureProfileBody { msisdn: string; device: DeviceInfo; network: NetworkCheck }
export interface EcoSureProfileStart { onboarding: OnboardingStart; sent: OnboardingOtpSent }
export interface OnboardingNext { next: 'identity' | 'pin' }
/** Numbers that may create an EcoSure profile for now (later: any Lesotho number). */
export const ECOSURE_PROFILE_NETWORKS: PhoneNetwork[] = ['econet']

export interface BoundDevice {
  id: string
  model: string
  platform: 'android' | 'ios'
  osVersion: string
  appVersion: string
  app: AppKind
  boundAt: string
  lastSeenAt: string | null
  /** Set once another phone took over (or staff removed it). */
  unboundAt?: string
  unboundReason?: 'replaced' | 'removed_by_staff' | 'removed_by_user' | 'reported_lost'
  /** At its first sign-in: how the wallet's SIM was matched to this phone. */
  simCheck?: SimCheck
  /** What this phone usually looks like (learned from its requests); staff only. */
  profile?: DeviceProfileSummary
  /** The phone making this request. */
  current?: boolean
}
/** GET /v1/me/devices → BoundDevice[] (the bound phone first, then earlier ones) */
/** POST /v1/auth/verify-pin, used by the lock screen. 204 on success. */
export interface VerifyPinBody { pin: string }
/** POST /v1/auth/logout revokes the current token. 204. */

/** GET /v1/me → Me */

/** GET /v1/users/lookup?msisdn=+266… → PublicUser (404 NOT_REGISTERED) */

// ---------- chats & messages ----------

export type ChatKind = 'direct' | 'group' | 'official'

export interface ChatSummary {
  id: string
  kind: ChatKind
  /** Group name, or the other person's name for direct chats. */
  title: string
  members: PublicUser[]
  lastMessage?: Message
  unread: number
  updatedAt: string
  /** The EcoCash Assistant's chat (an official chat the user can type in). */
  assistant?: boolean
  /** The EcoCash Support chat: people from support answer here (also an official chat the user can type in). */
  support?: boolean
  /** A chat started by someone who isn't a friend, while the viewer accepts messages from friends only. */
  request?: boolean
  /** Groups: who made it (only they can delete it; everyone else can leave). */
  createdBy?: string
  /** Direct chats: the viewer blocked the other person (the blocked person is never told). */
  blockedByMe?: boolean
}

export type BillKey = 'lec' | 'wasco' | 'school' | 'airtime' | 'burial'
export type RequestStatus = 'pending' | 'paid' | 'declined' | 'cancelled'
/**
 * money: Kopa (pay me). bill: Ntefelle (pay this bill for me; the payer pays the biller directly).
 * cashout: an agent asks a customer to approve a cash withdrawal; paying moves e-money to the agent, who hands over cash.
 * merchant: a merchant asks a customer to pay for a sale.
 * split: split bill; each participant approves their share, which is then collected without a PIN (see RequestInfo.split).
 */
export type RequestKind = 'money' | 'bill' | 'cashout' | 'merchant' | 'split'

/** equal: the total divided evenly. specific: the organiser set each share. enter: each member types their own amount. */
export type SplitMethod = 'equal' | 'specific' | 'enter'
/**
 * Where the money goes. organiser: to the organiser. subscriber: to another wallet. merchant_cover: the organiser
 * paid the merchant in full when creating the split, and the shares come back to the organiser. merchant_direct:
 * each share goes to the merchant as it is collected.
 */
export type SplitMode = 'organiser' | 'subscriber' | 'merchant_cover' | 'merchant_direct'
/**
 * awaiting: waiting for the person to approve. collecting: approved; collected right away and then whenever money
 * arrives, until paid. declined, expired (not approved in time), lapsed (the collection deadline passed with money
 * still owed): the organiser decides (move it to someone else, cover it, or cancel the split). covered: the organiser
 * took it over. reassigned: moved to someone else. cancelled: the split was cancelled.
 */
export type SplitShareStatus = 'awaiting' | 'collecting' | 'paid' | 'declined' | 'expired' | 'lapsed' | 'covered' | 'reassigned' | 'cancelled'
/** Shares the organiser must decide about. */
export const SPLIT_PROBLEM: SplitShareStatus[] = ['declined', 'expired', 'lapsed']
export interface SplitShare {
  userId: string
  name: string
  /** Absent for method `enter` until the member approves. */
  amount?: number
  paid: number
  status: SplitShareStatus
  /** Set once this member has paid in full; the organiser's own share starts paid. */
  paidAt?: string
  /** awaiting: approve before this, or it counts as declined. */
  approveBy?: string
  /** collecting: automatic collection stops at this time. */
  collectUntil?: string
}
export interface SplitInfo {
  method: SplitMethod
  mode: SplitMode
  /** The merchant or other subscriber the bill is for (absent when the organiser receives). */
  payee?: { id: string; name: string }
  shares: SplitShare[]
}
/**
 * Split bill limits, set in the portal (PLACEHOLDER values until ETL confirms). GET /v1/split-settings,
 * GET/PUT /admin/v1/split-settings.
 */
export interface SplitSettings {
  /** Hours a person has to approve before their share counts as declined. */
  approvalHours: number
  /** Reminders to approve, in hours after the request. */
  reminderHours: number[]
  /** Days automatic collection keeps trying after approval. */
  collectionDays: number
  /** Largest share a fully verified person can approve for pinless collection. */
  maxShare: number
  /** Largest share for KYC tier 1. */
  maxShareTier1: number
  /** Most a person may owe across all their open splits. */
  maxOpenOwed: number
  maxParticipants: number
  /** Automatic collection never takes a wallet below this. */
  balanceFloor: number
  /** Allow merchant splits where the merchant waits for each share (otherwise the organiser covers the bill). */
  merchantDirect: boolean
}

export interface RequestInfo {
  kind: RequestKind
  amount: number
  /** Paid so far (partial payments in groups). */
  paid: number
  status: RequestStatus
  bill?: BillKey
  account?: string // meter / account number for bills
  detail?: string // e.g. "Meter 0412 7731 905 · Mme's house"
  note?: string
  /** Who receives the money (the requester, or the agent/merchant). */
  toUserId: string
  paidByName?: string
  /** Split bills: amount = the total (0 when members enter amounts with no total), paid = collected so far. */
  split?: SplitInfo
}

/** action: the EcoCash Assistant prepared something for the user to review and confirm (see AssistantAction). */
export type MessageKind = 'text' | 'money' | 'mpho' | 'request' | 'receipt' | 'system' | 'action' | 'cause'

export interface Message {
  id: string
  chatId: string
  senderId: string
  /** Set by the sender's client so it can match its optimistic copy. */
  clientId?: string
  kind: MessageKind
  createdAt: string
  text?: string // text, system
  amount?: number // money, mpho, receipt
  note?: string
  request?: RequestInfo // request
  action?: AssistantAction // action
  cause?: CauseCard // cause: live progress of a shared cause
}

/** GET /v1/chats → ChatSummary[] (newest first) */
/** POST /v1/chats: get-or-create a direct chat with a wallet number, or create a group. */
export type CreateChatBody = { msisdn: string } | { username: string } | { title: string; memberMsisdns: string[] }
/** GET /v1/chats/:id/messages?before=<messageId>&limit=50 → Message[] (oldest first) */
/** POST /v1/chats/:id/messages → Message */
export interface SendTextBody { clientId: string; text: string }
/** POST /v1/chats/:id/read → 204 (marks all read) */

// ---------- money ----------

export interface Transaction {
  id: string
  reference: string // e.g. MP2610121234
  /**
   * ecosure: an EcoSure premium. claim: an EcoSure claim payout into the wallet.
   * topup: money in from a bank card. withdraw: money out to a bank account. fee: an EcoCash Super App fee (e.g. on a bank transfer).
   * service: a portal-defined service (to another network through the EcoCash API, airtime, bundles).
   * atm: money set aside for a cardless ATM withdrawal. atm_refund: it came back (expired or cancelled before the cash came out).
   */
  kind: 'send' | 'mpho' | 'request' | 'bill' | 'merchant' | 'tap' | 'qr' | 'cashin' | 'cashout' | 'float' | 'register' | 'ecosure' | 'claim'
    | 'topup' | 'withdraw' | 'fee' | 'service' | 'atm' | 'atm_refund'
  /** Signed from the viewer's side: negative = money out. */
  amount: number
  counterpartyName: string
  description: string
  createdAt: string
}

/** POST /v1/payments/send → MoneyResult (posts a money/mpho message into the chat) */
export interface SendMoneyBody { chatId: string; toUserId: string; amount: number; pin: string; kind: 'money' | 'mpho'; note?: string; clientId: string }
export interface MoneyResult { balance: number; transaction: Transaction; message?: Message }

/** Most people in one send to many. */
export const SEND_MANY_MAX = 50
/**
 * POST /v1/payments/send-many → SendManyResult. One PIN, then one payment per person, each on its own (the EcoCash API
 * pays one person per call): some can go through while others fail. `to` is a number or @username. Each person gets
 * the money in their chat with the sender. Retrying with the same clientId pays only the people not paid yet.
 */
export interface SendManyBody { recipients: { to: string; amount: number }[]; pin: string; note?: string; clientId: string }
export type SendManyPayment = { to: string; amount: number; user: PublicUser | null } & (
  | { ok: true; chatId: string; transaction: Transaction; message: Message }
  | { ok: false; error: { code: ErrorCode; message: string } }
)
export interface SendManyResult {
  balance: number
  /** What was actually sent. */
  total: number
  /** In the order sent, one per recipient. */
  payments: SendManyPayment[]
}

/** POST /v1/requests → Message (kind request, status pending) */
export interface CreateRequestBody {
  chatId: string
  clientId: string
  amount: number
  kind: 'money' | 'bill'
  bill?: BillKey
  account?: string
  detail?: string
  note?: string
}
/**
 * POST /v1/requests/:messageId/pay → PayRequestResult. amount defaults to what is still due.
 * Split bills: pays everything the caller still owes on their share now, with their PIN (also before approving, which
 * counts as approving). `amount` is required for method `enter` when the share has no amount yet.
 * POST /v1/requests/:messageId/decline: a split participant declines their share (only while awaiting approval).
 */
export interface PayRequestBody { pin: string; amount?: number }

/**
 * POST /v1/splits → Message (a split request in the chat). Participants must be chat members; when the organiser is one,
 * they pay their own cut now with their PIN. Everyone else gets a pinless payment request to approve.
 * equal: `total` required, divided evenly (spare cents to the first participants). specific: each participant's
 * `amount` required; the total is their sum. enter: `total` optional, for reference (required for merchants).
 * payTo: who receives the money; absent = the organiser.
 */
export interface CreateSplitBody {
  chatId: string
  clientId: string
  method: SplitMethod
  total?: number
  participants: { userId: string; amount?: number }[]
  note?: string
  pin: string
  payTo?: SplitPayTo
}
/** subscriber: a wallet number or @username. merchant: organiserCovers = the organiser pays the merchant in full now. */
export type SplitPayTo = { subscriber: string } | { merchantCode: string; organiserCovers: boolean }
/**
 * POST /v1/splits/:messageId/approve → Message. The caller approves their share with their PIN; from then on it is
 * collected without a PIN: what the wallet can spare now (keeping SplitSettings.balanceFloor), and the rest as money
 * arrives, oldest split first, until paid or SplitSettings.collectionDays pass. `amount` is required for method `enter`.
 */
export interface ApproveShareBody { pin: string; amount?: number }
/**
 * POST /v1/splits/:messageId/shares/:userId/resolve → Message. The organiser decides about a declined, expired or
 * lapsed share. reassign: what is still owed goes to another chat member as a new request. cover: the organiser takes
 * it over (pays what is still owed with their PIN, unless the money was coming to them anyway).
 */
export type ResolveShareBody = { action: 'reassign'; userId: string } | { action: 'cover'; pin?: string }
/**
 * POST /v1/splits/:messageId/cancel → Message. The organiser stops all collection. refund: give back what was
 * collected (only when the money came to the organiser; otherwise the receiver must refund).
 */
export interface CancelSplitBody { pin: string; refund?: boolean }
/** GET /v1/splits → Message[]: split bills I organised or am part of, newest first (history). */
export interface PayRequestResult extends MoneyResult { message: Message; token?: string; units?: string }
/** POST /v1/requests/:messageId/decline → Message */

/** POST /v1/bills/pay → BillResult (LEC returns a token, also posted into the LEC official chat) */
export interface PayBillBody { bill: BillKey; account: string; amount: number; pin: string }
export interface BillResult extends MoneyResult { token?: string; units?: string }

/** POST /v1/payments/tap: customer taps a merchant. No PIN at or under NO_PIN_TAP_LIMIT. */
export interface TapBody { merchantCode: string; amount: number; pin?: string }

/** GET /v1/transactions?limit=50 → Transaction[] (newest first) */

export const NO_PIN_TAP_LIMIT = 200
export const MAX_TRANSACTION = 10_000

// ---------- business: agents ----------

/** POST /v1/agent/cash-in: agent's float → customer's wallet. Agent's own PIN. */
export interface CashInBody { customerMsisdn: string; amount: number; pin: string }
/** POST /v1/agent/cash-out → Message: posts a cashout request into the agent↔customer chat for the customer to approve with their PIN. */
export interface CashOutBody { customerMsisdn: string; amount: number }
/** POST /v1/agent/register: agent registers a new customer wallet (KYC tier 1). → PublicUser */
export interface RegisterCustomerBody { msisdn: string; name: string; pin: string }
/** GET /v1/agent/summary → AgentSummary (today = Africa/Maseru calendar day) */
export interface AgentSummary {
  float: number
  cashInToday: { count: number; total: number }
  cashOutToday: { count: number; total: number }
  commissionToday: number
  recent: Transaction[]
}

// ---------- business: merchants ----------

/** POST /v1/merchant/charge → Message: posts a merchant request to the customer. */
export interface ChargeBody { customerMsisdn: string; amount: number; note?: string }
/** GET /v1/merchant/summary → MerchantSummary (today, Africa/Maseru) */
export interface MerchantSummary {
  salesToday: { count: number; total: number }
  pending: Message[] // open merchant requests
  recent: Transaction[]
}

/**
 * GET /v1/business/profile → BusinessProfile: the agent's or merchant's own account and its listing on the Places
 * map. PUT /v1/business/profile (BusinessListingBody) → BusinessProfile adds or edits that listing. The business
 * name, code and owner are set by EcoCash staff (KYC), so they are read-only here.
 */
export interface BusinessProfile {
  name: string
  /** The account holder (person) EcoCash registered the business to. */
  holder: string
  role: 'agent' | 'merchant'
  code: string | null
  msisdn: string
  kycTier: 1 | 2
  status: 'active' | 'suspended'
  openedAt: string
  /** People who linked this business in EcoCash Super App (Business mini app). */
  linkedPeople: number
  /** On the map (Places) so customers can find it; null when it isn't listed yet. */
  listing: Place | null
}
/** A new listing needs the location (the phone's, taken at the shop); an edit keeps it unless sent. */
export interface BusinessListingBody { address: string; hours?: string; phone?: string; lat?: number; lng?: number; listed: boolean }

// ---------- receive money: QR, code or tap (merchant terminal) ----------

/**
 * A payment a business terminal is waiting for. Created on "Receive money" (merchant, purpose sale) or "Cash out"
 * (agent, purpose cashout); the customer pays it by scanning its QR (`moqoqo://pay?i=<id>`), typing its 6-digit
 * `code` or the business's own code (AGENT-0101), tapping an NFC card/sticker, or showing their payment code.
 * Open intents expire after INTENT_TTL_MINUTES.
 */
export interface PaymentIntent {
  id: string
  code: string // 6 digits, unique among open intents
  /** sale: pay a merchant. cashout: e-money to the agent, who hands over the same amount in cash. */
  purpose: 'sale' | 'cashout'
  /** The business being paid: a merchant, or the agent for a cash-out. */
  merchant: PublicUser & { code: string }
  amount: number
  note?: string
  status: 'open' | 'paid' | 'cancelled' | 'expired'
  createdAt: string
  expiresAt: string
  paidBy?: PublicUser
  /** paycode: the terminal scanned the customer's payment code. */
  method?: 'qr' | 'code' | 'tap' | 'paycode'
  transaction?: Transaction // from the merchant's side, once paid
}
export const INTENT_TTL_MINUTES = 10

/** POST /v1/merchant/intents (merchant) → PaymentIntent (purpose sale) */
export interface CreateIntentBody { amount: number; note?: string }
/** POST /v1/agent/cashouts (agent) → PaymentIntent (purpose cashout). Body: CreateIntentBody. */
/** GET /v1/merchant/intents/:id (merchant or agent, own intents) → PaymentIntent */
/** POST /v1/merchant/intents/:id/cancel (merchant or agent) → PaymentIntent */
/**
 * POST /v1/merchant/intents/:id/tap (merchant or agent): the terminal read a customer's NFC card/sticker.
 * PIN (typed by the customer on the terminal) required above NO_PIN_TAP_LIMIT, and always for a cash-out.
 * → PaymentIntent (paid). Unknown/unlinked card → 404 NOT_REGISTERED.
 */
export interface TapIntentBody { tagId: string; pin?: string }

/**
 * GET /v1/intents/lookup?id=… | ?code=123456 | ?business=AGENT-0101 (customer, before paying) → PaymentIntent
 * (open only; `business` = that agent's or merchant's newest open request; else 404 NOT_FOUND)
 */
/** POST /v1/intents/:id/pay (customer, QR or code; PIN always) → MoneyResult */
export interface PayIntentBody { pin: string; method: 'qr' | 'code' }

/**
 * Static merchant QR (`moqoqo://pay?m=<merchantCode>`, printed sticker): the customer types the amount.
 * POST /v1/payments/merchant → MoneyResult (PIN always). GET /v1/merchants/:code → PublicUser & { code } before paying.
 */
export interface PayMerchantBody { merchantCode: string; amount: number; pin: string; note?: string }

// ---------- pay merchant: the customer's payment code (Quick Pay) ----------

/**
 * One-time payment code the customer shows (barcode + QR) for the merchant's terminal to scan: PAYCODE_DIGITS
 * digits starting "62". Single use and valid PAYCODE_TTL_SECONDS; the app fetches a fresh one every
 * PAYCODE_REFRESH_SECONDS and after each payment, so a screenshot of an old code is worthless.
 * The app blocks screenshots of it and asks for the PIN (or biometrics) before showing it.
 */
export interface PayCode { code: string; expiresAt: string }
export const PAYCODE_DIGITS = 18
export const PAYCODE_TTL_SECONDS = 120
export const PAYCODE_REFRESH_SECONDS = 60

/** POST /v1/paycode/enable: turn on Quick Pay (accepts the Payment User Service Agreement). PIN always. → Me */
export interface EnableQuickPayBody { pin: string }
/** POST /v1/paycode/disable: turn off Quick Pay; unused codes stop working. → Me */
/** POST /v1/paycode → PayCode (403 FORBIDDEN while Quick Pay is off) */
/**
 * POST /v1/merchant/intents/:id/paycode (merchant): the terminal scanned or typed a customer's payment code.
 * PIN (typed by the customer on the terminal) required above NO_PIN_TAP_LIMIT, and always for a cash-out.
 * → PaymentIntent (paid). Unknown, used or expired code → 404 NOT_FOUND. The customer also gets intent.updated.
 */
export interface PayCodeIntentBody { code: string; pin?: string }

// ---------- receive money: a person's own QR ----------

/**
 * Personal "Receive money" QR (`moqoqo://pay?u=<userId>[&a=<amount>]`): anyone with EcoCash Super App can scan it and pay,
 * without a chat first. Safe to share and save as an image: it can only receive.
 * GET /v1/payees/:userId → Payee (number masked).
 */
export interface Payee { id: string; name: string; maskedMsisdn: string }
/** POST /v1/payments/person → MoneyResult: posts the money message into the direct chat (created if needed). PIN always. */
export interface PayPersonBody { toUserId: string; amount: number; pin: string; note?: string; clientId: string }

/** A customer's NFC card/sticker linked to their wallet (tag UID as uppercase hex). */
export interface NfcTag { id: string; tagId: string; label: string; createdAt: string }
/** GET /v1/me/tags → NfcTag[] · POST /v1/me/tags { tagId, label } → NfcTag · DELETE /v1/me/tags/:id → 204 */
export interface AddTagBody { tagId: string; label: string }

// ---------- money in and out: card to wallet, wallet to bank ----------
//
// Core wallet features (not mini apps). Until real integrations exist, a mock card gateway and a mock bank interface
// live in server/src/gateways (like the EcoCash mock). Card data: the app sends number/expiry/CVV once over HTTPS to
// POST /v1/cards; the server passes them to the gateway and stores ONLY the gateway token, brand, last 4 digits and
// expiry. Full card numbers and CVVs are never stored or logged. (With a real gateway, card entry moves to the
// gateway's hosted page/fields so card data never touches EcoCash Super App's server.)

/**
 * Fees and limits (admin-editable; placeholders until the real tariff is known).
 * Card top-up: the card is charged amount + fee; the wallet receives amount.
 * Bank transfer: the wallet pays amount + fee; the bank account receives amount.
 */
export interface Tariff {
  cardTopupFeePercent: number // e.g. 2 → 2% of the amount
  cardTopupFeeMin: number // M, minimum fee
  cardTopupMax: number // M per top-up
  bankTransferFee: number // M flat per transfer
  bankTransferMax: number // M per transfer
  dailyMax: number // M per day, top-ups and bank transfers counted separately
  atmFee: number // M flat per cardless ATM withdrawal
  atmMax: number // M per ATM withdrawal (multiples of ATM_NOTE)
}
/** GET /v1/tariff → Tariff. GET /admin/v1/tariff → Tariff. PUT /admin/v1/tariff (admin) Tariff → Tariff. */

/** fee for an amount under the tariff, in M with 2 decimals; the server is the authority, the app shows the same sum. */
export const cardTopupFee = (t: Tariff, amount: number) =>
  Math.max(t.cardTopupFeeMin, Math.round(amount * t.cardTopupFeePercent) / 100)

export type CardBrand = 'visa' | 'mastercard'
export interface Card {
  id: string
  brand: CardBrand
  last4: string
  expMonth: number
  expYear: number // 4 digits
  holderName: string
  createdAt: string
}
/** GET /v1/cards → Card[] (mine, newest first). DELETE /v1/cards/:id → 204. */
/**
 * POST /v1/cards → Card: check and save a card (Luhn, not expired, Visa/Mastercard). Declined by the gateway →
 * 422 CARD_DECLINED. Mock test cards: any Luhn-valid Visa/Mastercard number works; 4000 0000 0000 0002 is declined;
 * 4000 0000 0000 9995 has insufficient funds (declined at charge time).
 */
export interface AddCardBody { number: string; expMonth: number; expYear: number; cvv: string; holderName: string }

export type TopupStatus = 'pending_otp' | 'completed' | 'failed' | 'expired'
export interface Topup {
  id: string
  reference: string // TU-000001
  card: Pick<Card, 'id' | 'brand' | 'last4'>
  amount: number // credited to the wallet
  fee: number
  charged: number // amount + fee, charged to the card
  status: TopupStatus
  failureReason?: string
  createdAt: string
}
/**
 * POST /v1/topups { cardId, amount, pin, clientId } → TopupStart: PIN checked, gateway starts the charge and asks
 * for the card holder's one-time code (3-D Secure). Mock code: 123456. Pending top-ups expire after 10 minutes.
 * POST /v1/topups/:id/confirm { otp } → TopupResult: wrong code → 400 VALIDATION (3 tries, then failed);
 * card declined / insufficient funds at charge → 422 CARD_DECLINED and status failed.
 */
export interface TopupBody { cardId: string; amount: number; pin: string; clientId: string }
export interface TopupStart { topup: Topup; otpHint: string }
export interface TopupConfirmBody { otp: string }
export interface TopupResult { topup: Topup; money: MoneyResult }

export interface Bank { code: string; name: string; accountLength: number }
/** GET /v1/banks → Bank[]: SLB Standard Lesotho Bank, FNB FNB Lesotho, NED Nedbank Lesotho, LPB Lesotho PostBank. */
/**
 * GET /v1/banks/lookup?bank=SLB&account=… → BankAccountName: the bank's account holder name (mock: derived from the
 * number; numbers ending 0000 don't exist → 404 NOT_FOUND).
 */
export interface BankAccountName { bankCode: string; accountNumber: string; accountName: string }

/** A saved bank account (beneficiary). GET /v1/bank-accounts → BankAccount[]; DELETE /v1/bank-accounts/:id → 204. */
export interface BankAccount { id: string; bankCode: string; bankName: string; accountNumber: string; accountName: string; createdAt: string }

export type BankTransferStatus = 'submitted' | 'completed' | 'failed'
export interface BankTransfer {
  id: string
  reference: string // BT-000001
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  amount: number // to the bank account
  fee: number
  total: number // amount + fee, from the wallet
  status: BankTransferStatus
  createdAt: string
}
/**
 * POST /v1/bank-transfers → BankTransferResult. Name checked again server-side; wallet debited amount + fee in one
 * DB transaction (ledger rows kind withdraw + fee). `save` keeps the account as a beneficiary. PIN always.
 * Mock bank completes at once ("arrives within 1 working day [TBC]").
 */
export interface BankTransferBody { bankCode: string; accountNumber: string; amount: number; pin: string; clientId: string; save?: boolean }
export interface BankTransferResult { transfer: BankTransfer; money: MoneyResult; account?: BankAccount }

// ---------- remittance: send money abroad ----------
//
// Wallet to another country (South Africa, Eswatini, …) through a remittance partner. Until the partner is chosen and
// integrated, a mock gateway lives in server/src/gateways/remit.ts. Countries ("corridors"), exchange rates, fees and
// limits are set in the portal (App settings › Remittance); the starting values are PLACEHOLDERS.

/** How the recipient gets the money: into a mobile wallet, into a bank account, or as cash at a partner agent. */
export type RemitPayout = 'mobile' | 'bank' | 'cash'
export const REMIT_PAYOUTS: RemitPayout[] = ['mobile', 'bank', 'cash']

export interface RemitCorridor {
  code: string // ISO 3166 country code: ZA, SZ, BW …
  country: string // South Africa
  currency: string // ISO 4217: ZAR
  rate: number // units of `currency` the recipient gets per M1
  fee: number // M flat per transfer
  feePercent: number // plus this percent of the amount
  max: number // M per transfer
  payouts: RemitPayout[]
  enabled: boolean
}
/** GET /admin/v1/remit → RemitSettings · PUT /admin/v1/remit RemitSettings → RemitSettings (admin). */
export interface RemitSettings {
  corridors: RemitCorridor[]
  dailyMax: number // M per wallet per day, all remittances together
}
/** GET /v1/remit → RemitSettings with only the enabled corridors. */

/** The fee for an amount (M, 2 decimals). The server is the authority; the app shows the same sum. */
export const remitFee = (c: Pick<RemitCorridor, 'fee' | 'feePercent'>, amount: number) =>
  Math.round(c.fee * 100 + amount * c.feePercent) / 100
/** What the recipient gets in the corridor's currency (2 decimals, rounded down). */
export const remitReceive = (c: Pick<RemitCorridor, 'rate'>, amount: number) => Math.floor(Math.round(amount * c.rate * 10000) / 100) / 100

export type RemittanceStatus = 'submitted' | 'completed' | 'failed'
export interface Remittance {
  id: string
  reference: string // RM-000001
  country: string // ZA
  countryName: string
  currency: string
  payout: RemitPayout
  recipientName: string
  recipientPhone: string | null // mobile and cash pick-up
  bankName: string | null // bank payout
  accountNumber: string | null // bank payout
  amount: number // M sent
  fee: number // M
  total: number // amount + fee, from the wallet
  rate: number // at the time of sending
  receiveAmount: number // in `currency`
  status: RemittanceStatus
  /** Cash pick-up: the code the recipient shows at the partner agent, with their ID. */
  pickupCode: string | null
  createdAt: string
}
/** GET /v1/remittances → Remittance[] (mine, newest first, last 20). GET /admin/v1/remittances → AdminRemittance[] (last 100). */
export interface AdminRemittance extends Remittance { sender: { id: string; name: string; msisdn: string | null } }

/**
 * POST /v1/remittances → RemittanceResult. PIN always. The wallet pays amount + fee in one DB transaction (ledger rows
 * kind withdraw + fee, so tier-1 KYC limits for "bank" and the risk rules apply). Mobile and cash need
 * recipientPhone; bank needs bankName and accountNumber.
 */
export interface RemittanceBody {
  country: string
  payout: RemitPayout
  recipientName: string
  recipientPhone?: string
  bankName?: string
  accountNumber?: string
  amount: number
  pin: string
  clientId: string
}
export interface RemittanceResult { remittance: Remittance; money: MoneyResult }

// ---------- Society (Mekhatlo): group wallets for societies, stokvels and burial societies ----------
//
// A society has its own wallet, members and signatories (executives). Signatories add and remove members and pay
// out of the society wallet; a payout moves only once enough signatories approve it (approvalsRequired, the
// requester counting as one). Every member can pay into the society and see its recent transactions. Societies and
// their first signatories are set up in the portal. Motšelo and burial societies are kinds of society, not separate apps.

/** signatory: an executive who can manage members and approve payouts. */
export type SocietyRole = 'member' | 'signatory'
export type SocietyTransferStatus = 'pending' | 'paid' | 'rejected' | 'expired'
/** motselo: members pay a fixed amount each month; burial: a burial society; society: anything else. */
export type SocietyKind = 'society' | 'motselo' | 'burial'
/** Hours signatories have to approve a payout before it expires. PLACEHOLDER until ETL confirms. */
export const SOCIETY_APPROVAL_HOURS = 72

export interface SocietySummary {
  id: string
  /** Short number people know it by, e.g. 7745. */
  code: string
  name: string
  kind: SocietyKind
  /** What each member pays a month (Maseru calendar month), when the society sets one, e.g. a Motšelo. */
  contribution?: number
  balance: number
  myRole: SocietyRole
  memberCount: number
  /** Payouts waiting for my approval (signatories only). */
  awaitingMe: number
}
export interface SocietyMember {
  user: PublicUser
  role: SocietyRole
  addedAt: string
  /** With a monthly contribution: has paid at least that much this month. */
  paidThisMonth?: boolean
}
export interface SocietyTransfer {
  id: string
  reference: string // SOC-000001
  to: PublicUser
  amount: number
  note?: string
  status: SocietyTransferStatus
  requestedBy: PublicUser
  approvals: { user: PublicUser; at: string }[]
  rejectedBy?: PublicUser
  approvalsRequired: number
  createdAt: string
  expiresAt: string
  /** Signatories only: I can still approve or reject it. */
  canDecide?: boolean
}
/** GET /v1/societies → SocietySummary[]; GET /v1/societies/:id → SocietyDetail (members only). */
export interface SocietyDetail extends SocietySummary {
  approvalsRequired: number
  members: SocietyMember[]
  /** Pending first, then the latest decided. */
  transfers: SocietyTransfer[]
  /** Money in and out of the society wallet, newest first (amount > 0 = in). */
  recent: { id: string; reference: string; amount: number; label: string; who: string; at: string }[]
}
/** POST /v1/societies/:id/members (signatory) → SocietyDetail. `to` is a wallet number or @username. */
export interface AddSocietyMemberBody { to: string; role?: SocietyRole }
/** POST /v1/societies/:id/remind (signatory, monthly contribution only) → { reminded: number }: notifies members who haven’t paid this month. */
/** DELETE /v1/societies/:id/members/:userId (signatory) → SocietyDetail. Signatories never drop below approvalsRequired. */
/** POST /v1/societies/:id/contributions → MoneyResult. Any member pays into the society, PIN always. */
export interface SocietyContributionBody { amount: number; pin: string; note?: string }
/** POST /v1/societies/:id/transfers (signatory) → SocietyTransfer. Pays out of the society once approved. */
export interface SocietyTransferBody { to: string; amount: number; note?: string; pin: string; clientId: string }
/** POST /v1/society-transfers/:id/approve | /reject (signatory, PIN) → SocietyTransfer. One rejection stops it. */
export interface SocietyDecisionBody { pin: string }

// Loans from the society: the executives set the society's own terms (interest a month, longest loan, largest loan).
// A member asks; the other executives approve (the borrower never approves their own loan) and the money moves from
// the society to the borrower. Interest is simple: amount × rate × months, all due on the due date. The borrower
// repays in parts or at once into the society; EcoCash reminds them before the due date and while it is overdue.

export interface SocietyLoanSettings {
  enabled: boolean
  /** Simple interest per month, in percent (e.g. 10 = 10% a month). 0 = no interest. */
  interestPercent: number
  /** Longest loan, in months (1 to 24). */
  maxMonths: number
  /** Largest loan; none = up to what the society has. */
  maxAmount?: number
}
/** pending → active (paid out) → repaid; or rejected / expired (not approved in time). Overdue is active past dueAt. */
export type SocietyLoanStatus = 'pending' | 'active' | 'repaid' | 'rejected' | 'expired'
export interface SocietyLoan {
  id: string
  reference: string // LN-000001
  borrower: PublicUser
  amount: number
  months: number
  interestPercent: number
  /** amount + interest. */
  total: number
  repaid: number
  /** total − repaid. */
  outstanding: number
  purpose?: string
  status: SocietyLoanStatus
  overdue: boolean
  approvals: { user: PublicUser; at: string }[]
  approvalsRequired: number
  rejectedBy?: PublicUser
  createdAt: string
  /** pending only: when it expires unapproved. */
  expiresAt?: string
  paidOutAt?: string
  dueAt?: string
  repaidAt?: string
  /** Executives (not the borrower): I can still approve or reject it. */
  canDecide?: boolean
  repayments: { amount: number; at: string }[]
}
export interface SocietyLoanReport {
  /** Active loans: what is still owed to the society, and how much of it is late. */
  outstanding: number
  overdue: number
  overdueCount: number
  activeCount: number
  /** All loans ever paid out, and the interest they carry (earned once repaid). */
  lentTotal: number
  interestTotal: number
  repaidTotal: number
}
/**
 * GET /v1/societies/:id/loans → SocietyLoans. Executives see every loan and the report; members see their own.
 * PUT /v1/societies/:id/loan-settings SocietyLoanSettings (executive) → SocietyLoans. The other executives are told.
 * POST /v1/societies/:id/loans SocietyLoanBody → SocietyLoan (any member, PIN).
 * POST /v1/society-loans/:id/approve | /reject SocietyDecisionBody (executive, not the borrower) → SocietyLoan.
 * POST /v1/society-loans/:id/repay SocietyRepayBody (the borrower) → MoneyResult.
 */
export interface SocietyLoans {
  settings: SocietyLoanSettings
  /** A change to the terms waiting for the other executives (executives only). */
  pendingTerms?: SocietyLoanTermChange
  loans: SocietyLoan[]
  report?: SocietyLoanReport
}
/**
 * Loan terms change in two steps: an executive proposes (PUT /v1/societies/:id/loan-settings), and the others approve
 * or reject (POST /v1/society-loan-terms/:id/approve | /reject, PIN). The proposer counts as one approval, as with
 * payments; with one approval needed the change applies at once. One proposal waits at a time.
 */
export interface SocietyLoanTermChange {
  id: string
  settings: SocietyLoanSettings
  proposedBy: PublicUser
  approvals: PublicUser[]
  approvalsRequired: number
  createdAt: string
  expiresAt: string
  /** I can still approve or reject it. */
  canDecide: boolean
}
export interface SocietyLoanBody { amount: number; months: number; purpose?: string; pin: string; clientId: string }
export interface SocietyRepayBody { amount: number; pin: string }
/** Pending loans expire after this many hours unapproved (as payouts do). PLACEHOLDER until ETL confirms. */
export const SOCIETY_LOAN_APPROVAL_HOURS = 72
/** Simple interest on a society loan, to the cent. */
export const loanTotal = (amount: number, interestPercent: number, months: number) =>
  Math.round(amount * 100 * (1 + (interestPercent / 100) * months)) / 100

/** Portal: GET/POST /admin/v1/societies, GET /admin/v1/societies/:id → SocietyDetail (myRole = 'signatory'). */
export interface AdminSociety { id: string; code: string; name: string; kind: SocietyKind; contribution?: number; balance: number; memberCount: number; signatories: number; approvalsRequired: number; createdAt: string }
/** signatories: wallet numbers; at least approvalsRequired of them. code: 4 digits, generated when absent. */
export interface CreateSocietyBody { name: string; code?: string; kind?: SocietyKind; contribution?: number; signatories: string[]; approvalsRequired: number }

// Applying for a new society: a member applies in the app and becomes its first executive. ETL approves or rejects
// it in the portal. Approved, the executives collect a Mokhatlo merchant SIM at an Econet shop; when staff record
// the SIM in the portal, the society opens with the SIM's number as its wallet.

/** pending → approved (collect the SIM) → active; or rejected (with a reason) / cancelled by the applicant. */
export type SocietyApplicationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'active'
export interface SocietyApplication {
  id: string
  reference: string // MKH-000001
  name: string
  kind: SocietyKind
  contribution?: number
  approvalsRequired: number
  applicant: PublicUser
  /** The applicant first. */
  executives: PublicUser[]
  status: SocietyApplicationStatus
  /** Why it was rejected; the applicant sees it. */
  reason?: string
  /** Once collected: the Mokhatlo SIM's number, which is the society's wallet. */
  simNumber?: string
  /** Once active. */
  societyId?: string
  societyCode?: string
  createdAt: string
  decidedAt?: string
}
/** POST /v1/society-applications → SocietyApplication. executives: the other executives' numbers or @usernames. */
export interface SocietyApplyBody { name: string; kind: SocietyKind; contribution?: number; approvalsRequired: number; executives: string[] }
// GET /v1/society-applications → SocietyApplication[] (mine, newest first)
// POST /v1/society-applications/:id/cancel → SocietyApplication (pending only)
// Portal: GET /admin/v1/society-applications → SocietyApplication[] (open ones first)
//   POST /admin/v1/society-applications/:id/approve → SocietyApplication
//   POST /admin/v1/society-applications/:id/reject { reason } → SocietyApplication
//   POST /admin/v1/society-applications/:id/activate SocietySimBody → SocietyApplication (approved only)
export interface SocietySimBody { simNumber: string; code?: string }

/** GET /v1/society-apply-settings; GET/PUT /admin/v1/society-apply-settings. PLACEHOLDER values until ETL confirms. */
export interface SocietyApplySettings {
  /** Off: the app hides "Register a society". */
  enabled: boolean
  /** Most applications one person may have pending or approved at once. */
  maxOpen: number
  /** Shown to the applicant once approved: where to collect the SIM and what to bring. */
  collectInstructions: string
}

// ---------- Donate: causes people give to ----------
//
// Anyone creates a cause (title, story, target), shares its link (moqoqo://donate/CODE) or posts it in a chat, and
// people give from their wallets. The money sits in the cause's own wallet until the organiser withdraws it to theirs.
// The organiser can close the cause; staff can suspend it in the portal (no giving or withdrawing while suspended).

export type CauseStatus = 'open' | 'closed' | 'suspended'
/** What a chat card and a list row show. */
export interface CauseCard {
  id: string
  /** 6 letters and digits: in the link, and typed in Donate › Open a cause. */
  code: string
  title: string
  target: number
  raised: number
  donorCount: number
  status: CauseStatus
}
export interface Cause extends CauseCard {
  description: string
  organiser: PublicUser
  createdAt: string
  endsAt?: string
  /** Suspended or closed: why (the portal's reason, or "closed by the organiser"). */
  statusReason?: string
  /** I organise it: money still in the cause, and what I can do. */
  mine: boolean
  balance?: number
  /** What I gave in total. */
  myTotal: number
  /** Newest first; anonymous gifts show no name. */
  donations: { name: string | null; amount: number; note?: string; at: string }[]
}
/** GET /v1/causes → my causes and the ones I gave to (newest first). GET /v1/causes/:code → Cause (any signed-in user). */
export interface MyCauses { mine: CauseCard[]; supported: CauseCard[] }
/** POST /v1/causes → Cause. */
export interface CreateCauseBody { title: string; description: string; target: number; endsAt?: string }
/** POST /v1/causes/:id/donate → MoneyResult (PIN). */
export interface DonateBody { amount: number; note?: string; anonymous?: boolean; pin: string; clientId: string }
/** POST /v1/causes/:id/withdraw (organiser, PIN) → MoneyResult: from the cause's wallet to the organiser's. */
export interface CauseWithdrawBody { amount: number; pin: string }
/** POST /v1/causes/:id/close (organiser) → Cause. POST /v1/causes/:id/share { chatId } → Message (a cause card). */
export interface ShareCauseBody { chatId: string }
/** GET/PUT /admin/v1/donate-settings. PLACEHOLDER values until ETL confirms. */
export interface DonateSettings {
  enabled: boolean
  /** KYC tier needed to start a cause (anyone may give). */
  minKycTier: 1 | 2
  maxTarget: number
  /** Open causes one person may run at once. */
  maxOpenPerUser: number
}
/** Portal: GET /admin/v1/causes → AdminCause[]; POST /admin/v1/causes/:id/suspend { reason } | /reopen. */
export interface AdminCause extends CauseCard { organiser: PublicUser; balance: number; createdAt: string; statusReason?: string }

// ---------- EcoSure: insurance mini app (funeral cover, short-term quotes) ----------
//
// EcoSure (SEFS, underwritten by LNIG Hollard) runs inside EcoCash Super App as a mini app: the EcoCash Super App session is the customer's
// identity, the EcoCash Super App PIN confirms money and claims, and premiums are paid from the EcoCash wallet into the EcoSure
// system wallet. Until the real EcoSure API exists, policies, claims, quotes and sponsorships live in this server behind
// server/src/ecosure (like the EcoCash mock). Customer updates arrive as messages in the official "EcoSure" chat.
// Funeral prices, cover amounts, waiting periods and beneficiary rules come from EcoSure's policy manager package
// list (server/src/ecosure/sync.ts, ECOSURE_PACKAGES_URL); dependant limits are TBC (ECOSURE_DEPENDANT_LIMIT null =
// no limit enforced).

export type EsLine = 'funeral' | 'short_term'
export type EsCategory = 'funeral' | 'motor_vehicle' | 'device' | 'house_contents' | 'house_owners' | 'sme'
export type EsCover = 'family' | 'single'
export type EsFieldType = 'text' | 'number' | 'yes_no' | 'choice' | 'document'

export interface EsProduct {
  code: string // FUN-STD, ST-MOTOR …
  name: string
  line: EsLine
  category: EsCategory
  /** fixed: price from `options`. quoted: staff price each quote. */
  pricing: 'fixed' | 'quoted'
  underwriter: string
  /** Funeral options carry `cover`; SME options are business sizes. */
  options: EsOption[]
  /** Funeral: the monthly price of each extended family member (EcoSure's Extended package), when offered. */
  extendedMember?: { monthlyPremium: number; sumAssured: number }
  /** Set in the portal: a line under the package name, and the package the app picks first. */
  tagline?: LocalizedText
  popular?: boolean
  quoteFields: { label: string; type: EsFieldType; required: boolean; choices: string[] }[]
  claimDocuments: string[]
}
export interface EsOption {
  label: string
  cover?: EsCover
  monthlyPremium: number
  /** From EcoSure's package list (funeral): what it pays out, months before cover starts, beneficiary required. */
  sumAssured?: number
  waitingMonths?: number
  beneficiaryRequired?: boolean
}
/** GET /v1/ecosure/products → EsProduct[]: the live catalogue, funeral first, each line cheapest first. */
/** GET /v1/ecosure/content → EsContent: the EcoSure texts set in the portal. */
export interface EsContent {
  terms: LocalizedText
  /** The EcoSure call centre number, or null until it is set. */
  callCentre: string | null
}
/**
 * Portal › EcoSure › Catalogue. GET /admin/v1/ecosure/catalogue → AdminEsCatalogue. Prices and cover terms come from
 * EcoSure's package list (read only here); PATCH /admin/v1/ecosure/products/:code {tagline?, popular?} and
 * PUT /admin/v1/ecosure/content EsContent change the words.
 */
export interface AdminEsProduct extends EsProduct {
  status: 'active' | 'draft' | 'retired'
  /** EcoSure package group this funeral package follows (STANDARD …); null for products EcoSure doesn't list. */
  ecosureGroup: string | null
  /** EcoSure package ids behind it: single, family, extended. */
  packageIds: string[]
}
export interface AdminEsCatalogue {
  products: AdminEsProduct[]
  content: EsContent
  /** The last sync with EcoSure's package list; null if it never ran (no ECOSURE_PACKAGES_URL). */
  sync: { at: string; ok: boolean; packages: number; updated: number; skipped: string[]; error?: string } | null
}
export interface EsProductTextBody { tagline?: LocalizedText | null; popular?: boolean }
export const ECOSURE_DEPENDANT_LIMIT: number | null = null

export type EsRelationship = 'main' | 'spouse' | 'child' | 'parent' | 'extended'
export interface EsMember { id: string; name: string; relationship: EsRelationship; dob?: string }

/** Derived from `nextDue`: active until it, grace for ECOSURE_GRACE_DAYS after, then lapsed. */
export type EsPolicyStatus = 'active' | 'grace' | 'lapsed' | 'cancelled'
export const ECOSURE_GRACE_DAYS = 30

export interface EsPolicy {
  id: string
  number: string // ES-000101
  productCode: string
  packageName: string // EcoSure Standard
  cover: EsCover
  premium: number // per month
  status: EsPolicyStatus
  nextDue: string // YYYY-MM-DD: paid up to here
  holder: { name: string; idNumber: string; dob: string; gender: 'female' | 'male'; msisdn: string }
  beneficiary?: { name: string; msisdn?: string }
  /** The main member first. */
  members: EsMember[]
  /** Someone else pays this policy's premiums (accepted sponsorship). */
  sponsoredBy?: { name: string }
  createdAt: string
}
/** GET /v1/ecosure/policies → EsPolicy[] (mine, newest first) */

/**
 * POST /v1/ecosure/policies: buy funeral cover. The first month is paid from the wallet in the same DB transaction
 * that creates the policy, so there is never a policy without payment or a payment without a policy. PIN always.
 * → EsBuyResult. Dates YYYY-MM-DD. One policy per holder per product line is enough for now: a second funeral policy → CONFLICT.
 */
export interface EsBuyBody {
  productCode: string
  cover: EsCover
  idNumber: string
  fullName: string
  dob: string
  gender: 'female' | 'male'
  beneficiaryName?: string
  beneficiaryMsisdn?: string
  acceptedTerms: boolean // must be true
  pin: string
}
export interface EsBuyResult { policy: EsPolicy; payment: EsPayment; money: MoneyResult }

/** PATCH /v1/ecosure/policies/:id → EsPolicy: change package (same cover type) and/or beneficiary. New premium from the next payment. */
export interface EsUpdatePolicyBody { productCode?: string; beneficiaryName?: string; beneficiaryMsisdn?: string }
/**
 * POST /v1/ecosure/policies/:id/migrate → EsPolicy: Family ↔ Single on the same package. Going to Single removes the
 * dependants from cover (the app warns first). Waiting-period rules are TBC with the underwriter.
 */
export interface EsMigrateBody { cover: EsCover }
/** POST /v1/ecosure/policies/:id/members → EsPolicy (family cover only). DELETE /v1/ecosure/policies/:id/members/:memberId → EsPolicy. */
export interface EsAddMemberBody { name: string; relationship: Exclude<EsRelationship, 'main'>; dob?: string }

export interface EsPayment {
  id: string
  receipt: string // RC-000001
  policyNumber: string
  holderFirstName: string
  amount: number
  months: number
  payerName: string
  createdAt: string
}
/**
 * GET /v1/ecosure/policies/lookup?ref=ES-000101 | 26662000021 | +26662000021 → EsPolicyLookup.
 * For paying someone else's premium: only the holder's first name is shown (privacy rule TBC with Legal).
 */
export interface EsPolicyLookup { number: string; holderFirstName: string; packageName: string; cover: EsCover; premium: number; nextDue: string; status: EsPolicyStatus }
/** POST /v1/ecosure/payments → { payment, money }: premium from the wallet; moves nextDue on by `months`. PIN always. */
export interface EsPayBody { policyNumber: string; months?: number; pin: string }
export interface EsPayResult { payment: EsPayment; money: MoneyResult }
/** GET /v1/ecosure/payments → EsPayment[]: paid by me or for my policies, newest first. */

/** POST /v1/ecosure/uploads → EsUpload. One document (photo or PDF) as base64, up to 10 MB. Unused uploads are deleted after 24 h. */
export interface EsUploadBody { fileName: string; contentType: 'image/jpeg' | 'image/png' | 'application/pdf'; base64: string }
export interface EsUpload { id: string; fileName: string; size: number }

export type EsClaimStatus = 'submitted' | 'documents_verified' | 'under_assessment' | 'approved' | 'rejected'
/**
 * Funeral claims. Documents: every product claim document without a cause in brackets, plus the one for the cause of
 * death ("Medical certificate (natural cause)" etc.). Approval pays `payout` into the policy holder's wallet.
 */
export type EsCauseOfDeath = 'natural' | 'unnatural' | 'undetermined'
export interface EsClaim {
  id: string
  reference: string // CLM-2026-00001
  policyNumber: string
  member: { id: string; name: string; relationship: EsRelationship }
  dateOfDeath: string
  cause: EsCauseOfDeath
  status: EsClaimStatus
  documents: { label: string; fileName: string }[]
  payout?: number
  reason?: string // rejection reason or a request for information
  /** Submitted → Documents verified → Under assessment → Decision and payout. */
  steps: { label: string; at?: string; done: boolean }[]
  createdAt: string
  updatedAt: string
}
/** POST /v1/ecosure/claims → EsClaim. PIN always (confirms it's the holder). */
export interface EsClaimBody {
  policyId: string
  memberId: string
  dateOfDeath: string
  cause: EsCauseOfDeath
  documents: { label: string; uploadId: string }[]
  pin: string
}
/** GET /v1/ecosure/claims → EsClaim[] (on my policies, newest first) */

/**
 * POST /v1/ecosure/quotes → EsQuote. Fixed-price products are priced at once (status priced, valid ECOSURE_QUOTE_VALID_DAYS);
 * quoted products wait for staff (status submitted) and need a contact name and number. Required documents must be uploaded first.
 */
export interface EsQuoteBody {
  productCode: string
  option?: string
  answers: Record<string, string>
  documents: Record<string, string> // document label → upload id
  contactName?: string
  msisdn?: string
  consent: boolean
}
export const ECOSURE_QUOTE_VALID_DAYS = 30
export interface EsQuote {
  reference: string // Q-2026-000001
  productCode: string
  productName: string
  option?: string
  status: 'submitted' | 'priced' | 'accepted' | 'expired' | 'declined'
  monthlyPremium?: number
  expiresAt?: string
  documents: { label: string; fileName: string }[]
  createdAt: string
}
/** GET /v1/ecosure/quotes → EsQuote[] (mine) */

/**
 * Sponsorship: pay for a family member's EcoSure cover. The sponsor names their number; they must already have an
 * EcoSure policy and accept in their EcoSure mini app (they get a message in the EcoSure chat). Rules TBC with SEFS.
 */
export interface EsSponsorship {
  id: string
  status: 'awaiting' | 'active' | 'declined' | 'cancelled'
  sponsor: { name: string }
  member: { name: string; msisdn: string }
  policy: EsPolicyLookup
  createdAt: string
}
/** GET /v1/ecosure/sponsorships → { mine: I sponsor; forMe: someone sponsors me (incl. requests to accept) } */
export interface EsSponsorships { mine: EsSponsorship[]; forMe: EsSponsorship[] }
/** POST /v1/ecosure/sponsorships { msisdn } → EsSponsorship. POST …/:id/accept | /decline (the member), /cancel (either side). */
export interface EsSponsorBody { msisdn: string }

// EcoSure back office (portal, /admin/v1/ecosure):
// GET  /policies?query=&status=&page=&pageSize=  → Page<EsPolicy>
// GET  /claims?status=&page=&pageSize=           → Page<EsClaim & { holder: PublicUser }>
// GET  /claims/:id/documents/:index              → the file (Content-Type as uploaded)
// POST /claims/:id/decision                      → EsClaim  (EsClaimDecisionBody; approve pays out, posts to the EcoSure chat)
// GET  /quotes?status=&page=&pageSize=           → Page<EsQuote & { contactName?: string; msisdn?: string; answers: Record<string, string> }>
// POST /quotes/:reference/price { monthlyPremium } → EsQuote (status priced; customer told in the EcoSure chat)
export interface EsClaimDecisionBody {
  action: 'verify_documents' | 'start_assessment' | 'approve' | 'reject' | 'request_info'
  payout?: number // approve
  reason?: string // reject / request_info
}

// ---------- EcoCash Assistant (AI, in Chats) ----------
//
// Every person has an official chat with the EcoCash Assistant (ChatSummary.assistant). The user writes with the usual
// POST /v1/chats/:id/messages; the reply arrives as message.created events (chat.typing while it is being written).
// The assistant answers questions about EcoCash Super App, explains the user's own account (balance, transactions, requests,
// EcoSure) and prepares actions. It never moves money: an action message opens EcoCash Super App's own screen, pre-filled,
// where the user checks the details and confirms with their PIN as usual.

/** Screens an `open` action can take the user to. */
export type AssistantScreen = 'transactions' | 'my_qr' | 'receive_money' | 'pay' | 'money' | 'split' | 'topup' | 'bank' | 'remit' | 'ecosure'

export type AssistantAction =
  | { type: 'send_money'; msisdn: string; name: string; amount: number; note?: string }
  | { type: 'request_money'; msisdn: string; name: string; amount: number }
  | { type: 'buy_electricity'; amount: number } // LEC prepaid token for the user's saved meter
  | { type: 'top_up'; amount: number } // card to wallet
  | { type: 'bank_transfer'; amount: number } // wallet to bank
  | { type: 'ecosure_quote'; product: string } // 'funeral' or a short-term product code (ST-MOTOR, …)
  | { type: 'open'; screen: AssistantScreen }

/** Most messages a person may send the assistant per hour (it costs real money per answer). */
export const ASSISTANT_HOURLY_LIMIT = 30

// ---------- help & support: the assistant first, people when needed ----------
//
// The assistant answers; when it can't (or the person asks for a person), it opens a ticket and tells them that
// EcoCash support will answer in the "EcoCash Support" chat. Staff see the ticket with the AI conversation in the
// portal, reply there, and close it.

export type SupportTopic = 'payments' | 'account' | 'kyc' | 'ecosure' | 'cards_banks' | 'fraud' | 'other'
export type TicketStatus = 'open' | 'waiting' | 'closed' // waiting = support answered, waiting for the customer
/** urgent: fraud, money lost, SIM swap or account takeover — staff see these first. */
export type TicketPriority = 'urgent' | 'normal'
/** Where the receptionist met the person: in-app chat, talking to it in the app, the care phone line, a merchant's receptionist. */
export type TicketChannel = 'chat' | 'app_voice' | 'phone' | 'merchant'
/** Which support team picks up each kind of request. */
export const SUPPORT_TEAM: Record<SupportTopic, string> = {
  payments: 'Payments',
  account: 'Accounts',
  kyc: 'Accounts',
  ecosure: 'EcoSure',
  cards_banks: 'Payments',
  fraud: 'Fraud and security',
  other: 'Customer care',
}
export interface SupportTicket {
  id: string
  reference: string // SUP-000001
  user: PublicUser
  topic: SupportTopic
  /** The assistant's summary of what the person needs. */
  summary: string
  status: TicketStatus
  createdAt: string
  updatedAt: string
  /** First reply from a person in support. */
  firstResponseAt: string | null
  assignedTo: string | null
  priority: TicketPriority
  channel: TicketChannel
}
export interface SupportTicketDetail extends SupportTicket {
  /** The EcoCash Support chat, oldest first. */
  thread: Message[]
  /** The assistant conversation before the hand-over (last 40 messages). */
  aiConversation: Message[]
}
/** GET /admin/v1/support/tickets?status=&page= → Page<SupportTicket>. GET /admin/v1/support/tickets/:id → SupportTicketDetail. */
/** POST /admin/v1/support/tickets/:id/reply { text } → SupportTicketDetail. POST …/:id/close → SupportTicketDetail. */
export interface SupportReplyBody { text: string }

/** GET /admin/v1/support/stats?days=30 → SupportStats */
export interface SupportStats {
  days: number
  /** People who wrote to the assistant. */
  people: number
  questions: number
  answers: number
  handovers: number
  refusals: number
  errors: number
  /** Share of conversations the assistant handled without a person (0–1). */
  selfServiceRate: number
  tools: { name: string; count: number }[]
  topics: { topic: SupportTopic; count: number }[]
  tickets: { open: number; waiting: number; closed: number }
  /** Median minutes to the first reply from a person. */
  medianFirstResponseMinutes: number | null
  perDay: { day: string; questions: number; handovers: number }[]
}

// ---------- notifications: push, SMS and email ----------
//
// Each user picks, per channel, which kinds of notification they get. Security alerts (a new sign-in, a locked PIN,
// a changed email) always go out and can't be switched off. Email needs a verified address.

export type NotifyChannel = 'push' | 'sms' | 'email'
/** chats: messages from people (push only). news: news and offers from EcoCash Super App. */
export type NotifyCategory = 'money' | 'requests' | 'ecosure' | 'chats' | 'news' | 'security'
export type ChoosableCategory = Exclude<NotifyCategory, 'security'>

export const NOTIFY_CHANNELS: NotifyChannel[] = ['push', 'sms', 'email']
/** Which categories each channel offers (chat messages go by push only). */
export const NOTIFY_MATRIX: Record<NotifyChannel, ChoosableCategory[]> = {
  push: ['money', 'requests', 'ecosure', 'chats', 'news'],
  sms: ['money', 'requests', 'ecosure', 'news'],
  email: ['money', 'requests', 'ecosure', 'news'],
}
export type NotificationPrefs = Record<NotifyChannel, Partial<Record<ChoosableCategory, boolean>>>
/** What a user gets before changing anything. News and offers are off until they opt in. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  push: { money: true, requests: true, ecosure: true, chats: true, news: false },
  sms: { money: true, requests: false, ecosure: true, news: false },
  email: { money: false, requests: false, ecosure: true, news: false },
}

/** GET /v1/me/notifications → NotificationSettings */
export interface NotificationSettings {
  prefs: NotificationPrefs
  email: string | null
  emailVerified: boolean
  /** Push needs the phone's permission and a registered device; false until the app has registered one. */
  pushDevice: boolean
  /**
   * Travelling abroad: until this time, the 6-digit code for setting up a phone is emailed to the confirmed address
   * instead of sent by SMS, and setting up works off Econet's network. Null = off (the default).
   */
  codesByEmailUntil: string | null
}
/** PUT /v1/me/codes-by-email → NotificationSettings. Turning on needs a confirmed email and the wallet PIN. */
export interface CodesByEmailBody { on: boolean; days?: number; pin?: string }
/** Longest a person can have codes go by email in one go; they can turn it on again. Placeholder until ETL decides. */
export const CODES_BY_EMAIL_MAX_DAYS = 90
/** PUT /v1/me/notifications → NotificationSettings. Only the given switches change; security can't be switched off. */
export interface UpdateNotificationsBody { prefs: Partial<NotificationPrefs> }
/** POST /v1/me/email: set (or change) the email address and send it a 6-digit code → NotificationSettings */
export interface SetEmailBody { email: string }
/** POST /v1/me/email/verify → NotificationSettings (WRONG_PIN-style failures answer 422 VALIDATION) */
export interface VerifyEmailBody { code: string }
/** DELETE /v1/me/email → NotificationSettings */
export const EMAIL_CODE_TTL_SECONDS = 15 * 60

// ---------- services defined in the portal (form builder) ----------
//
// Staff build services in the portal: where they appear, the fields the customer fills in, validation, fees and
// limits. What the server does with a submitted form is one of a fixed set of executors (it can't be scripted from
// the portal), so money only ever moves the ways EcoCash Super App knows and checks:
//   ecocash_transfer: money out through the EcoCash API to another network or wallet (C-Pay, Khetsi, M-Pesa, …)
//   airtime / bundle: Econet airtime or a bundle for a number
//   request:          no money; a request to the EcoCash back office (e.g. Update KYC), handled in the portal
//   bill:             pay a biller through EcoCash (DStv, WASCO, an insurer, …): an account or policy number and an amount

export type ServiceExecutor = 'ecocash_transfer' | 'airtime' | 'bundle' | 'request' | 'bill'
/** send: the Send money screen. services: the Services tab. me: Me › Self service. bills: only in Pay bill. */
export type ServicePlacement = 'send' | 'services' | 'me' | 'bills'
export type ServiceFieldType = 'text' | 'number' | 'phone' | 'amount' | 'select' | 'date' | 'checkbox' | 'image'
export type PhoneNetwork = 'econet' | 'vodacom'

export interface ServiceOption {
  value: string
  label: LocalizedText
  /** Picking this option sets the price (bundles). */
  amount?: number
}

export interface ServiceField {
  /** Machine name, unique in the service: lowercase letters, digits and _ (e.g. "mpesa_number"). */
  key: string
  type: ServiceFieldType
  label: LocalizedText
  hint?: LocalizedText
  required: boolean
  /** text / number: length limits and a regular expression the value must match. */
  minLength?: number
  maxLength?: number
  pattern?: string
  patternMessage?: LocalizedText
  /** phone: which Lesotho networks are accepted (default both); ownNumber: offer "My number". */
  networks?: PhoneNetwork[]
  ownNumber?: boolean
  /** amount / number: bounds. */
  min?: number
  max?: number
  /** select: the choices. */
  options?: ServiceOption[]
  /** Shown on the review screen and receipt (default true; false for e.g. a checkbox "I agree"). */
  showOnReceipt?: boolean
}

export interface ServiceFee {
  fixed: number
  /** Percent of the amount, e.g. 1.5. */
  percent: number
  min?: number
  max?: number
}

export interface ServiceDef {
  id: string
  /** The product code the EcoCash API knows (e.g. MPESA, CPAY, KHETSI, AIRTIME, BUNDLE, KYC). */
  code: string
  name: LocalizedText
  description: LocalizedText
  /** Ionicons name, e.g. "phone-portrait". */
  icon: string
  /** An uploaded picture (e.g. the partner's logo) shown instead of the icon: a path like /v1/assets/<id>. */
  image?: string
  color: string
  placement: ServicePlacement
  sort: number
  enabled: boolean
  executor: ServiceExecutor
  fields: ServiceField[]
  fee: ServiceFee
  /** Money services: smallest and largest amount. */
  limits: { min: number; max: number }
  /** ecocash_transfer: ask the other network for the account holder's name and show it before the PIN. */
  confirmName: boolean
  /** The Pay bill category it's listed under (BillCategory id), from any placement; none: not in Pay bill. */
  category?: string
}

/**
 * Pay bill: categories of billers (Econet, LEC, MultiChoice, WASCO, Insurance, …), managed in the portal. The billers
 * are services with a `category`. GET /v1/bill-categories → BillCategory[] (enabled, in order).
 * Portal: GET /admin/v1/bill-categories (all), POST (BillCategoryBody, with an id), PUT /:id, DELETE /:id (only when empty).
 */
export interface BillCategory {
  /** Lowercase letters, digits and - (e.g. "insurance"); fixed once made. */
  id: string
  name: LocalizedText
  icon: string
  color: string
  /** An uploaded logo, a path like /v1/assets/<id>, shown instead of the icon. */
  image?: string
  sort: number
  enabled: boolean
}
export type BillCategoryBody = BillCategory

/** Customer-side values: field key → string ("true"/"false" for checkboxes, an upload id for images). */
export type ServiceValues = Record<string, string>

/** Why a field's value was refused; each side words it in the user's language. */
export type ServiceFieldError = 'required' | 'tooShort' | 'tooLong' | 'pattern' | 'number' | 'tooSmall' | 'tooBig' | 'phone' | 'network' | 'option' | 'date'

/**
 * The 8 local digits of a Lesotho number however it's written: "62000021", "6200 0021", "+266 6200 0021",
 * "26662000021", "00266 62000021". Partial input gives the digits so far (for fields people are typing in).
 * Local numbers start with 5 or 6, never 2 or 0, so a leading 266 or 00 is always a prefix.
 */
export function localNumber(input: string): string {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('266')) d = d.slice(3)
  return d.slice(0, 8)
}

/** "+26662000021" for a complete Lesotho mobile number in any of those forms; null otherwise. */
export function toMsisdn(input: string): string | null {
  const d = localNumber(input)
  return /^[56]\d{7}$/.test(d) ? `+266${d}` : null
}

/** Lesotho number (any form) → network: Econet 6x, Vodacom 5x. */
export function phoneNetwork(value: string): PhoneNetwork | null {
  const d = localNumber(value)
  if (!/^[56]\d{7}$/.test(d)) return null
  return d.startsWith('6') ? 'econet' : 'vodacom'
}

/** Checks a customer's form against the service's fields (the same rules on the phone and on the server). */
export function checkServiceValues(def: Pick<ServiceDef, 'fields'>, values: ServiceValues): Record<string, ServiceFieldError> {
  const errors: Record<string, ServiceFieldError> = {}
  for (const f of def.fields) {
    const v = (values[f.key] ?? '').trim()
    if (!v || (f.type === 'checkbox' && v !== 'true')) {
      if (f.required) errors[f.key] = 'required'
      continue
    }
    switch (f.type) {
      case 'text':
        if (f.minLength && v.length < f.minLength) errors[f.key] = 'tooShort'
        else if (f.maxLength && v.length > f.maxLength) errors[f.key] = 'tooLong'
        else if (f.pattern && !safeTest(f.pattern, v)) errors[f.key] = 'pattern'
        break
      case 'number':
      case 'amount': {
        const n = Number(v)
        if (!Number.isFinite(n) || (f.type === 'amount' && Math.abs(Math.round(n * 100) - n * 100) > 1e-6)) errors[f.key] = 'number'
        else if (f.min !== undefined && n < f.min) errors[f.key] = 'tooSmall'
        else if (f.max !== undefined && n > f.max) errors[f.key] = 'tooBig'
        else if (f.type === 'number' && f.pattern && !safeTest(f.pattern, v)) errors[f.key] = 'pattern'
        break
      }
      case 'phone': {
        const net = phoneNetwork(v)
        if (!net) errors[f.key] = 'phone'
        else if (f.networks?.length && !f.networks.includes(net)) errors[f.key] = 'network'
        break
      }
      case 'select':
        if (!f.options?.some((o) => o.value === v)) errors[f.key] = 'option'
        break
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) errors[f.key] = 'date'
        break
    }
  }
  return errors
}

function safeTest(pattern: string, v: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(v)
  } catch {
    return true // a broken pattern is caught when the service is saved
  }
}

/** The amount a form asks for: the amount field, or the price of the chosen option. null = not a money form. */
export function serviceAmount(def: Pick<ServiceDef, 'fields'>, values: ServiceValues): number | null {
  for (const f of def.fields) {
    if (f.type === 'amount') return values[f.key] ? Number(values[f.key]) : null
    if (f.type === 'select' && f.options?.some((o) => o.amount !== undefined)) {
      const o = f.options.find((x) => x.value === values[f.key])
      return o?.amount ?? null
    }
  }
  return null
}

/** Fee in maloti (rounded to the cent) for an amount. */
export function serviceFee(fee: ServiceFee, amount: number): number {
  let f = fee.fixed + (amount * fee.percent) / 100
  if (fee.min !== undefined) f = Math.max(f, fee.min)
  if (fee.max !== undefined) f = Math.min(f, fee.max)
  return Math.round(f * 100) / 100
}

/** GET /v1/services → ServiceDef[] (enabled, in order) */
/** POST /v1/services/:id/quote → ServiceQuote: checks the form, works out amount and fee, looks up the name. */
export interface ServiceQuoteBody { values: ServiceValues }
export interface ServiceQuote {
  amount: number
  fee: number
  total: number
  /** From the other network when confirmName is on. */
  recipientName?: string
  /** What the customer entered, as label → shown value, for the review screen. */
  lines: { label: string; value: string }[]
}
/** POST /v1/services/:id/submit → ServiceResult. PIN always. clientId makes retries safe. */
export interface ServiceSubmitBody { values: ServiceValues; pin: string; clientId: string }
export interface ServiceResult {
  reference: string
  /** Money services. */
  balance?: number
  transaction?: Transaction
  /** request services: the case staff will handle. */
  request?: ServiceRequest
  lines: { label: string; value: string }[]
}

export type ServiceRequestStatus = 'pending' | 'approved' | 'rejected'
export interface ServiceRequest {
  id: string
  reference: string // SR-2026-00001
  serviceId: string
  serviceName: LocalizedText
  status: ServiceRequestStatus
  lines: { label: string; value: string }[]
  note?: string // staff's answer
  createdAt: string
  updatedAt: string
}
/** GET /v1/service-requests → ServiceRequest[] (mine, newest first) */

/** POST /v1/auth/change-pin → 204. Wrong current PIN counts towards the lockout like any PIN. */
export interface ChangePinBody { currentPin: string; newPin: string }

/** GET /v1/pending → PendingItem[]: what is still open for this wallet. */
export type PendingItem =
  | { kind: 'request_to_pay'; messageId: string; chatId: string; from: string; amount: number; note?: string; createdAt: string }
  | { kind: 'request_sent'; messageId: string; chatId: string; to: string; amount: number; paid: number; note?: string; createdAt: string }
  | { kind: 'topup'; id: string; amount: number; card: string; createdAt: string }
  | { kind: 'service_request'; request: ServiceRequest }
  | { kind: 'atm'; withdrawal: AtmWithdrawal }

// ---------- Home, news & offers, in-app messages (controlled from the portal) ----------

/** Who sees an offer or gets a message. */
export type Audience = 'all' | 'customers' | 'business' | 'tier1' | 'tier2'
/** Where tapping an offer goes: one of these screens, a portal-built service ("service:<id>"), or a web link. */
export const OFFER_TARGETS = [
  'ecosure', 'ecosure_funeral', 'ecosure_short_term', 'send', 'topup', 'bank', 'remit', 'atm', 'money', 'receive_money', 'split', 'lec', 'news', 'kyc',
] as const
export type OfferTarget = (typeof OFFER_TARGETS)[number] | `service:${string}` | `url:${string}`

export interface Offer {
  id: string
  title: LocalizedText
  body: LocalizedText
  /** Button text, e.g. "Get a quote". */
  cta: LocalizedText
  /** Uploaded picture (asset path), shown on the banner. */
  image?: string
  /** Banner colour (gradient start). */
  color: string
  target: OfferTarget | null
  /** home: a banner on Home. news: in News & offers. both. */
  placement: 'home' | 'news' | 'both'
  audience: Audience
  startsAt: string
  endsAt: string | null
  sort: number
  enabled: boolean
}
export type OfferBody = Omit<Offer, 'id'>

/** Home sections the portal can show, hide and order (the balance card and quick actions always come first). */
export type HomeSection = 'offers' | 'services' | 'requests' | 'transactions'
export const HOME_SECTIONS: HomeSection[] = ['offers', 'services', 'requests', 'transactions']
export interface HomeLayout { sections: { key: HomeSection; visible: boolean }[] }

/** GET /v1/home → HomeContent: the layout and the offers for this person, in order. */
export interface HomeContent { layout: HomeLayout; offers: Offer[] }
/** GET /v1/news → Offer[] (news and offers for this person, newest first). */

/**
 * In-app message from staff to many people at once: arrives in their "EcoCash Super App" chat (with a push). With `sms`, also
 * by SMS to the people who allow news & offers by SMS.
 */
export interface BroadcastBody { text: LocalizedText; audience: Audience; sms: boolean }
export interface Broadcast { id: string; text: LocalizedText; audience: Audience; sms: boolean; recipients: number; sentBy: string; createdAt: string }
/** POST /admin/v1/broadcasts → Broadcast. GET /admin/v1/broadcasts → Broadcast[]. Offers: GET/POST /admin/v1/offers, PUT/DELETE /admin/v1/offers/:id. Layout: GET/PUT /admin/v1/home-layout. */

// ---------- KYC tiers and limits ----------
//
// Tier 1: registered, ID not yet checked by EcoCash. Tier 2: ID and selfie approved (Me › Update KYC, reviewed in
// the portal). Cash-out at an agent and ATM withdrawals need tier 2. Other money out is capped for tier 1 by limits
// staff set in the portal; over a limit → 403 KYC_REQUIRED.

/** Groups of payments that tier-1 limits apply to (money leaving the wallet). */
export type LimitGroup = 'send' | 'pay' | 'bills' | 'services' | 'bank' | 'ecosure'
export const LIMIT_GROUPS: LimitGroup[] = ['send', 'pay', 'bills', 'services', 'bank', 'ecosure']
/** Which ledger kinds count towards each group (the payer's side). */
export const LIMIT_GROUP_KINDS: Record<LimitGroup, Transaction['kind'][]> = {
  send: ['send', 'mpho', 'request'],
  pay: ['merchant', 'tap', 'qr'],
  bills: ['bill'],
  services: ['service'],
  bank: ['withdraw'],
  ecosure: ['ecosure'],
}
/** Tier-1 limits in maloti; null = no limit for that group. GET/PUT /admin/v1/kyc-limits; GET /v1/kyc-limits (the app shows them). */
export interface KycLimits {
  perTransaction: Record<LimitGroup, number | null>
  daily: Record<LimitGroup, number | null>
  /** All money out together per day. */
  dailyTotal: number | null
}

// ---------- cardless ATM withdrawal ----------
//
// The customer asks for cash in the app (PIN): the amount and fee leave the wallet at once and are held, and the app
// shows a withdrawal code. At an EcoCash-enabled ATM the customer chooses "EcoCash cash-out", enters their number,
// the code and the amount, and takes the cash. Codes expire after ATM_CODE_MINUTES; unused money comes back.
// The ATM switch is mocked: staff can "withdraw" at the ATM simulator in the portal.

export const ATM_NOTE = 50 // ATMs pay out in M50 notes and above: amounts are multiples of this
export const ATM_CODE_MINUTES = 30
export type AtmStatus = 'active' | 'redeemed' | 'expired' | 'cancelled'
export interface AtmWithdrawal {
  id: string
  reference: string // ATM-000001
  amount: number
  fee: number
  /** 8 digits, shown only to the wallet owner while active. Never in notifications. */
  code?: string
  status: AtmStatus
  expiresAt: string
  createdAt: string
  redeemedAt?: string
  atm?: string // where the cash came out
}
/** POST /v1/atm/withdrawals → AtmWithdrawal (with code). PIN always. */
export interface AtmWithdrawalBody { amount: number; pin: string; clientId: string }
/** GET /v1/atm/withdrawals → AtmWithdrawal[] (newest first). POST /v1/atm/withdrawals/:id/cancel → AtmWithdrawal (money back). */
/** POST /admin/v1/atm/redeem (ATM simulator; the real ATM switch will call a partner endpoint) → AtmWithdrawal */
export interface AtmRedeemBody { msisdn: string; code: string; amount: number; atm: string }

// ---------- app config & maintenance ----------

export interface LocalizedText { en: string; st: string }

export interface Maintenance {
  id: string
  startsAt: string
  endsAt: string
  message: LocalizedText
  /** True while now is inside the window (server clock). Upcoming windows are false. */
  active: boolean
}

/** GET /v1/app-config (public, no auth, works during maintenance) */
export interface AppConfig {
  /** The active window, else the next scheduled one within 7 days, else null. */
  maintenance: Maintenance | null
  announcement: LocalizedText | null
  /** Builds below this version must update (semver). */
  minVersion: { customer: string | null; business: string | null; ecosure: string | null; society: string | null }
  serverTime: string
  /** Uploaded in the portal (Branding). Paths on this server, e.g. /v1/assets/<id>; null = the built-in one. */
  branding: { logo: string | null; miniAppIcons: MiniAppIconPaths }
  /** Phones the apps refuse to run on (portal: Settings › Device security). */
  deviceSecurity: DeviceSecurity
  /** USSD fallback when the app has no internet (portal: Settings › USSD fallback). The apps keep the last copy. */
  ussd: UssdSettings
  /** Me › Contact us and Share the app (portal: Settings › Contact us). */
  contact: ContactSettings
}

/** POST /v1/devices: register an Expo push token for this session's user. 204. */
export interface RegisterDeviceBody { expoPushToken: string; platform: 'android' | 'ios'; app: AppKind }
/** POST /v1/devices/unregister { expoPushToken } → 204, when signing out: the phone stops getting this wallet's pushes. */
/**
 * POST /v1/devices/test → PushTestResult: Me › Notifications › Send a test. sent: via Expo push (it should arrive in
 * seconds); live: push is off on this server, so only an open app hears it; failed: Expo or Firebase refused (error
 * says why); off: push is off on this server and no app is listening.
 */
export interface PushTestResult { status: 'sent' | 'live' | 'failed' | 'off'; error: string | null; devices: string }

// ---------- USSD fallback (no internet) ----------
// With no internet, a few functions offer EcoCash's USSD menu instead: on Android the app opens the dialer with the
// code (and, where ETL's gateway takes one, a shortcut with the number and amount already in it); the person finishes
// in the USSD session. The PIN is never put in the dial string (it would be kept in the call log). iPhones can't start
// USSD from an app, so they show the code to dial. Set in the portal; GET/PUT /admin/v1/ussd-settings.

export const USSD_FUNCTIONS = ['balance', 'send', 'airtime', 'lec', 'cashout', 'merchant'] as const
export type UssdFunction = (typeof USSD_FUNCTIONS)[number]
/** Values a shortcut may carry. Digits only (amounts may have a decimal point). Never the PIN. */
export const USSD_PLACEHOLDERS = ['number', 'amount', 'meter', 'code'] as const
export type UssdPlaceholder = (typeof USSD_PLACEHOLDERS)[number]
export interface UssdFunctionSettings {
  enabled: boolean
  /**
   * Shortcut dial string, e.g. *199*1*1*{number}*{amount}#. Empty: dial the main code and follow the steps.
   * Used only when every placeholder in it has a value; otherwise the main code is dialled.
   */
  shortcut: string
  /** What to choose in the menu, shown next to the button. */
  steps: LocalizedText
}
export interface UssdSettings {
  enabled: boolean
  /** The main code, e.g. *199#. */
  code: string
  functions: Record<UssdFunction, UssdFunctionSettings>
}

/** PLACEHOLDER menu steps until ETL confirms the *199# menus; the code itself is the production one. */
export const USSD_DEFAULTS: UssdSettings = {
  enabled: true,
  code: '*199#',
  functions: {
    balance: { enabled: true, shortcut: '', steps: { en: 'Choose the balance option, then type your PIN in the menu.', st: 'Khetha ho sheba chelete e teng, ebe u ngola PIN ea hao ka har’a menu.' } },
    send: { enabled: true, shortcut: '', steps: { en: 'Choose Send money, enter the number and the amount, then type your PIN in the menu.', st: 'Khetha ho romela chelete, kenya nomoro le chelete, ebe u ngola PIN ea hao ka har’a menu.' } },
    airtime: { enabled: true, shortcut: '', steps: { en: 'Choose Buy airtime, enter the amount, then type your PIN in the menu.', st: 'Khetha ho reka airtime, kenya chelete, ebe u ngola PIN ea hao ka har’a menu.' } },
    lec: { enabled: true, shortcut: '', steps: { en: 'Choose Pay bills, then LEC. Enter the meter number and the amount, then type your PIN in the menu.', st: 'Khetha ho lefa likoloto, ebe LEC. Kenya nomoro ea mitara le chelete, ebe u ngola PIN ea hao ka har’a menu.' } },
    cashout: { enabled: true, shortcut: '', steps: { en: 'Choose Cash out, enter the agent code and the amount, then type your PIN in the menu.', st: 'Khetha ho ntša chelete, kenya khoutu ea agent le chelete, ebe u ngola PIN ea hao ka har’a menu.' } },
    merchant: { enabled: true, shortcut: '', steps: { en: 'Choose Pay merchant, enter the merchant code and the amount, then type your PIN in the menu.', st: 'Khetha ho lefa lebenkele, kenya khoutu ea lebenkele le chelete, ebe u ngola PIN ea hao ka har’a menu.' } },
  },
}

/** A main code: * digits/stars #. */
export const USSD_CODE_PATTERN = /^\*[0-9*]{1,30}#$/
/** A shortcut: * then digits, stars and {placeholders}, ending in #. */
export const USSD_SHORTCUT_PATTERN = /^\*(?:[0-9*]|\{(?:number|amount|meter|code)\}){1,80}#$/

/** Fills a shortcut. A missing or unusable value means the main code instead (the person types it in the menu). */
export function ussdDialString(s: UssdSettings, fn: UssdFunction, values: Partial<Record<UssdPlaceholder, string | number>> = {}): string {
  const shortcut = s.functions[fn]?.shortcut ?? ''
  if (!shortcut) return s.code
  let ok = true
  const filled = shortcut.replace(/\{(number|amount|meter|code)\}/g, (_m, key: UssdPlaceholder) => {
    const raw = values[key]
    const v = raw === undefined || raw === null ? '' : String(raw).replace(/^\+266/, '').replace(key === 'amount' ? /[^\d.]/g : /\D/g, '')
    if (!v || (key === 'amount' && !/^\d+(\.\d{1,2})?$/.test(v))) ok = false
    return v
  })
  return ok ? filled : s.code
}

// ---------- realtime: WebSocket /v1/ws?token=… ----------

export type ServerEvent =
  | { type: 'hello'; userId: string }
  | { type: 'message.created'; message: Message }
  | { type: 'message.updated'; message: Message } // request paid/declined, partial payment
  | { type: 'chat.created'; chat: ChatSummary }
  | { type: 'chat.removed'; chatId: string } // a group was deleted, or the user left it
  | { type: 'balance'; balance: number }
  | { type: 'config'; config: AppConfig } // maintenance started/ended/changed
  | { type: 'intent.updated'; intent: PaymentIntent } // to the merchant (and the payer) when paid/cancelled/expired
  | { type: 'chat.typing'; chatId: string; typing: boolean } // the EcoCash Assistant is writing a reply
  /**
   * A push delivered over the live connection to an app in the background (no push service needed: phones without
   * Google Play services, or while PUSH_ENABLED is off). The app shows it as a system notification.
   */
  | { type: 'notification'; title: string; body: string; data: Record<string, string> }
  | { type: 'pong' }

/** state: the app moved to the foreground (active) or background, so the server knows when a push is needed. */
export type ClientEvent = { type: 'ping' } | { type: 'state'; active: boolean }

// ---------- admin portal: /admin/v1 ----------

export type AdminRole = 'admin' | 'support' // support: read-only
export interface Admin { id: string; email: string; name: string; role: AdminRole }

/** POST /admin/v1/login */
export interface AdminLoginBody { email: string; password: string }
export interface AdminLoginResponse { token: string; admin: Admin }
/** GET /admin/v1/me → Admin */
/** POST /admin/v1/logout → 204 (revokes the admin token) */

/** GET /admin/v1/stats */
export interface AdminStats {
  users: Record<Role, number>
  suspended: number
  today: { transactions: number; volume: number; messages: number; newUsers: number }
  maintenance: Maintenance | null
}

export type MaintenanceStatus = 'scheduled' | 'active' | 'ended' | 'cancelled'
export interface MaintenanceWindow {
  id: string
  startsAt: string
  endsAt: string
  message: LocalizedText
  status: MaintenanceStatus
  createdBy: string // admin email
  createdAt: string
}
/** GET /admin/v1/maintenance → MaintenanceWindow[] (newest first) */
/** POST /admin/v1/maintenance → MaintenanceWindow. startsAt may be now ("start now"). */
export interface MaintenanceBody { startsAt: string; endsAt: string; message: LocalizedText }
/** PATCH /admin/v1/maintenance/:id (scheduled or active only) → MaintenanceWindow */
/** POST /admin/v1/maintenance/:id/end → MaintenanceWindow (ends an active window now) */
/** POST /admin/v1/maintenance/:id/cancel → MaintenanceWindow (cancels a scheduled window) */

/** GET /admin/v1/app-config → AppConfig (same as /v1/app-config, but with the admin token) */
/** PUT /admin/v1/app-config → AppConfig */
export interface AppConfigBody {
  announcement: LocalizedText | null
  minVersion: { customer: string | null; business: string | null; ecosure: string | null; society: string | null }
  /** Left out = unchanged. */
  deviceSecurity?: DeviceSecurity
}

export type UserStatus = 'active' | 'suspended'
export interface AdminUser extends Me {
  status: UserStatus
  createdAt: string
  lastSeenAt: string | null
  /** Agents and merchants: the owner's national ID. Only that person can add the business to their EcoCash Super App. */
  ownerIdNumber: string | null
}
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  /**
   * Lists with filter chips: how many match each filter value ("role:agent", "kind:send", "severity:high", plus
   * "role:all"…), with the search and the other filters applied but not that filter itself.
   */
  counts?: Record<string, number>
}
/** GET /admin/v1/users?query=&role=&status=&page=1&pageSize=20 → Page<AdminUser> with counts role:* and status:* (query matches name or number) */
/** GET /admin/v1/users/:id → AdminUser */
/** POST /admin/v1/users → AdminUser (onboard an agent, merchant or customer) */
export interface CreateUserBody { msisdn: string; name: string; role: Role; pin: string; businessName?: string; ownerIdNumber?: string }
/** PATCH /admin/v1/users/:id → AdminUser */
export interface UpdateUserBody { name?: string; status?: UserStatus; businessName?: string; ownerIdNumber?: string }
/** POST /admin/v1/users/:id/reset-pin → 204 */
export interface ResetPinBody { pin: string }
/** POST /admin/v1/users/:id/float: credit an agent's float (e.g. after a bank deposit) → AdminUser */
export interface FloatBody { amount: number; note: string }

export interface AdminTransaction extends Omit<Transaction, 'amount' | 'counterpartyName'> {
  amount: number // always positive
  from: PublicUser | null // null = system (float, cash-in source)
  to: PublicUser | null
}
/** GET /admin/v1/users/:id/devices → BoundDevice[]. POST /admin/v1/users/:id/devices/:deviceId/unbind → BoundDevice[] (signs that phone out). */

/** GET /admin/v1/transactions?query=&kind=&userId=&days=&page=1&pageSize=20 → Page<AdminTransaction> with counts kind:* (newest first; userId = either side; days = the last N days only) */

export interface AuditEntry {
  id: string
  adminEmail: string
  action: string // e.g. 'maintenance.create', 'user.suspend'
  target: string // e.g. 'user:…', 'maintenance:…'
  detail: string
  createdAt: string
}
/** GET /admin/v1/audit?page=1&pageSize=20 → Page<AuditEntry> */

// ---------- analytics (portal) ----------

/** GET /admin/v1/analytics?days=30 → Analytics. Days are Maseru days, oldest first. */
export interface Analytics {
  days: number
  users: { total: number; byRole: Record<Role, number>; byTier: { tier1: number; tier2: number }; usernames: number; emails: number }
  perDay: { day: string; activeUsers: number; newUsers: number; transactions: number; volume: number }[]
  /** Money moved in the period, by ledger kind. */
  byKind: { kind: Transaction['kind']; count: number; volume: number }[]
  services: { name: string; count: number; volume: number }[]
  signUps: { started: number; completed: number; failed: number }
  kyc: { pending: number; approved: number; rejected: number }
  notifications: { channel: NotifyChannel; sent: number; mock: number; failed: number }[]
  atm: { count: number; volume: number }
  risk: { open: number; blocked: number; flagged: number }
}

// ---------- performance (portal: Performance) ----------

/** A number for the chosen period and for the same number of days just before it. */
export interface PerfPair { current: number; previous: number }
/** Flows measured by how often they end well. */
export type PerfFlowKey = 'signup' | 'atm' | 'merchant' | 'requests' | 'kyc' | 'claims' | 'notifications' | 'risk'
export interface ApiAreaPerf {
  /** The first part of the path ("auth", "ecosure"), "portal" for staff routes or "assets". */
  area: string
  requests: number
  /** 4xx: refused (wrong PIN, validation, not found…). 5xx: the server failed. */
  clientErrors: number
  serverErrors: number
  avgMs: number
  p95Ms: number | null
}
/** GET /admin/v1/performance?days=30 → Performance. Periods are the last `days` × 24 hours. */
export interface Performance {
  days: number
  kpis: {
    payments: PerfPair
    volume: PerfPair
    averagePayment: PerfPair
    fees: PerfPair
    payingUsers: PerfPair
    activeUsers: PerfPair
    newWallets: PerfPair
  }
  /** The performance matrix: one row per kind of payment (fees and registrations left out), by value. */
  products: { kind: Transaction['kind']; count: PerfPair; volume: PerfPair; average: number; users: number; share: number }[]
  /** done of total for each flow started (or finished) in the period. Flows still open are left out where they can be. */
  flows: { key: PerfFlowKey; done: number; total: number }[]
  api: {
    requests: number
    clientErrors: number
    serverErrors: number
    p50Ms: number | null
    p95Ms: number | null
    perDay: { day: string; requests: number; serverErrors: number }[]
    areas: ApiAreaPerf[]
  }
}

// ---------- fraud and anomaly detection (portal: Risk) ----------
//
// Rules run on every payment (in the ledger). "block" stops the payment (403 RISK_BLOCKED); "flag" lets it through
// and opens an alert. Thresholds are set in the portal. A real-time ML/enterprise engine can feed the same alerts later.

export type RiskRuleKey = 'velocity' | 'new_device_cashout' | 'many_senders' | 'unusual_amount' | 'night_cashout' | 'sim_swap'
export interface RiskRule {
  key: RiskRuleKey
  enabled: boolean
  action: 'flag' | 'block'
  /** Rule-specific numbers, e.g. { count: 10, minutes: 10 }. */
  params: Record<string, number>
}
export const RISK_RULE_INFO: Record<RiskRuleKey, { title: string; detail: string }> = {
  velocity: { title: 'Too many payments too fast', detail: 'More than {count} payments out within {minutes} minutes from one wallet.' },
  new_device_cashout: { title: 'Large cash-out from a new phone', detail: 'Cash-out, ATM, bank or other-network payment over M{amount} within {hours} hours of setting up a new phone.' },
  many_senders: { title: 'Many people paying one wallet', detail: 'One wallet receives from {senders} or more different people within {minutes} minutes (possible mule account).' },
  unusual_amount: { title: 'Unusually large payment', detail: 'A payment over M{amount} and more than {times}× the wallet\'s average payment of the last 30 days.' },
  night_cashout: { title: 'Large cash-out at night', detail: 'Cash-out, ATM or bank payment over M{amount} between {from}:00 and {to}:00 (Maseru).' },
  sim_swap: {
    title: 'Recent SIM swap',
    detail: 'Within {hours} hours of the number moving to a new SIM: cash-outs, ATM, bank, abroad and other-network payments, and any payment over M{amount}. Setting up a new phone is refused for {setupHours} hours. Staff lift it after checking the owner in person.',
  },
}
/** Transaction surveillance (anti-money-laundering) scenarios, run every few minutes over recent payments. */
export type SurveillanceKey = 'structuring' | 'pass_through' | 'dormant_reactivation'
/** What raised an alert: a fixed rule, the behavioural risk score, or a surveillance scenario. */
export type RiskAlertRule = RiskRuleKey | 'behaviour_score' | SurveillanceKey | 'auth_anomaly'
export const RISK_ALERT_TITLE: Record<RiskAlertRule, string> = {
  ...(Object.fromEntries(Object.entries(RISK_RULE_INFO).map(([k, v]) => [k, v.title])) as Record<RiskRuleKey, string>),
  behaviour_score: 'Unusual behaviour (risk score)',
  structuring: 'Possible structuring',
  pass_through: 'Money passing straight through',
  dormant_reactivation: 'Dormant wallet suddenly active',
  auth_anomaly: 'Unusual sign-in activity',
}
export type RiskAlertStatus = 'open' | 'fraud' | 'ok'
export interface RiskAlert {
  id: string
  user: PublicUser
  rule: RiskAlertRule
  action: 'flagged' | 'blocked'
  severity: 'low' | 'medium' | 'high'
  detail: string
  amount: number | null
  kind: string | null
  status: RiskAlertStatus
  reviewedBy: string | null
  createdAt: string
  /** Behavioural risk score 0–100 of the payment, when it was scored. */
  score: number | null
  /** The AI decision behind the alert (its reasons are in the decision log). */
  decisionId: string | null
  /** The financial crime case the alert belongs to. */
  caseId: string | null
  caseRef: string | null
}
/** GET /admin/v1/risk/alerts?status=&severity=&action=&page= → Page<RiskAlert> with counts status:*, severity:* and action:*. POST /admin/v1/risk/alerts/:id/review { status, suspend? } → RiskAlert. */
export interface RiskReviewBody { status: 'fraud' | 'ok'; suspend?: boolean }
/** GET /admin/v1/risk/rules → RiskRule[]. PUT /admin/v1/risk/rules RiskRule[] → RiskRule[]. */

// ---------- behavioural risk score (explainable) ----------
//
// Every payment by a person gets a score from 0 to 100: the sum of points from the features below, each with a
// plain reason. No black box: staff see exactly why a payment scored what it did (AI governance › Decisions).

export type ScoreFeature =
  | 'amount_vs_usual' | 'thin_history' | 'new_recipient' | 'new_account' | 'new_device' | 'cash_out'
  | 'unusual_hour' | 'velocity' | 'drains_balance' | 'risky_recipient' | 'sim_swap' | 'unusual_context'
export const SCORE_FEATURE_INFO: Record<ScoreFeature, { title: string; max: number }> = {
  amount_vs_usual: { title: 'Much larger than their usual payment', max: 30 },
  thin_history: { title: 'Large payment with little history', max: 10 },
  new_recipient: { title: 'First payment to this person', max: 10 },
  new_account: { title: 'New wallet', max: 15 },
  new_device: { title: 'New phone set up recently', max: 35 },
  cash_out: { title: 'Money leaving EcoCash (cash-out, ATM, bank)', max: 10 },
  unusual_hour: { title: 'At an hour they never pay', max: 10 },
  velocity: { title: 'Many payments in the last hour', max: 25 },
  drains_balance: { title: 'Empties the wallet', max: 15 },
  risky_recipient: { title: 'Receiver linked to fraud alerts', max: 30 },
  sim_swap: { title: 'Number moved to a new SIM recently', max: 40 },
  unusual_context: { title: 'Phone or place unlike the bound phone’s usual', max: 40 },
}
/** A reason behind a decision: a score feature (with its points) or a surveillance scenario (0 points). */
export interface ScoreReason { feature: ScoreFeature | SurveillanceKey; points: number; detail: string }

// ---------- AI governance and model risk management (portal: AI governance) ----------
//
// Every automated model is registered with what it decides, the data it uses, its limits and who oversees it.
// Each change makes a new version (who, when, why). "shadow" scores and logs without acting, to test a change
// safely; "active" acts. Every decision is logged with its reasons and joined to the human review outcome, which
// measures how often each model is right.

export type AiModelKey = 'fraud_score' | 'aml_surveillance' | 'case_summary' | 'assistant'
export type AiModelMode = 'off' | 'shadow' | 'active'
export type AiOutcome = 'allow' | 'flag' | 'block' | 'info'
export interface AiParamInfo { label: string; hint?: string; min: number; max: number; step?: number }
export interface AiModelInfo {
  title: string
  kind: 'scoring' | 'rules' | 'llm'
  purpose: string
  /** What the model is allowed to decide on its own. */
  decides: string
  humanOversight: string
  dataUsed: string
  limitations: string
  /** Modes staff may choose; empty: not configurable here. */
  modes: AiModelMode[]
  params: Record<string, AiParamInfo>
}
export const AI_MODEL_INFO: Record<AiModelKey, AiModelInfo> = {
  fraud_score: {
    title: 'Behavioural fraud score',
    kind: 'scoring',
    purpose: 'Scores every payment 0–100 against the payer\'s own usual behaviour, to catch account takeover, scams and mule activity as it happens.',
    decides: 'Flags payments at or above "Flag at". Blocks at or above "Block at" only when that is set above 0.',
    humanOversight: 'Every flag or block opens an alert that staff review as fraud or fine; high scores open a case. The customer can call customer care about a blocked payment.',
    dataUsed: 'The payer\'s payments of the last 90 days, wallet age, balance, phone changes, and fraud alerts on the receiver. No personal details beyond the wallet.',
    limitations: 'Points-based, so it is fully explainable but simpler than a trained model. New wallets have little history, so their scores lean on fewer features. Thresholds are placeholders until ETL sets them.',
    modes: ['off', 'shadow', 'active'],
    params: {
      flagAt: { label: 'Flag at score', hint: 'Payments scoring this or more are let through and flagged.', min: 1, max: 100 },
      blockAt: { label: 'Block at score', hint: '0 = never block on the score alone.', min: 0, max: 100 },
      caseAt: { label: 'Open a case at score', hint: 'Payments scoring this or more open (or join) a case.', min: 1, max: 100 },
    },
  },
  aml_surveillance: {
    title: 'Transaction surveillance (AML)',
    kind: 'rules',
    purpose: 'Looks across recent payments every few minutes for money-laundering patterns that no single payment shows.',
    decides: 'Raises alerts only; never stops a payment.',
    humanOversight: 'Every alert is reviewed by staff, and a case is opened for each wallet so a suspicious transaction report can be filed with the FIU.',
    dataUsed: 'Payments of the last 24 hours to 180 days.',
    limitations: 'Fixed scenarios with placeholder thresholds until ETL compliance confirms them.',
    modes: ['off', 'shadow', 'active'],
    params: {
      structuringAmount: { label: 'Structuring: reporting amount (M)', hint: 'Payments just under this amount are watched.', min: 100, max: 100000 },
      structuringCount: { label: 'Structuring: payments in 24 h', min: 2, max: 50 },
      passThroughMin: { label: 'Pass-through: money in over 24 h (M)', min: 100, max: 100000 },
      passThroughPercent: { label: 'Pass-through: % sent on', min: 10, max: 100 },
      dormantDays: { label: 'Dormant: days with no payments', min: 7, max: 720 },
      dormantAmount: { label: 'Dormant: then pays out (M)', min: 100, max: 100000 },
    },
  },
  case_summary: {
    title: 'Case summary (Claude)',
    kind: 'llm',
    purpose: 'Writes a neutral first summary of a financial crime case for the investigator: what happened, red flags, and what to check next.',
    decides: 'Nothing. It only writes a draft for staff; staff decide the outcome.',
    humanOversight: 'Only made when a staff member asks, shown labelled as AI-written, and kept in the case history.',
    dataUsed: 'The case\'s alerts and payments, pseudonymised: no names, phone numbers or IDs are sent to the model.',
    limitations: 'Can misread patterns or miss context. Never use it as the reason for an outcome without checking the payments.',
    modes: ['off', 'active'],
    params: {},
  },
  assistant: {
    title: 'EcoCash Assistant (Claude)',
    kind: 'llm',
    purpose: 'Answers customers in their assistant chat and gets payments ready for them.',
    decides: 'Nothing about money: it only prepares cards that open the app\'s own screens, where the customer confirms with their PIN.',
    humanOversight: 'Hands over to a person in EcoCash Support when asked, when money seems lost or taken, or when it can\'t help. Conversations handed over are in Help & support.',
    dataUsed: 'The customer\'s own wallet, payments, requests and EcoSure cover, read through tools during the chat.',
    limitations: 'Can be wrong about how features work. It is switched on by the server\'s Claude key, not from here.',
    modes: [],
    params: {},
  },
}
export interface AiModelStats {
  /** Last 30 days. */
  decisions: number
  byOutcome: Record<AiOutcome, number>
  /** Of its alerts reviewed by staff: confirmed fraud vs. found fine. */
  confirmedFraud: number
  falsePositives: number
  /** confirmedFraud / reviewed; null until something was reviewed. */
  precision: number | null
  /** Scores in buckets of 10 (0–9 … 90–100); empty for models without a score. */
  scoreBuckets: number[]
  /** Average score in the last 7 days and in the 3 weeks before (a shift suggests drift). */
  avgScore: { lastWeek: number | null; before: number | null }
}
export interface AiModel {
  key: AiModelKey
  version: number
  mode: AiModelMode
  params: Record<string, number>
  changedBy: string | null
  changedAt: string | null
  note: string | null
  /** e.g. "In-house, explainable" or "Anthropic claude-opus-5-5". */
  provider: string
  /** False when the model can't run (no Claude key on the server). */
  available: boolean
  stats: AiModelStats
}
export interface AiModelVersion { version: number; mode: AiModelMode; params: Record<string, number>; changedBy: string | null; changedAt: string; note: string | null }
/** PUT /admin/v1/ai/models/:key → AiModel (a new version). GET /admin/v1/ai/models → AiModel[]. GET /admin/v1/ai/models/:key/versions → AiModelVersion[]. */
export interface AiModelBody { mode: AiModelMode; params: Record<string, number>; note: string }
export interface AiDecision {
  id: string
  model: AiModelKey
  version: number
  /** Logged in shadow mode: it did not act. */
  shadow: boolean
  user: PublicUser | null
  score: number | null
  outcome: AiOutcome
  reasons: ScoreReason[]
  summary: string
  amount: number | null
  kind: string | null
  transactionRef: string | null
  /** What staff found when they reviewed the alert or case; null until then. */
  review: 'fraud' | 'ok' | null
  createdAt: string
}
/** GET /admin/v1/ai/decisions?model=&outcome=&page= → Page<AiDecision> with counts model:* and outcome:*. */

// ---------- financial crime case management (portal: Cases) ----------
//
// Alerts about one wallet are gathered in one case. High-severity alerts, blocks, high scores and surveillance
// alerts open a case on their own; staff can also open one. Staff assign, investigate, freeze the wallet,
// close it as fraud or fine (which reviews every alert in it), and file a suspicious transaction report (STR).

export type CaseStatus = 'open' | 'investigating' | 'escalated' | 'closed_fraud' | 'closed_ok'
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'New', investigating: 'Investigating', escalated: 'Escalated', closed_fraud: 'Closed: fraud', closed_ok: 'Closed: fine',
}
export type CasePriority = 'high' | 'medium' | 'low'
export interface FraudCase {
  id: string
  /** e.g. CASE-000123. */
  ref: string
  user: PublicUser
  status: CaseStatus
  priority: CasePriority
  title: string
  assignedTo: string | null
  alertCount: number
  openAlerts: number
  /** Money in the case's alerts. */
  amount: number
  frozen: boolean
  strRef: string | null
  strFiledAt: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
}
export type CaseEventKind = 'created' | 'alert' | 'note' | 'status' | 'assign' | 'freeze' | 'unfreeze' | 'summary' | 'str' | 'closed'
export interface CaseEvent { id: string; actor: string; kind: CaseEventKind; text: string; createdAt: string }
export interface CaseTransaction {
  reference: string
  kind: string
  direction: 'in' | 'out'
  amount: number
  counterparty: string | null
  createdAt: string
  /** An alert in this case points at it. */
  flagged: boolean
}
export interface FraudCaseDetail extends FraudCase {
  alerts: RiskAlert[]
  events: CaseEvent[]
  /** The wallet's payments of the last 30 days, newest first (at most 200). */
  transactions: CaseTransaction[]
  wallet: { status: UserStatus; balance: number; kycTier: 1 | 2; createdAt: string; phones: number }
  /** The latest AI-written summary, if one was asked for. */
  summary: { text: string; createdAt: string; by: string } | null
}
export interface CaseStats { open: number; investigating: number; escalated: number; unassigned: number; closedLast30: number; avgDaysToClose: number | null }
/**
 * GET /admin/v1/cases?status=&priority=&mine=&page= → Page<FraudCase> with counts status:* and priority:*.
 * status may also be "active" (every status not closed). GET /admin/v1/cases/stats → CaseStats.
 * POST /admin/v1/cases CaseOpenBody → FraudCaseDetail. GET /admin/v1/cases/:id → FraudCaseDetail.
 * PATCH /admin/v1/cases/:id CaseUpdateBody · POST …/close CaseCloseBody · POST …/freeze CaseFreezeBody ·
 * POST …/summary (AI) · POST …/str CaseStrBody → FraudCaseDetail.
 */
export interface CaseOpenBody { msisdn: string; title: string; note: string }
export interface CaseUpdateBody { status?: 'open' | 'investigating' | 'escalated'; assignedTo?: string | null; note?: string }
export interface CaseCloseBody { outcome: 'fraud' | 'ok'; note: string }
export interface CaseFreezeBody { frozen: boolean; note: string }
export interface CaseStrBody { reference: string }

/** sent: handed to the provider. mock: no provider plugged in yet, recorded here only. failed: the provider refused it. */
export type NotificationStatus = 'sent' | 'mock' | 'failed'
export interface AdminNotification {
  id: string
  user: PublicUser | null
  channel: NotifyChannel
  category: NotifyCategory
  /** Phone number, email address or "2 devices". */
  recipient: string
  title: string
  body: string
  status: NotificationStatus
  error?: string
  createdAt: string
}
/** GET /admin/v1/notifications?channel=&category=&query=&page=1&pageSize=20 → Page<AdminNotification> (newest first) */
/** POST /admin/v1/notifications/news: news and offers to every person who switched them on → { recipients: number } */
export interface NewsBody { title: string; body: string }
/** GET /admin/v1/notifications/providers → which channels have a real provider plugged in */
// ---------- branding (portal) ----------

export type AssetKind = 'logo' | 'app_icon' | 'service_icon' | 'banner' | 'profile_photo'
/** POST /admin/v1/assets: upload a PNG or JPEG (base64). The app icon must be a square PNG of at least 512 px. → Asset */
/** PUT /v1/me/photo → Me: a new profile picture (JPEG or PNG, square, up to 2 MB). DELETE /v1/me/photo → Me. */
export interface ProfilePhotoBody { contentType: 'image/png' | 'image/jpeg'; base64: string }
export interface AssetUploadBody { kind: AssetKind; contentType: 'image/png' | 'image/jpeg'; base64: string; fileName?: string }
export interface Asset { id: string; kind: AssetKind; path: string; width: number; height: number; size: number; createdAt: string }
/** GET /v1/assets/:id (public, cached forever: every upload gets a new id) → the image */
/**
 * GET /admin/v1/branding → Branding. PUT /admin/v1/branding (BrandingBody) → Branding.
 * The logo reaches the apps at once (AppConfig.branding). The home-screen icon is used by the next app build
 * (`npm run fetch-branding` before building), since phones only change an app's icon with an update.
 */
export interface Branding { logo: Asset | null; appIcon: Asset | null; miniAppIcons: Partial<Record<MiniAppIconId, Asset>> }
export interface BrandingBody { logoId: string | null; appIconId: string | null }

/**
 * Mini apps whose icon can be uploaded in the portal (Branding › Mini app icons), with their English names.
 * `standalone`: the mini app is also its own app (APP_VARIANT), so the icon is that app's home-screen icon too,
 * from its next build (`npm run fetch-branding`).
 */
export const MINI_APP_ICONS = [
  { id: 'ecosure', name: 'EcoSure', standalone: true },
  { id: 'money', name: 'Pay code' },
  { id: 'receive', name: 'Receive money' },
  { id: 'split', name: 'Split bill' },
  { id: 'scan', name: 'Pay merchant' },
  { id: 'paybill', name: 'Pay bill' },
  { id: 'topup', name: 'Card to wallet' },
  { id: 'bank', name: 'Wallet to bank' },
  { id: 'remit', name: 'Send abroad' },
  { id: 'atm', name: 'ATM cash' },
  { id: 'cashout', name: 'Cash out' },
  { id: 'airtime', name: 'Buy airtime' },
  { id: 'lec', name: 'LEC' },
  { id: 'wasco', name: 'WASCO' },
  { id: 'school', name: 'School fees' },
  { id: 'society', name: 'Society / Mekhatlo', standalone: true },
  { id: 'donate', name: 'Donate' },
  { id: 'burial', name: 'Burial society' },
  { id: 'church', name: 'Church' },
  { id: 'business', name: 'EcoCash Business', standalone: true },
  { id: 'taxi', name: 'Taxi mode' },
  { id: 'softpos', name: 'Shop SoftPOS' },
  { id: 'payroll', name: 'Payroll' },
  { id: 'home', name: 'Romela hae' },
  { id: 'agents', name: 'Agents' },
  { id: 'wool', name: 'Wool & mohair' },
] as const satisfies readonly { id: string; name: string; standalone?: boolean }[]
export type MiniAppIconId = (typeof MINI_APP_ICONS)[number]['id']
export const MINI_APP_ICON_IDS = MINI_APP_ICONS.map((a) => a.id) as MiniAppIconId[]
/** In AppConfig: mini app → /v1/assets/<id>. A mini app without one keeps its built-in icon. */
export type MiniAppIconPaths = Partial<Record<MiniAppIconId, string>>
/**
 * PUT /admin/v1/branding/mini-apps/:id { assetId } → Branding. The asset is an uploaded app_icon (square PNG,
 * at least 512 px); null goes back to the built-in icon. Reaches the apps at once.
 */
export interface MiniAppIconBody { assetId: string | null }

export interface NotificationProviders { push: boolean; sms: boolean; email: boolean; assistant: boolean }

/** GET /admin/v1/services → ServiceDef[] (all, enabled or not). POST creates, PUT /:id replaces, DELETE /:id removes. */
export type ServiceBody = Omit<ServiceDef, 'id'>
export interface AdminServiceRequest extends ServiceRequest {
  user: PublicUser
  /** Uploaded images: field key → label, fetched from /admin/v1/service-requests/:id/files/:key */
  files: { key: string; label: string }[]
}
/** GET /admin/v1/service-requests?status=&page= → Page<AdminServiceRequest> */
/** POST /admin/v1/service-requests/:id/decision → AdminServiceRequest */
export interface ServiceRequestDecisionBody { status: 'approved' | 'rejected'; note?: string }

// ---------- Places: agents, merchants and ATMs on the map (Me › Find us; portal: Places) ----------
//
// GET /v1/places → Place[]: every enabled place (the app sorts by distance from the phone). No sign-in needed.
// Portal: GET /admin/v1/places → Place[] (disabled too), POST /admin/v1/places (PlaceBody) → Place,
// PUT /admin/v1/places/:id (PlaceBody) → Place, DELETE /admin/v1/places/:id → 204.

export type PlaceKind = 'shop' | 'agent' | 'merchant' | 'atm'
export const PLACE_KINDS: PlaceKind[] = ['shop', 'agent', 'merchant', 'atm']

export interface Place {
  id: string
  kind: PlaceKind
  name: string
  /** Street, area and town, as people say it ("Kingsway, next to Pioneer Mall, Maseru"). */
  address: string
  lat: number
  lng: number
  /** Opening hours as text ("Mon–Sat 08:00–18:00"); ATMs usually "24 hours". */
  hours?: string
  phone?: string
  /** Agents and merchants: their EcoCash code (AGENT-0101, 1001), shown so people can cash out or pay there. */
  code?: string
  /** Shown in the apps only when on. */
  enabled: boolean
  updatedAt: string
}

export interface PlaceBody {
  kind: PlaceKind
  name: string
  address: string
  lat: number
  lng: number
  hours?: string
  phone?: string
  code?: string
  enabled: boolean
}

/** Lesotho's bounding box: places outside it are refused (a swapped latitude and longitude, usually). */
export const LESOTHO_BOUNDS = { minLat: -30.7, maxLat: -28.5, minLng: 27.0, maxLng: 29.5 }

/** Metres between two points (haversine). */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Compass bearing from a to b, 0–360 degrees (0 = north, 90 = east). */
export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// ---------- Feedback, Contact us, Share the app (Me) ----------
//
// POST /v1/feedback (FeedbackBody) → 201. Portal: GET /admin/v1/feedback → Feedback[] (newest first).
// Contact details and the share link come in AppConfig.contact; portal: GET/PUT /admin/v1/contact-settings.

export interface FeedbackBody {
  /** 1 (poor) to 5 (great). */
  rating: 1 | 2 | 3 | 4 | 5
  text?: string
  /** Which app it came from, and its version, to follow up on a bug. */
  app: AppKind
  appVersion?: string
}

export interface Feedback {
  id: string
  rating: number
  text: string | null
  app: AppKind
  appVersion: string | null
  user: { id: string; name: string; msisdn: string }
  createdAt: string
}

export interface ContactSettings {
  /** Call centre number as dialled (e.g. 199 or +26622000000). */
  phone: string
  /** WhatsApp number in international form (+266…), or empty for none. */
  whatsapp: string
  email: string
  website: string
  /** The link shared by Me › Share the app (an app store page or a download page). */
  shareLink: string
}

/** Placeholders until ETL confirms the real ones (edit in the portal: Settings › Contact us). */
export const CONTACT_DEFAULTS: ContactSettings = {
  phone: '199',
  whatsapp: '',
  email: 'ecocash@etl.co.ls',
  website: 'https://www.etl.co.ls',
  shareLink: 'https://www.etl.co.ls/ecocash',
}

// ---------- Saved bills, saved recipients and stop orders ----------
//
// Saved bills: an account at a biller kept with a nickname ("Home" for an LEC meter), up to MAX_SAVED_PER_BILLER per
// biller, so the next payment is a tap. `target` is 'lec' (the app's LEC prepaid tokens) or 'service:<id>' (a Pay bill
// biller). GET/POST /v1/saved-bills, DELETE /v1/saved-bills/:id.
// Saved recipients: EcoCash numbers kept with a nickname. GET/POST /v1/saved-recipients, DELETE /v1/saved-recipients/:id.
// Stop orders: a payment the server makes by itself on a set day (monthly on a date, or weekly on a weekday) to a saved
// bill or a saved recipient. Confirmed once with the PIN. Short of money: tried again the next day, then missed (the
// person is told either way). GET/POST /v1/stop-orders, PUT /v1/stop-orders/:id { status }, DELETE /v1/stop-orders/:id,
// GET /v1/stop-orders/:id/runs.

export const MAX_SAVED_PER_BILLER = 5
export const MAX_SAVED_RECIPIENTS = 20
export const MAX_STOP_ORDERS = 20

export interface SavedBill {
  id: string
  /** 'lec' or 'service:<service id>'. */
  target: string
  account: string
  nickname: string
  /** The biller's name, icon and logo, for lists. */
  billerName: LocalizedText
  icon: string
  color: string
  image?: string
  createdAt: string
}
export interface SavedBillBody { target: string; account: string; nickname: string }

export interface SavedRecipient {
  id: string
  /** Who the number belongs to on EcoCash. */
  user: PublicUser
  /** The person's own name for them ("Mom"); empty: their EcoCash name is shown. */
  nickname: string
  createdAt: string
}
export interface SavedRecipientBody { msisdn: string; nickname?: string }

export type StopOrderFrequency = 'monthly' | 'weekly'
export type StopOrderStatus = 'active' | 'paused' | 'ended'

export interface StopOrder {
  id: string
  kind: 'bill' | 'send'
  savedBillId?: string
  recipientId?: string
  /** What it pays, e.g. "LEC · Home" or "Mom (+266 62•• ••21)". */
  label: string
  amount: number
  frequency: StopOrderFrequency
  /** monthly: day of the month 1–28, or 0 for the last day. weekly: 0 Sunday … 6 Saturday. */
  day: number
  /** The next payment date (YYYY-MM-DD, Maseru). */
  nextRun: string
  /** The last payment date allowed (YYYY-MM-DD), if any. */
  endDate?: string
  /** Payments left, when it was set up for a number of payments. */
  remaining?: number
  status: StopOrderStatus
  /** The last attempt: paid, failed (missed), or retrying tomorrow (short of money). */
  last?: { at: string; status: 'paid' | 'failed' | 'retrying'; error?: string }
  note?: string
  createdAt: string
}

export interface StopOrderBody {
  kind: 'bill' | 'send'
  savedBillId?: string
  recipientId?: string
  amount: number
  frequency: StopOrderFrequency
  day: number
  endDate?: string
  /** Stop after this many payments. */
  payments?: number
  note?: string
  pin: string
}

export interface StopOrderRun { id: string; dueOn: string; at: string; status: 'paid' | 'failed' | 'retrying'; amount: number; reference?: string; error?: string }

const ymd = (d: Date) => d.toISOString().slice(0, 10)
/**
 * The first payment date on or after `from` (YYYY-MM-DD) for a schedule. Monthly day 0 is the last day of the month;
 * days above 28 aren't allowed (not every month has them).
 */
export function nextStopOrderDate(frequency: StopOrderFrequency, day: number, from: string): string {
  const d = new Date(`${from}T00:00:00Z`)
  if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + ((day - d.getUTCDay() + 7) % 7))
    return ymd(d)
  }
  const inMonth = (y: number, m: number) => (day === 0 ? new Date(Date.UTC(y, m + 1, 0)) : new Date(Date.UTC(y, m, day)))
  const here = inMonth(d.getUTCFullYear(), d.getUTCMonth())
  return ymd(here >= d ? here : inMonth(d.getUTCFullYear(), d.getUTCMonth() + 1))
}

// ---------- SIM swap (/admin/v1/users/:id/sim-swaps, POST /v1/hooks/sim-swap) ----------
// Econet reports when a number moves to a new SIM. For a while after (the sim_swap risk rule's hours), money leaving
// EcoCash and large payments are stopped, and setting up the wallet on a new phone is refused, until staff check the
// owner in person ("clear"). The owner's bound phone gets a security alert. Until Econet is connected, staff simulate
// swaps in the portal.

export interface SimSwapEvent {
  id: string
  swappedAt: string
  /** network = Econet; simulated = the portal (test); device = the bound phone saw its EcoCash SIM replaced or taken out. */
  source: 'network' | 'simulated' | 'device'
  receivedAt: string
  clearedAt: string | null
  /** Staff email, or 'phone' when the same SIM card came back. */
  clearedBy: string | null
  note: string | null
  /** What the phone saw (device rows). */
  detail?: string | null
}
/** GET /admin/v1/users/:id/sim-swaps */
export interface SimSwapStatus {
  /** The latest swap, as the network reports it now. */
  lastSwapAt: string | null
  /** Payments are held (rule on, swap within its hours, not cleared). */
  held: boolean
  /** End of the payment hold, when held. */
  heldUntil: string | null
  /** New-phone setup is refused until this time (when in the future). */
  setupBlockedUntil: string | null
  /** Staff cleared the swaps up to this time. */
  clearedAt: string | null
  /** No real network source yet: the portal may simulate swaps. */
  simulated: boolean
  events: SimSwapEvent[]
}
/** POST /admin/v1/users/:id/sim-swaps/simulate (mock source only) */
export interface SimSwapSimulateBody { hoursAgo?: number }
/** POST /admin/v1/users/:id/sim-swaps/clear: staff checked the owner in person. */
export interface SimSwapClearBody { note: string }
/** POST /v1/hooks/sim-swap (Econet), header x-webhook-secret. */
export interface SimSwapHookBody { msisdn: string; swappedAt: string }

/**
 * The app's SIM watch (Android): the bound phone compares its SIMs with the one EcoCash was set up with, each time
 * the app comes to the front. It reports a change once (and 'sim_ok' when the same SIM card is back).
 * - sim_changed: a different SIM card is where the EcoCash SIM was (Android gives each card its own id)
 * - sim_removed: the EcoCash SIM is not in the phone
 * - no_service: the EcoCash SIM is in but has had no network for `minutes` (what a victim's phone sees after a swap)
 */
export type SimSignal = 'sim_changed' | 'sim_removed' | 'no_service' | 'sim_ok'
/** POST /v1/me/sim-signal */
export interface SimSignalBody {
  signal: SimSignal
  /** When the phone first saw it. */
  since: string
  /** no_service: for how long, in minutes. */
  minutes?: number
  sims: { slot: number; mcc: string | null; mnc: string | null; carrier: string | null; inService: boolean | null }[]
}
/** POST /v1/me/sim-signal and GET /v1/me/sim-swap */
export interface SimSignalResult {
  /** Econet's network confirmed a recent swap. */
  confirmed: boolean
  /** Money leaving EcoCash and large payments are held. */
  held: boolean
  heldUntil: string | null
  /** A swap this phone reported is still open (the SIM isn't back and staff haven't cleared it). */
  deviceOpen: boolean
}
/** No network for this long before the app warns and reports it. Placeholder until ETL decides. */
export const SIM_NO_SERVICE_MINUTES = 30

// ---------- security (CBL/LCA DFS Security Guidelines) ----------

/** The terms of use and privacy notice a customer accepts when setting up a phone (3.2.5); bump when the text changes. */
export const TERMS_VERSION = '2026-11-draft'

/** POST /v1/auth/report-lost (no session): sign every phone out of this wallet. The wallet's PIN proves it is the owner. */
export interface ReportLostBody { msisdn: string; pin: string }

/**
 * POST /v1/me/pay-biometric { pin } → { token }: fingerprint or face for payments. The app keeps the token in the
 * phone's keystore behind the biometric prompt (expo-secure-store requireAuthentication) and sends it instead of the PIN.
 * DELETE /v1/me/pay-biometric turns it off. New fingerprints on the phone make the stored token unreadable.
 */
export interface PayBiometricToken { token: string }
/** The PIN field accepts a payment biometric token: "B." + 43 characters. */
export const PAY_BIOMETRIC_PREFIX = 'B.'

/** Sign-in and PIN events, for staff to review (guidelines 3.2.5b-vi). GET /admin/v1/users/:id/auth-events */
export type AuthEventKind =
  | 'login' | 'login_failed' | 'pin_wrong' | 'pin_locked' | 'idle_signout' | 'expired_signout'
  | 'reported_lost' | 'device_removed' | 'pay_biometric_on' | 'pay_biometric_off' | 'rate_limited'
  | 'unusual_context' | 'device_mismatch' | 'unlock_failed' | 'pin_ok' | 'auth_attack' | 'sim_signal'
  | 'codes_email_on' | 'codes_email_off'
export interface AuthEvent { id: string; kind: AuthEventKind; app: string | null; ip: string | null; detail: string | null; createdAt: string }
export const AUTH_EVENT_LABEL: Record<AuthEventKind, string> = {
  login: 'Signed in',
  login_failed: 'Sign-in refused',
  pin_wrong: 'Wrong PIN',
  pin_locked: 'PIN locked',
  idle_signout: 'Signed out after no use',
  expired_signout: 'Session expired',
  reported_lost: 'Phone reported lost',
  device_removed: 'Phone removed by the customer',
  pay_biometric_on: 'Fingerprint for payments turned on',
  pay_biometric_off: 'Fingerprint for payments turned off',
  rate_limited: 'Too many attempts',
  unusual_context: 'Unusual phone or place',
  device_mismatch: 'Phone details did not match: set up again',
  unlock_failed: 'App unlock refused',
  pin_ok: 'PIN checked',
  auth_attack: 'Part of a sign-in attack (many wallets, one address)',
  sim_signal: 'Phone reported a SIM change or no network',
  codes_email_on: 'Sign-in codes by email turned on (travelling)',
  codes_email_off: 'Sign-in codes by email turned off',
}

/**
 * The phone's context, sent by the apps with every request (header x-device-context: base64url JSON) so the server
 * can bind on more than one property and flag a bound phone that suddenly looks or sits elsewhere (DFS guidelines
 * 3.2.3a/b). Location only when the person already allowed it, rounded to about 10 km; never asked for here.
 */
export interface DeviceContext {
  net: 'cellular' | 'wifi' | 'other' | 'none'
  /** Mobile network name of the default SIM, when known. */
  carrier?: string | null
  /** Screen in physical pixels, "1080x2340". */
  screen: string
  /** "android 15" */
  os: string
  model: string
  /** IANA time zone, e.g. Africa/Maseru. */
  tz: string
  /** [lat, lng] rounded to 0.1°, when location permission was already given. */
  loc?: [number, number] | null
  /** On Wi-Fi: whether the network has a password (open = anyone nearby can join or imitate it). */
  wifi?: 'open' | 'secured' | null
}
export const DEVICE_CONTEXT_HEADER = 'x-device-context'
/**
 * Set on a response when the bound phone's request came over a network it hasn't used before (a new address range);
 * the app then asks the person before continuing (DFS guidelines 3.2.4i).
 */
export const NETWORK_NEW_HEADER = 'x-network-new'
/** SMS codes end with this app's hash line so Android can hand the code to the app (SMS Retriever, guidelines 3.2.5b-iv). */
export const SMS_CODE_PREFIX = '<#>'

/** What the server learned about a bound phone (portal: user panel › Phones). */
export interface DeviceProfileSummary { screens: string[]; nets: string[]; carriers: string[]; timeZones: string[]; areas: number; seen: number }

/** GET /admin/v1/auth-monitor?days=7: sign-in monitoring for staff (DFS guidelines 3.2.5b-vi). */
export interface AuthMonitor {
  days: number
  /** Per Maseru day, newest first: counts per event kind. */
  byDay: { day: string; counts: Partial<Record<AuthEventKind, number>> }[]
  totals: Partial<Record<AuthEventKind, number>>
  /** Addresses with the most refused sign-ins, and how many wallets they tried. */
  topAddresses: { ip: string; failures: number; wallets: number; lastAt: string }[]
  /** Wallets with the most wrong PINs and locks. */
  topWallets: { user: PublicUser; failures: number; locks: number; lastAt: string }[]
  recent: (AuthEvent & { user: PublicUser | null; admin: string | null })[]
}
