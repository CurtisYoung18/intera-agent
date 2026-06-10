// GET /api/auth/google/callback — Google OAuth callback handler.
//
// Receives `code` and `state` from Google's redirect. Validates CSRF state,
// exchanges the code for tokens, verifies the id_token, then performs
// login-or-register logic:
//
//   1. Look up User by googleSub -> sign session, redirect to /build/pilot-lab
//   2. Look up User by email → link googleSub, sign session, redirect
//   3. Check for pending Invitation → create User + Membership, sign session
//   4. No Invitation + no Membership → 403 denied
//
// If the user has multiple orgs, redirects to /org-picker instead.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@intera/shared/prisma'
import { defineRoute } from '@/lib/api/define-route'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import {
  exchangeCodeForTokens,
  verifyGoogleIdToken,
  getCsrfStateCookie,
  clearCsrfStateCookie,
} from '@/lib/auth/google'

const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge: SESSION_MAX_AGE_S,
}

async function issueSession(
  userId: string,
  orgId: string,
  role: string,
  avatarUrl?: string,
): Promise<string | null> {
  return signSession({
    userId,
    orgId,
    role: role as 'owner' | 'admin' | 'operator' | 'viewer',
    avatarUrl,
  })
}

/** Accept pending invitations + create missing Memberships for an existing user. */
async function sweepPendingInvites(email: string, userId: string): Promise<void> {
  try {
    const pendingInvites = await prisma.invitation.findMany({
      where: { email, state: 'pending', expiresAt: { gt: new Date() } },
    })
    for (const invite of pendingInvites) {
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_orgId: { userId, orgId: invite.orgId } },
      }).catch(() => null)
      if (!existingMembership) {
        await prisma.membership.create({
          data: { userId, orgId: invite.orgId, role: invite.role },
        }).catch(() => { /* duplicate */ })
      }
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { state: 'accepted' },
      }).catch(() => {})
    }
  } catch {
    // Best-effort sweep — don't block login
  }
}

