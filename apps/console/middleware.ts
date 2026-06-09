// Edge middleware — the console access gate.
//
// Verifies the signed `intera_session` cookie and:
//   - Page routes (/admin, /ops, /build, /operate, /settings): redirect to /login when no valid session.
//   - Cookie-only API routes (/api/admin, /api/ops, /api/chats, /api/users):
//     return 401 JSON when no valid session.
//
// Dual-auth routes (/api/messages, /api/livechat, /api/internal, /api/cases,
// /api/human-tasks) are NOT gated here — they authenticate via API key / internal
// secret / per-case org check, and their cookie path is independently secured by
// getActiveOrgId() reading the verified session. We must not block API-key callers.

import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

const API_GATE_PREFIXES = ['/api/admin', '/api/ops', '/api/chats', '/api/users']
const AUTH_PAGE_PREFIXES = ['/admin', '/ops', '/build', '/operate', '/settings']

export function mapLegacyRoute(pathname: string): string | null {
  const trimmedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  const normalizedPathname = trimmedPath || '/'
  if (pathname === '/') {
    return null
  }
  if (normalizedPathname === '/admin') return '/build/release'
  if (normalizedPathname === '/ops') return '/operate/conversations'

  if (normalizedPathname === '/admin/playground') return '/build/pilot-lab'
  if (normalizedPathname === '/admin/model') return '/build/components/brain'
  if (normalizedPathname === '/admin/memory') return '/build/components/brain?mode=memory'
  if (normalizedPathname === '/admin/case-types') return '/build/components/procedures'
  if (normalizedPathname === '/admin/tools') return '/build/components/tools'
  if (normalizedPathname === '/admin/guardrails') return '/build/components/hooks'
  if (normalizedPathname === '/admin/hooks') return '/build/components/hooks'
  if (normalizedPathname === '/admin/knowledge') return '/build/components/knowledge'
  if (normalizedPathname === '/admin/integrations') return '/build/components/integrations'
  if (normalizedPathname === '/admin/organization') return '/settings/organization'
  if (normalizedPathname === '/admin/scenarios') return '/build/pilot-lab'
  if (normalizedPathname === '/admin/channels') return '/build/components/integrations'
  if (normalizedPathname.startsWith('/admin/channels/')) return '/build/components/integrations'
  if (normalizedPathname.startsWith('/admin/case-types/')) {
    const tail = normalizedPathname.slice('/admin/case-types/'.length)
    if (!tail) return '/build/components/procedures'
    return `/build/components/procedures/${encodeURIComponent(tail)}`
  }

  if (normalizedPathname === '/ops/chats') return '/operate/conversations'
  if (normalizedPathname.startsWith('/ops/chats/')) {
    const tail = normalizedPathname.slice('/ops/chats/'.length)
    if (!tail) return '/operate/conversations'
    return `/operate/conversations/${encodeURIComponent(tail)}`
  }
  if (normalizedPathname === '/ops/cases') return '/operate/conversations'
  if (normalizedPathname.startsWith('/ops/cases/')) {
    const tail = normalizedPathname.slice('/ops/cases/'.length)
    if (!tail) return '/operate/conversations'
    return `/operate/conversations/cases/${encodeURIComponent(tail)}`
  }
  if (normalizedPathname === '/ops/users') return '/operate/handoff'
  if (normalizedPathname.startsWith('/ops/users/')) {
    const tail = normalizedPathname.slice('/ops/users/'.length)
    if (!tail) return '/operate/handoff'
    return `/operate/handoff/${encodeURIComponent(tail)}`
  }
  if (normalizedPathname === '/ops/dashboards') return '/operate/handoff'
  if (normalizedPathname === '/ops/guide') return '/operate/conversations'

  return null
}

function redirectPreservingQuery(target: string, req: NextRequest): NextResponse {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const targetUrl = new URL(target, `${proto}://${host}`)
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value)
  })
  return NextResponse.redirect(targetUrl)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySessionToken(token)
  const legacyRedirect = mapLegacyRoute(pathname)
  if (legacyRedirect) {
    return redirectPreservingQuery(legacyRedirect, req)
  }

  // Root path — redirect with correct host via x-forwarded-host
  if (pathname === '/') {
    if (session) return redirectPreservingQuery('/build/release', req)
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const loginUrl = new URL(`/login`, `${proto}://${host}`)
    loginUrl.searchParams.set('next', '/build/release')
    return NextResponse.redirect(loginUrl)
  }

  if (session) return NextResponse.next()

  // No valid session ──────────────────────────────────────────
  if (API_GATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (AUTH_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const loginUrl = new URL(`${proto}://${host}/login`)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/ops/:path*',
    '/build/:path*',
    '/operate/:path*',
    '/settings/:path*',
    '/api/admin/:path*',
    '/api/ops/:path*',
    '/api/chats/:path*',
    '/api/users/:path*',
  ],
}
