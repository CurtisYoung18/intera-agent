// POST /api/auth/register — Invite-only registration
// Migrated to defineRoute (G1 contract seam).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hashSync } from 'bcryptjs'
import { prisma } from '@intera/shared/prisma'
import { defineRoute, RouteError, ForbiddenError, ConflictError } from '@/lib/api/define-route'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

const registerSchema = z.object({
  email: z.string().min(1).transform(e => e.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().nullable().optional(),
  token: z.string().min(1, 'Invitation token is required'),
})
type RegisterInput = z.infer<typeof registerSchema>

const COOKIE_OPTS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: SESSION_MAX_AGE_S }

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit({ key: `register:${ip}`, max: 10, windowSec: 300 })
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Too many registration attempts' } }, { status: 429 })
  }

  return defineRoute<RegisterInput>({
    method: 'POST',
    auth: 'none',
    inputSchema: registerSchema,
    async handler({ input }) {
      const invitation = await prisma.invitation.findUnique({ where: { token: input.token } })
      if (!invitation) throw new RouteError('not_found', 'Invalid invitation token')

      const isShareLink = invitation.email === null
      if (!isShareLink && invitation.email !== input.email) {
        throw new ForbiddenError('Email does not match the invitation')
      }
      if (invitation.state !== 'pending') {
        throw new RouteError('not_found', 'Invitation has already been used or expired', undefined, 410)
      }
      if (new Date(invitation.expiresAt) < new Date()) {
        await prisma.invitation.update({ where: { id: invitation.id }, data: { state: 'expired' } })
        throw new RouteError('not_found', 'Invitation has expired', undefined, 410)
      }
      if (isShareLink && invitation.maxUses != null && invitation.useCount >= invitation.maxUses) {
        throw new RouteError('not_found', 'This share link has reached its maximum number of uses', undefined, 410)
      }

      const existingUser = await prisma.user.findUnique({ where: { email: input.email } })
      if (existingUser) throw new ConflictError('A user with this email already exists')

      const passwordHash = hashSync(input.password, 10)

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: input.email, name: input.name ?? null, passwordHash } })
        await tx.membership.create({ data: { userId: user.id, orgId: invitation.orgId, role: invitation.role } })
        const newUseCount = invitation.useCount + 1
        const reachedLimit = isShareLink && invitation.maxUses != null && newUseCount >= invitation.maxUses
        await tx.invitation.update({
          where: { id: invitation.id },
          data: isShareLink ? { useCount: newUseCount, state: reachedLimit ? 'accepted' : 'pending' } : { state: 'accepted' },
        })
        return user
      })

      const token = await signSession({ userId: result.id, orgId: invitation.orgId, role: invitation.role as any })
      if (!token) throw new RouteError('internal', 'Server session secret not configured')

      const res = NextResponse.json({ ok: true, userId: result.id, orgId: invitation.orgId, role: invitation.role, name: result.name })
      res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
      return res
    },
  })(req)
}
