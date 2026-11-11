import type { ErrorCode, Maintenance } from '../../shared/api'

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  WRONG_PIN: 403,
  SUSPENDED: 403,
  WRONG_APP: 403,
  WRONG_ROLE: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_REGISTERED: 404,
  CONFLICT: 409,
  INSUFFICIENT_FUNDS: 422,
  LIMIT_EXCEEDED: 422,
  CARD_DECLINED: 422,
  NOT_ECONET: 403,
  PROFILE_NEEDED: 404,
  DEVICE_BLOCKED: 403,
  ID_MISMATCH: 422,
  KYC_REQUIRED: 403,
  RISK_BLOCKED: 403,
  PIN_LOCKED: 423,
  MAINTENANCE: 503,
  NETWORK: 500,
  UNKNOWN: 500,
}

/** Thrown anywhere in the server; rendered as the contract's ApiError shape. */
export class AppError extends Error {
  readonly statusCode: number
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly maintenance?: Maintenance,
    /** PIN_LOCKED only: the wallet whose PIN was locked by this very attempt (sends a security alert). */
    readonly lockedUserId?: string,
  ) {
    super(message)
    this.statusCode = STATUS[code]
  }
}

export const notFound = (what = 'Not found') => new AppError('NOT_FOUND', what)
export const validation = (msg: string) => new AppError('VALIDATION', msg)
export const conflict = (msg: string) => new AppError('CONFLICT', msg)
export const forbidden = (msg = 'Not allowed') => new AppError('FORBIDDEN', msg)
