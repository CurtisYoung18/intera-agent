// POST /api/auth/login — Console login (issues a SIGNED session cookie)
//
// Body:
//   { mode: 'staff',    password }              → staff session (may switch orgs)
//   { mode: 'customer', orgId, password }       → customer session locked to orgId
//
// Staff auth: single shared STAFF_PASSWORD env (constant-time compare).
// Customer auth: per-org bcrypt password. Orgs without a password CANNOT be logged
// into as a customer (staff access those via staff login) — closes the password-less hole.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { compareSync } from 'bcryptjs'
import { prisma } from '@intera/shared/prisma'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'

const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge: SESSION_MAX_AGE_S,
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

async function issue(role: 'staff' | 'customer', orgId: string, body: Record<string, unknown>) {
  const token = await signSession({ role, orgId })
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

export async function POST(req: NextRequest) {
  try {
    const { mode, orgId, password } = await req.json()
    const pwd = typeof password === 'string' ? password : ''

    // ── Staff login ──
    if (mode === 'staff') {
      const staffPw = process.env.STAFF_PASSWORD
      if (!staffPw) {
        return NextResponse.json({ error: 'Staff login is not configured' }, { status: 500 })
      }
      if (!pwd || !constantTimeEqual(pwd, staffPw)) {
        return NextResponse.json({ error: 'Invalid staff password' }, { status: 401 })
      }
      // Staff start at the default org; can switch via /api/auth/switch-org.
      return issue('staff', 'default', { ok: true, role: 'staff', orgId: 'default' })
    }

    // ── Customer login ──
    if (!orgId || typeof orgId !== 'string') {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }
    if (!org.password) {
      return NextResponse.json(
        { error: 'This organization has no password set. Contact your administrator.' },
        { status: 403 },
      )
    }
    if (!pwd || !compareSync(pwd, org.password)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
    return issue('customer', org.id, { ok: true, role: 'customer', orgId: org.id, name: org.name })
  } catch (err) {
    console.error('[Auth] login error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
