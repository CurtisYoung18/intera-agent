// Edge middleware — the console access gate.
//
// Verifies the signed `intera_session` cookie and:
//   - Page routes (/admin, /ops): redirect to /login when no valid session.
//   - Cookie-only API routes (/api/admin, /api/ops, /api/chats, /api/users):
//     return 401 JSON when no valid session.
//
// Dual-auth routes (/api/messages, /api/livechat, /api/internal, /api/cases,
// /api/human-tasks) are NOT gated here — they authenticate via API key / internal
// secret / per-case org check, and their cookie path is independently secured by
// getActiveOrgId() reading the verified session. We must not block API-key callers.

import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

const PAGE_PREFIXES = ['/admin', '/ops']
const API_GATE_PREFIXES = ['/api/admin', '/api/ops', '/api/chats', '/api/users']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySessionToken(token)

  if (session) return NextResponse.next()

  // No valid session ──────────────────────────────────────────
  if (API_GATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/ops/:path*',
    '/api/admin/:path*',
    '/api/ops/:path*',
    '/api/chats/:path*',
    '/api/users/:path*',
  ],
}