/** Redirect response with session cookie set and CSRF cookie cleared. */
function redirectWithSession(
  token: string,
  destination: string,
): NextResponse {
  const res = NextResponse.redirect(new URL(destination, process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'))
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
  // Clear legacy plaintext cookies
  res.cookies.set('intera_org_id', '', { path: '/', maxAge: 0 })
  res.cookies.set('intera_auth', '', { path: '/', maxAge: 0 })
  clearCsrfStateCookie(res)
  return res
}

function errorRedirect(message: string): NextResponse {
  const url = new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
  url.searchParams.set('error', encodeURIComponent(message))
  return NextResponse.redirect(url)
}

const querySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    return await defineRoute<z.infer<typeof querySchema>>({
      method: 'GET',
      auth: 'none',
      parseQuery: true,
      inputSchema: querySchema,
      async handler({ input }) {
    // 1. Extract query params
    const code = input.code
    const state = input.state
    const error = input.error

    if (error) {
      const errorDesc = input.error_description || error
      return errorRedirect(`Google authentication failed: ${errorDesc}`)
    }

    if (!code) {
      return errorRedirect('Missing authorization code from Google')
    }

    if (!state) {
      return errorRedirect('Missing state parameter')
    }

    // 2. Validate CSRF state (may include :inviteToken suffix for share links)
    const storedFull = await getCsrfStateCookie()
    if (!storedFull) {
      return errorRedirect('Invalid state parameter — possible CSRF attack')
    }
    const colonIdx = storedFull.indexOf(':')
    const storedState = colonIdx === -1 ? storedFull : storedFull.substring(0, colonIdx)
    const stateInviteToken = colonIdx === -1 ? null : storedFull.substring(colonIdx + 1) || null
    if (storedState !== state) {
      return errorRedirect('Invalid state parameter — possible CSRF attack')
    }

    // 3. Exchange code for tokens
    let idToken: string
    try {
      const tokens = await exchangeCodeForTokens(code)
      idToken = tokens.id_token
    } catch (err) {
      console.error('[Google OAuth] Token exchange failed:', err)
      return errorRedirect('Failed to exchange authorization code')
    }

    // 4. Verify id_token
    let claims
    try {
      claims = await verifyGoogleIdToken(idToken)
    } catch (err) {
      console.error('[Google OAuth] Token verification failed:', err)
      return errorRedirect(`Token verification failed: ${(err as Error).message}`)
    }

    const { sub: googleSub, email, name, picture } = claims

    // 5. Login-or-register logic
    // 5a. Look up User by googleSub (durable join key)
    let user = await prisma.user.findUnique({
      where: { googleSub },
      include: { memberships: { select: { orgId: true, role: true } } },
    })

    if (user) {
      // Sweep: accept pending invites and create missing Memberships for existing users
      await sweepPendingInvites(email, user.id)

      // Re-fetch memberships after sweep (sweep may have created new ones)
      const freshMemberships = await prisma.membership.findMany({
        where: { userId: user.id },
        select: { orgId: true, role: true },
      })

      // Existing user via googleSub — sign session with primary membership
      const sorted = [...freshMemberships].sort((a, b) => {
        const rank: Record<string, number> = { owner: 4, admin: 3, operator: 2, viewer: 1 }
        return (rank[b.role] ?? 0) - (rank[a.role] ?? 0)
      })
      const primary = sorted[0]

      if (!primary) {
        return errorRedirect('No organization membership — request an invitation from your admin')
      }

      // Check if user has multiple orgs → redirect to org-picker
      if (freshMemberships.length > 1) {
        const token = await issueSession(user.id, primary.orgId, primary.role, picture)
        if (!token) {
          return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
        }
        return redirectWithSession(token, '/org-picker')
      }

      const token = await issueSession(user.id, primary.orgId, primary.role, picture)
      if (!token) {
        return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
      }
      return redirectWithSession(token, '/build/pilot-lab')
    }

    // 5b. Look up User by email — link googleSub
    user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { select: { orgId: true, role: true } } },
    })

    if (user) {
      // Sweep pending invites for existing user
      await sweepPendingInvites(email, user.id)

      // Re-fetch memberships after sweep (sweep may have created new ones)
      const freshMemberships = await prisma.membership.findMany({
        where: { userId: user.id },
        select: { orgId: true, role: true },
      })

      // Update existing user with googleSub (link Google account)
      await prisma.user.update({
        where: { id: user.id },
        data: { googleSub },
      })

      const sorted = [...freshMemberships].sort((a, b) => {
        const rank: Record<string, number> = { owner: 4, admin: 3, operator: 2, viewer: 1 }
        return (rank[b.role] ?? 0) - (rank[a.role] ?? 0)
      })
      const primary = sorted[0]

      if (!primary) {
        return errorRedirect('No organization membership — request an invitation from your admin')
      }

      if (freshMemberships.length > 1) {
        const token = await issueSession(user.id, primary.orgId, primary.role, picture)
        if (!token) {
          return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
        }
        return redirectWithSession(token, '/org-picker')
      }

      const token = await issueSession(user.id, primary.orgId, primary.role, picture)
      if (!token) {
        return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
      }
      return redirectWithSession(token, '/build/pilot-lab')
    }

    // 5c. No existing user — check invite token first (passed through state cookie from /api/auth/google?invite=)
    // Check for share link by token (email=null, anyone can join)
    if (stateInviteToken) {
      const shareLink = await prisma.invitation.findUnique({ where: { token: stateInviteToken } })
      if (shareLink && shareLink.email === null && shareLink.state === 'pending' && new Date(shareLink.expiresAt) > new Date()) {
        if (shareLink.maxUses != null && shareLink.useCount >= shareLink.maxUses) {
          return errorRedirect('This share link has reached its maximum number of uses')
        }

        const newUseCount = shareLink.useCount + 1
        const reachedLimit = shareLink.maxUses != null && newUseCount >= shareLink.maxUses

        const result = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: { email, name: name || null, googleSub },
          })
          await tx.membership.create({
            data: { userId: newUser.id, orgId: shareLink.orgId, role: shareLink.role },
          })
          await tx.invitation.update({
            where: { id: shareLink.id },
            data: { useCount: newUseCount, state: reachedLimit ? 'accepted' : 'pending' },
          })
          return newUser
        })

        const token = await issueSession(result.id, shareLink.orgId, shareLink.role, picture)
        if (!token) {
          return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
        }
        return redirectWithSession(token, '/build/pilot-lab')
      }

      // Also check email-bound invite by token
      if (shareLink && shareLink.email !== null && shareLink.email !== email) {
        return errorRedirect('Email does not match the invitation')
      }
    }

    // Sweep pending email-bound invitations
    const pendingInvites = await prisma.invitation.findMany({
      where: {
        email,
        state: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (pendingInvites.length === 0) {
      // 5d. No invitation → DENY
      return errorRedirect(
        'No invitation found for this email — request one from your admin',
      )
    }

    // Create User + Memberships for ALL pending invites (transaction)
    const primaryInvite = pendingInvites[0]
    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          name: name || null,
          googleSub,
        },
      })

      // Accept ALL pending invitations — create a Membership for each
      for (const invite of pendingInvites) {
        await tx.membership.create({
          data: {
            userId: newUser.id,
            orgId: invite.orgId,
            role: invite.role,
          },
        })
        await tx.invitation.update({
          where: { id: invite.id },
          data: { state: 'accepted' },
        })
      }

      return newUser
    })

    const primaryRole = primaryInvite.role || 'viewer'

    // Sweep: accept any OTHER pending invites for this email (multi-org invites).
    // The primary invite was already accepted in the transaction above.
    for (const invite of pendingInvites.slice(1)) {
      await prisma.membership.create({
        data: { userId: result.id, orgId: invite.orgId, role: invite.role },
      }).catch(() => { /* duplicate — already a member */ })
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { state: 'accepted' },
      }).catch(() => {})
    }

    // Multi-org → redirect to org-picker
    if (pendingInvites.length > 1) {
      const token = await issueSession(result.id, primaryInvite.orgId, primaryRole, picture)
      if (!token) {
        return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
      }
      return redirectWithSession(token, '/org-picker')
    }

    const token = await issueSession(result.id, primaryInvite.orgId, primaryRole, picture)
    if (!token) {
      return NextResponse.json({ error: 'Server session secret not configured' }, { status: 500 })
    }
    return redirectWithSession(token, '/build/pilot-lab')
      },
    })(req)
  } catch (err) {
    console.error('[Google OAuth] Callback error:', err)
    return errorRedirect('Internal error during authentication')
  }
}
