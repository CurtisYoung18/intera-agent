// Google OAuth / OpenID Connect helpers.
//
// Provides:
//  - signCsrfCookie / verifyCsrfCookie: short-lived signed cookie for CSRF state
//  - exchangeCodeForTokens: server-side authorization code → token exchange
//  - verifyGoogleIdToken: full id_token verification (JWKS sig, aud, iss, exp, email_verified)
//  - GoogleIdTokenClaims: typed claims extracted from verified id_token

// ── CSRF state cookie ──
// HMAC-signed cookie with 10-minute TTL. Prevents CSRF on the OAuth callback.

import { cookies } from 'next/headers'

const CSRF_COOKIE = 'google_oauth_state'
const CSRF_MAX_AGE_S = 60 * 10 // 10 minutes

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecodeToUint8(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
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

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Sign CSRF state into a short-lived cookie value: `${payload}.${sig}` */
export async function signCsrfCookie(state: string): Promise<string | null> {
  const secret = getSecret()
  if (!secret) return null
  const now = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomUUID()
  const payload = JSON.stringify({ s: state, n: nonce, iat: now, exp: now + CSRF_MAX_AGE_S })
  const body = b64urlEncode(new TextEncoder().encode(payload))
  const sig = b64urlEncode(await hmac(body, secret))
  return `${body}.${sig}`
}

/** Verify CSRF state cookie. Returns the stored state value or null. */
export async function verifyCsrfCookie(value: string | undefined): Promise<string | null> {
  if (!value) return null
  const secret = getSecret()
  if (!secret) return null
  const parts = value.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = b64urlEncode(await hmac(body, secret))
  if (!timingSafeEqualStr(sig, expected)) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToUint8(body)))
    if (typeof payload.s !== 'string' || !payload.s) return null
    if (typeof payload.n !== 'string' || !payload.n) return null
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload.s
  } catch {
    return null
  }
}

/** Set the CSRF state cookie on a response. */
export async function setCsrfStateCookie(
  res: { cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => void } },
): Promise<string | null> {
  const state = crypto.randomUUID()
  const value = await signCsrfCookie(state)
  if (!value) return null
  res.cookies.set(CSRF_COOKIE, value, {
    path: '/api/auth/google',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: CSRF_MAX_AGE_S,
  })
  return state
}

/** Read the CSRF state cookie from the incoming request. */
export async function getCsrfStateCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const raw = cookieStore.get(CSRF_COOKIE)?.value
    return await verifyCsrfCookie(raw)
  } catch {
    return null
  }
}

/** Clear the CSRF state cookie. */
export function clearCsrfStateCookie(
  res: { cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => void } },
): void {
  res.cookies.set(CSRF_COOKIE, '', { path: '/api/auth/google', maxAge: 0 })
}

// ── Google token exchange ──

export interface TokenExchangeResult {
  id_token: string
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

/** Exchange authorization code for tokens via Google token endpoint. */
export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth environment variables are not configured')
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Google token exchange failed: ${res.status} ${errText}`)
  }

  const data = await res.json()
  if (!data.id_token) {
    throw new Error('Google token response missing id_token')
  }

  return {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
  }
}

// ── id_token verification ──

export interface GoogleIdTokenClaims {
  sub: string // Google's stable user ID (googleSub)
  email: string
  email_verified: boolean
  name?: string
  picture?: string
  iss: string
  aud: string
  exp: number
  iat: number
}

interface GoogleJwk {
  kty: string
  kid: string
  n: string
  e: string
  use?: string
  alg?: string
}

/** Base64url-decode a string to Uint8Array. */
function b64urlDecode(s: string): Uint8Array {
  return b64urlDecodeToUint8(s)
}

/** Convert a base64url string to a BigInt (for JWK modulus). */
function base64urlToBigInt(s: string): bigint {
  const bytes = b64urlDecode(s)
  let result = 0n
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i])
  }
  return result
}

/** Import a Google JWK as a CryptoKey for RS256 verification. */
async function importJwk(jwk: GoogleJwk): Promise<CryptoKey> {
  const algorithm: RsaHashedImportParams = {
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256',
  }

  // JWK format as expected by Web Crypto
  const keyData: JsonWebKey = {
    kty: 'RSA',
    n: jwk.n,
    e: jwk.e,
    alg: 'RS256',
    ext: false,
  }

  return crypto.subtle.importKey('jwk', keyData, algorithm, false, ['verify'])
}

// ── JWKS cache (1-hour TTL) ──
let jwksCache: { keys: GoogleJwk[]; expiresAt: number } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000

async function getGoogleJwks(): Promise<GoogleJwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs')
  if (!res.ok) throw new Error(`Failed to fetch Google JWKS: ${res.status}`)
  const { keys } = (await res.json()) as { keys: GoogleJwk[] }
  jwksCache = { keys, expiresAt: Date.now() + JWKS_TTL_MS }
  return keys
}

/** Fetch Google JWKS (cached) and find the key matching the given kid. */
async function fetchGoogleJwks(kid: string): Promise<CryptoKey> {
  const keys = await getGoogleJwks()
  const jwk = keys.find((k) => k.kid === kid)
  if (!jwk) {
    // Cache miss for this kid — clear cache and refetch (key may have rotated)
    jwksCache = null
    const freshKeys = await getGoogleJwks()
    const freshJwk = freshKeys.find((k) => k.kid === kid)
    if (!freshJwk) throw new Error(`Google JWK not found for kid: ${kid}`)
    return importJwk(freshJwk)
  }
  return importJwk(jwk)
}

/**
 * Verify a Google id_token and return its claims.
 *
 * Performs:
 *  1. JWKS signature verification (RS256)
 *  2. aud check (must match GOOGLE_CLIENT_ID)
 *  3. iss check (must be accounts.google.com or https://accounts.google.com)
 *  4. exp check (must not be expired)
 *  5. email_verified check (must be true)
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid id_token format')
  }

  const [headerB64, payloadB64, sigB64] = parts

  // Decode header to get kid and alg
  let header: { kid?: string; alg?: string }
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)))
  } catch {
    throw new Error('Invalid id_token header')
  }

  if (!header.kid) throw new Error('id_token header missing kid')
  if (header.alg !== 'RS256') throw new Error(`Unsupported id_token alg: ${header.alg}`)

  // Fetch JWKS and import the key
  const key = await fetchGoogleJwks(header.kid)

  // Verify signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const signature = b64urlDecode(sigB64)
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    key,
    new Uint8Array(signature),
    new Uint8Array(signingInput),
  )
  if (!valid) throw new Error('id_token signature verification failed')

  // Decode and validate payload
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)))
  } catch {
    throw new Error('Invalid id_token payload')
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured')

  // aud check
  if (payload.aud !== clientId) {
    throw new Error(`id_token aud mismatch: expected ${clientId}, got ${payload.aud}`)
  }

  // iss check
  const iss = payload.iss as string
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw new Error(`id_token iss invalid: ${iss}`)
  }

  // exp check
  const exp = payload.exp as number
  if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) {
    throw new Error('id_token has expired')
  }

  // email_verified check (CRITICAL)
  if (payload.email_verified !== true) {
    throw new Error('Google account email is not verified')
  }

  return {
    sub: payload.sub as string,
    email: (payload.email as string).toLowerCase(),
    email_verified: true,
    name: payload.name as string | undefined,
    picture: payload.picture as string | undefined,
    iss: payload.iss as string,
    aud: payload.aud as string,
    exp: payload.exp as number,
    iat: payload.iat as number,
  }
}
