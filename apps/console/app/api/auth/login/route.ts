// POST /api/auth/login — Console login (issues a SIGNED session cookie)
//
// Body: { email, password }
//
// Looks up User by email, bcrypt-compares passwordHash, finds the user's primary
// Membership (highest role), and signs a session with { userId, orgId, role }.
//
// STAFF_PASSWORD is only used during seed to bootstrap the first owner user; it is
// NOT accepted at runtime.

import { NextRequest, NextResponse } from 'next/server'
import { compareSync } from 'bcryptjs'
import { prisma } from '@intera/shared/prisma'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge: SESSION_MAX_AGE_S,
}

async function issue(userId: string, orgId: string, role: string, body: Record<string, unknown>) {
  const token = await signSession({ userId, orgId, role: role as 'owner' | 'admin' | 'operator' | 'viewer' })
  if (!token) {
    return NextResponse.json(
      { error: 'Server session secret not configured' },
      { status: 500 },
    )
  }
  const res = NextResponse.json(body)
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
  // Clear the legacy plaintext cookies if present (no longer trusted).
  res.cookies.set('intera_org_id', '', { path: '/', maxAge: 0 })
  res.cookies.set('intera_auth', '', { path: '/', maxAge: 0 })
  return res
}

/** Pick the user's primary membership — highest-role then earliest invited. */
function primaryMembershipRole(user: {
  memberships: Array<{ orgId: string; role: string }>
}): { orgId: string; role: string } | null {
  const sorted = [...user.memberships].sort((a, b) => {
    const rank: Record<string, number> = { owner: 4, admin: 3, operator: 2, viewer: 1 }
    return (rank[b.role] ?? 0) - (rank[a.role] ?? 0)
  })
  return sorted[0] ?? null
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 20 attempts per minute per IP
    const ip = clientIp(req)
    const rl = checkRateLimit({ key: `login:${ip}`, max: 20, windowSec: 60 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait before trying again.' },
        { status: 429 },
      )
    }

    const { email, password } = await req.json()
    const pwd = typeof password === 'string' ? password : ''
    const em = typeof email === 'string' ? email.trim().toLowerCase() : ''

    if (!em || !pwd) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email: em },
      include: { memberships: { select: { orgId: true, role: true } } },
    })

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    if (!compareSync(pwd, user.passwordHash)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Role lives on Membership; deny if the user has no memberships
    const primary = primaryMembershipRole(user)

    if (!primary) {
      return NextResponse.json(
        { error: 'No organization membership — request an invitation' },
        { status: 403 },
      )
    }

    return issue(user.id, primary.orgId, primary.role, {
      ok: true,
      userId: user.id,
      orgId: primary.orgId,
      role: primary.role,
      name: user.name,
    })
  } catch (err) {
    console.error('[Auth] login error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
