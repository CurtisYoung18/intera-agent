// GET /api/auth/google — Initiate Google OAuth flow.
//
// Generates a Google OAuth 2.0 authorization URL with:
//  - client_id from GOOGLE_CLIENT_ID env
//  - redirect_uri from GOOGLE_REDIRECT_URI env
//  - response_type=code (authorization code flow)
//  - scope=openid email profile
//  - state=<random CSRF token, stored in a short-lived signed cookie>
//  - nonce=<random value>
//
// Returns { url: "https://accounts.google.com/o/oauth2/v2/auth?..." }

import { NextResponse } from 'next/server'
import { setCsrfStateCookie } from '@/lib/auth/google'

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Google OAuth is not configured' },
      { status: 500 },
    )
  }

  // Build the authorization URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  // Generate nonce (for replay protection in id_token)
  const nonce = crypto.randomUUID()

  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('access_type', 'online')
  // Prompt=select_account ensures the user can choose which Google account to use
  authUrl.searchParams.set('prompt', 'select_account')

  const res = NextResponse.json({ url: authUrl.toString() })

  // Set CSRF state cookie — signCsrfCookie embeds the state in a signed cookie.
  // The state is also embedded in the URL so Google returns it in the callback.
  const state = await setCsrfStateCookie(res)
  if (state === null) {
    return NextResponse.json(
      { error: 'Server session secret not configured' },
      { status: 500 },
    )
  }

  // Append state to the URL AFTER signing the cookie (so both match)
  // We need to re-build because we already created the JSON body
  authUrl.searchParams.set('state', state)

  return NextResponse.json({ url: authUrl.toString() })
}
