// POST /api/auth/switch-org — Switch active organization
// Migrated to defineRoute (G1 contract seam).

import { z } from 'zod'
import { defineRoute, ForbiddenError, RouteError, ValidationError } from '@/lib/api/define-route'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'

const switchSchema = z.object({ orgId: z.string().min(1, 'orgId is required') })
type SwitchInput = z.infer<typeof switchSchema>

export const POST = defineRoute<SwitchInput>({
  method: 'POST',
  inputSchema: switchSchema,
  async handler({ input, session, repo }) {
    const membership = await repo.raw.membership.findUnique({
      where: { userId_orgId: { userId: session.userId!, orgId: input.orgId } },
      include: { org: true },
    })
    if (!membership) throw new ForbiddenError('You are not a member of this organization')

    const token = await signSession({
      userId: session.userId!,
      orgId: membership.orgId,
      role: membership.role as 'owner' | 'admin' | 'operator' | 'viewer',
      avatarUrl: session.avatarUrl ?? null,
    })
    if (!token) throw new RouteError('internal', 'Server session secret not configured')

    const { NextResponse } = await import('next/server')
    const res = NextResponse.json({ ok: true, userId: session.userId, orgId: membership.orgId, role: membership.role, name: membership.org.name })
    res.cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE_S })
    return res
  },
})
