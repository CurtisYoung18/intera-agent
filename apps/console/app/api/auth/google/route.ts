// GET /api/auth/google — Initiate Google OAuth flow
// Migrated to defineRoute (G1 contract seam).

import { NextRequest, NextResponse } from 'next/server'
import { defineRoute, RouteError } from '@/lib/api/define-route'
import { signCsrfCookie } from '@/lib/auth/google'

export async function GET(req: NextRequest) {
  // Needs req to read ?invite= query param
  const inviteToken = req.nextUrl.searchParams.get('invite')

  return defineRoute({
    method: 'GET',
    auth: 'none',
    async handler() {
      const clientId = process.env.GOOGLE_CLIENT_ID
      const redirectUri = process.env.GOOGLE_REDIRECT_URI
      if (!clientId || !redirectUri) throw new RouteError('internal', 'Google OAuth is not configured')

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      const nonce = crypto.randomUUID()

      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid email profile')
      authUrl.searchParams.set('nonce', nonce)
      authUrl.searchParams.set('access_type', 'online')
      authUrl.searchParams.set('prompt', 'select_account')

      const state = crypto.randomUUID()
      const csrfValue = inviteToken ? `${state}:${inviteToken}` : state
      const csrfSign = await signCsrfCookie(csrfValue)
      if (!csrfSign) throw new RouteError('internal', 'Server session secret not configured')

      authUrl.searchParams.set('state', state)

      const res = NextResponse.redirect(authUrl.toString())
      res.cookies.set('google_oauth_state', csrfSign, {
        path: '/api/auth/google', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 10,
      })
      return res
    },
  })(req)
}
