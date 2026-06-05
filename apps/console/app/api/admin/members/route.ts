// GET + PUT /api/admin/members — List members and update roles (B-ii).
// Uses repo.membership (orgId auto-injected by Proxy).

import { defineRoute, ForbiddenError, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { z } from 'zod'

const updateRoleSchema = z.object({
  membershipId: z.string(),
  role: z.enum(['admin', 'operator', 'viewer']),
})

export const GET = defineRoute({
  method: 'GET',
  requireRole: ['admin', 'owner'],
  async handler({ repo }) {
    const members = await repo.membership.findMany({
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { invitedAt: 'desc' },
    })
    return apiOk({ members })
  },
})

export const PUT = defineRoute({
  method: 'PUT',
  inputSchema: updateRoleSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, session, repo, audit }) {
    const membership = await repo.membership.findFirst({
      where: { id: input.membershipId },
    })
    if (!membership) throw new NotFoundError('Member not found')

    // Cannot change your own role.
    if (membership.userId === session.userId) {
      throw new ForbiddenError('You cannot change your own role')
    }

    // Only owners can modify owner roles.
    const currentRole: string = (membership as any).role
    if (currentRole === 'owner' && session.role !== 'owner') {
      throw new ForbiddenError('Only an owner can change an owner\'s role')
    }

    // Last-owner protection: can't demote the only owner.
    if (currentRole === 'owner' && (input.role as string) !== 'owner') {
      const ownerCount = await repo.membership.count({
        where: { role: 'owner' },
      })
      if (ownerCount <= 1) {
        throw new ForbiddenError('Cannot demote the only owner')
      }
    }

    const updated = await repo.membership.update({
      where: { id: input.membershipId },
      data: { role: input.role },
      include: { user: { select: { email: true } } },
    })

    await audit({
      action: 'member.role.update',
      target: `membership:${input.membershipId}`,
      before: { role: membership.role },
      after: { role: input.role },
    })

    return apiOk({ member: updated })
  },
})
