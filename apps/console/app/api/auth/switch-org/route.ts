// POST /api/auth/switch-org — Switch active organization (re-issues session for new org)
//
// Body: { orgId }
// Only users who have a Membership in the target org may switch. Viewers are
// allowed to switch between orgs they belong to.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getSession } from '@/lib/auth'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { orgId } = await req.json()
    if (!orgId || typeof orgId !== 'string') {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    // Verify the user has a Membership in the target org
    const membership = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: session.userId, orgId } },
      include: { org: true },
    })

    if (!membership) {
      return NextResponse.json({ error: 'You are not a member of this organization' }, { status: 403 })
    }

    const token = await signSession({
      userId: session.userId,
      orgId: membership.orgId,
      role: membership.role as 'owner' | 'admin' | 'operator' | 'viewer',
    })

    if (!token) {
      return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
    }

    const res = NextResponse.json({
      ok: true,
      userId: session.userId,
      orgId: membership.orgId,
      role: membership.role,
      name: membership.org.name,
    })
    res.cookies.set(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE_S,
    })
    return res
  } catch (err) {
    console.error('[Auth] switch-org error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
