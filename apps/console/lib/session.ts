// Signed session — replaces the old plaintext `intera_org_id` / `intera_auth` cookies.
//
// The session is a compact HMAC-SHA256 JWT (no external dep), verifiable in BOTH
// the Edge middleware and Node route handlers via Web Crypto (`crypto.subtle`).
//
// Payload: { role: 'staff' | 'customer', orgId, iat, exp }
//   - staff:    may switch to any org (orgId is the currently-selected org)
//   - customer: orgId is fixed to their organization; switching is rejected
//
// SECURITY: the secret MUST be set via SESSION_SECRET env. If unset, signing/
// verifying fail closed (no valid session can be produced), so a missing secret
// locks the console rather than silently accepting forged cookies.

export const SESSION_COOKIE = 'intera_session'
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7 // 7 days

export type SessionRole = 'staff' | 'customer'

export interface SessionPayload {
  role: SessionRole
  orgId: string
  iat: number
  exp: number
}

// ── base64url helpers (Uint8Array <-> string) ──
function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s))
}
function b64urlDecodeToStr(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function getSecret(): string | null {
  const s = process.env.SESSION_SECRET
  return s && s.length >= 16 ? s : null
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

/** Constant-time comparison of two base64url strings. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Sign a session token. Returns null if SESSION_SECRET is unset (fail closed). */
export async function signSession(input: { role: SessionRole; orgId: string }): Promise<string | null> {
  const secret = getSecret()
  if (!secret) {
    console.error('[session] SESSION_SECRET is not set — cannot issue sessions') // operational-critical: log to stderr directly
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    role: input.role,
    orgId: input.orgId,
    iat: now,
    exp: now + SESSION_MAX_AGE_S,
  }
  const header = b64urlEncodeStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64urlEncodeStr(JSON.stringify(payload))
  const signingInput = `${header}.${body}`
  const sig = b64urlEncode(await hmac(signingInput, secret))
  return `${signingInput}.${sig}`
}

/** Verify a session token. Returns the payload or null (invalid sig / expired / tampered). */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null
  const secret = getSecret()
  if (!secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = b64urlEncode(await hmac(`${header}.${body}`, secret))
  if (!timingSafeEqualStr(sig, expected)) return null
  try {
    const payload = JSON.parse(b64urlDecodeToStr(body)) as SessionPayload
    if (!payload || (payload.role !== 'staff' && payload.role !== 'customer')) return null
    if (typeof payload.orgId !== 'string' || !payload.orgId) return null
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
