// GET /api/auth/google — Initiate Google OAuth flow.
// Redirects directly to Google's authorization page (302).

import { NextResponse } from 'next/server'
import { signCsrfCookie } from '@/lib/auth/google'

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Google OAuth is not configured' },
      { status: 500 },
    )
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  const nonce = crypto.randomUUID()

  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('access_type', 'online')
  authUrl.searchParams.set('prompt', 'select_account')

  // Sign the CSRF state cookie first, then set state in the URL
  const state = crypto.randomUUID()
  const csrfValue = await signCsrfCookie(state)
  if (!csrfValue) {
    return NextResponse.json(
      { error: 'Server session secret not configured' },
      { status: 500 },
    )
  }

  authUrl.searchParams.set('state', state)

  // Redirect to Google with the CSRF cookie set
  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set('google_oauth_state', csrfValue, {
    path: '/api/auth/google',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
  })

  return res
}
