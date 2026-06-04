// GET + POST /api/admin/invitations — List and create invitations (B-ii).
// Uses repo.invitation (orgId auto-injected by Proxy).
// Supports email-bound invites AND share links (email-less, anyone-can-join).

import { defineRoute, ConflictError } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'

const createInviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'operator', 'viewer']),
  maxUses: z.number().int().min(1).max(500).optional(),
})

const INVITE_SELECT = {
  id: true, email: true, role: true, state: true, token: true,
  expiresAt: true, createdAt: true, maxUses: true, useCount: true,
  inviter: { select: { email: true, name: true } },
} as const

export const GET = defineRoute({
  method: 'GET',
  requireRole: ['admin', 'owner'],
  async handler({ repo }) {
    const invitations = await repo.invitation.findMany({
      where: { state: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { inviter: { select: { email: true, name: true } } },
    })
    return apiOk({ invitations })
  },
})

export const POST = defineRoute({
  method: 'POST',
  inputSchema: createInviteSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, session, repo, audit }) {
    // Email-bound invite: check for duplicate member / pending invite
    if (input.email) {
      const existingMember = await repo.raw.membership.findFirst({
        where: { orgId: session.orgId, user: { email: input.email } },
      })
      if (existingMember) {
        throw new ConflictError('User is already a member of this organization')
      }
      const existingInvite = await repo.invitation.findFirst({
        where: { email: input.email, state: 'pending' },
      })
      if (existingInvite) {
        throw new ConflictError('A pending invitation already exists for this email')
      }
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const invitation = await (repo.invitation.create as any)({
      data: {
        email: input.email ?? null,
        invitedBy: session.userId!,
        role: input.role,
        maxUses: input.email ? null : (input.maxUses ?? null),
        useCount: 0,
        token,
        state: 'pending',
        expiresAt,
      },
      select: INVITE_SELECT,
    })

    await audit({
      action: 'invitation.create',
      target: `invitation:${invitation.email ?? 'share-link'}`,
      after: { role: input.role, isShareLink: !input.email },
    })

    return apiCreated({ invitation })
  },
})
