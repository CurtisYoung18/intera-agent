// POST /api/auth/switch-org — staff-only org switch (re-issues session for a new org)
//
// Body: { orgId }
// Only sessions with role==='staff' may switch. Customers are locked to their org → 403.

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
    if (session.role !== 'staff') {
      return NextResponse.json({ error: 'Forbidden — only staff may switch organizations' }, { status: 403 })
    }

    const { orgId } = await req.json()
    if (!orgId || typeof orgId !== 'string') {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const token = await signSession({ role: 'staff', orgId: org.id })
    if (!token) {
      return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
    }
    const res = NextResponse.json({ ok: true, orgId: org.id, name: org.name })
    res.cookies.set(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE_S,
    })
    return res
  } catch (err) {
    console.error('[Auth] switch-org error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
