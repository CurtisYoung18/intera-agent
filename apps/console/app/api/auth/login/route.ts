// POST /api/auth/login — Console login (issues signed session cookie)
// Migrated to defineRoute (G1 contract seam).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { compareSync } from 'bcryptjs'
import { prisma } from '@intera/shared/prisma'
import { defineRoute, UnauthorizedError, ForbiddenError, RouteError } from '@/lib/api/define-route'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

const loginSchema = z.object({
  email: z.string().min(1).transform(e => e.trim().toLowerCase()),
  password: z.string().min(1),
})
type LoginInput = z.infer<typeof loginSchema>

const COOKIE_OPTS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: SESSION_MAX_AGE_S }

function primaryMembership(user: { memberships: Array<{ orgId: string; role: string }> }) {
  const sorted = [...user.memberships].sort((a, b) => {
    const rank: Record<string, number> = { owner: 4, admin: 3, operator: 2, viewer: 1 }
    return (rank[b.role] ?? 0) - (rank[a.role] ?? 0)
  })
  return sorted[0] ?? null
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit({ key: `login:${ip}`, max: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Too many login attempts' } }, { status: 429 })
  }

  return defineRoute<LoginInput>({
    method: 'POST',
    auth: 'none',
    inputSchema: loginSchema,
    async handler({ input }) {
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        include: { memberships: { select: { orgId: true, role: true } } },
      })
      if (!user?.passwordHash || !compareSync(input.password, user.passwordHash)) {
        throw new UnauthorizedError('Invalid email or password')
      }

      const primary = primaryMembership(user)
      if (!primary) throw new ForbiddenError('No organization membership — request an invitation')

      const token = await signSession({ userId: user.id, orgId: primary.orgId, role: primary.role as any })
      if (!token) throw new RouteError('internal', 'Server session secret not configured')

      const res = NextResponse.json({ ok: true, userId: user.id, orgId: primary.orgId, role: primary.role, name: user.name })
      res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
      res.cookies.set('intera_org_id', '', { path: '/', maxAge: 0 })
      res.cookies.set('intera_auth', '', { path: '/', maxAge: 0 })
      return res
    },
  })(req)
}
