// Unified API envelope — every route returns ApiOk<T> | ApiErr.
// FE apiClient branches on `ok` to type-narrow the response.

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'internal'

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  error: {
    code: ErrorCode
    message: string
    fields?: Record<string, string> // per-field validation errors
  }
}

export type ApiEnvelope<T> = ApiOk<T> | ApiErr

// ── Status map: ErrorCode → HTTP status ──
export const errorCodeToStatus: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 400,
  rate_limited: 429,
  internal: 500,
}

/** Convenience: build a typed ApiErr envelope. */
export function apiErr(code: ErrorCode, message: string, fields?: Record<string, string>): ApiErr {
  return { ok: false, error: { code, message, fields } }
}

/** Convenience: build a typed ApiOk envelope (default 200). */
export function apiOk<T>(data: T): ApiOk<T> {
  return { ok: true, data }
}

/** Convenience: build an ApiOk with a creator-intent hint.
 *  defineRoute uses this to return 201 instead of 200 for POST. */
export function apiCreated<T>(data: T): ApiOk<T> & { __status: 201 } {
  return { ok: true, data, __status: 201 as const } as any
}
