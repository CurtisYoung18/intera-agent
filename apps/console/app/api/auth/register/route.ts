// POST /api/auth/register — Invite-only registration
//
// Body: { email, password, name, token }
//
// Accepts both email-bound invitations and share links (email-less).
// Share links allow any email and track usage via maxUses/useCount.

import { NextRequest, NextResponse } from 'next/server'
import { hashSync } from 'bcryptjs'
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

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    const rl = checkRateLimit({ key: `register:${ip}`, max: 10, windowSec: 300 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please wait before trying again.' },
        { status: 429 },
      )
    }

    const { email, password, name, token } = await req.json()
    const em = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const pwd = typeof password === 'string' ? password : ''
    const displayName = typeof name === 'string' ? name.trim() : null
    const tok = typeof token === 'string' ? token : ''

    if (!em || !pwd || !tok) {
      return NextResponse.json({ error: 'Email, password, and token are required' }, { status: 400 })
    }

    if (pwd.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // Check if invitation exists and is valid
    const invitation = await prisma.invitation.findUnique({ where: { token: tok } })

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation token' }, { status: 404 })
    }

    const isShareLink = invitation.email === null

    if (!isShareLink && invitation.email !== em) {
      return NextResponse.json({ error: 'Email does not match the invitation' }, { status: 403 })
    }

    if (invitation.state !== 'pending') {
      return NextResponse.json({ error: 'Invitation has already been used or expired' }, { status: 410 })
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { state: 'expired' },
      })
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    // Share link: check usage limits
    if (isShareLink && invitation.maxUses != null && invitation.useCount >= invitation.maxUses) {
      return NextResponse.json({ error: 'This share link has reached its maximum number of uses' }, { status: 410 })
    }

    // Check if a user with this email already exists
    const existingUser = await prisma.user.findUnique({ where: { email: em } })
    if (existingUser) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
    }

    const passwordHash = hashSync(pwd, 10)

    // Create user, membership, mark invitation accepted (or increment useCount for share links)
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: em,
          name: displayName,
          passwordHash,
        },
      })

      await tx.membership.create({
        data: {
          userId: user.id,
          orgId: invitation.orgId,
          role: invitation.role,
        },
      })

      const newUseCount = invitation.useCount + 1
      const reachedLimit = isShareLink && invitation.maxUses != null && newUseCount >= invitation.maxUses

      await tx.invitation.update({
        where: { id: invitation.id },
        data: isShareLink
          ? { useCount: newUseCount, state: reachedLimit ? 'accepted' : 'pending' }
          : { state: 'accepted' },
      })

      return user
    })

    const tokenStr = await signSession({
      userId: result.id,
      orgId: invitation.orgId,
      role: invitation.role as 'owner' | 'admin' | 'operator' | 'viewer',
    })

    if (!tokenStr) {
      return NextResponse.json(
        { error: 'Server session secret not configured' },
        { status: 500 },
      )
    }

    const res = NextResponse.json({
      ok: true,
      userId: result.id,
      orgId: invitation.orgId,
      role: invitation.role,
      name: result.name,
    })
    res.cookies.set(SESSION_COOKIE, tokenStr, COOKIE_OPTS)
    return res
  } catch (err) {
    console.error('[Auth] register error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
