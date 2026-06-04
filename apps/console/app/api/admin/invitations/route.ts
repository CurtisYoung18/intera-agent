// GET + POST /api/admin/invitations — List and create invitations (B-ii).
// Uses repo.invitation (orgId auto-injected by Proxy).
// Supports email-bound invites AND share links (email-less, anyone-can-join).

import { defineRoute, ConflictError, RouteError } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'

const createInviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'operator', 'viewer']),
  maxUses: z.number().int().min(1).max(500).optional(),
})

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
    if (!session.userId) throw new RouteError('internal', 'Session missing userId — please re-login')

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

    const data: Record<string, unknown> = {
      email: input.email ?? null,
      role: input.role,
      maxUses: input.email ? null : (input.maxUses ?? null),
      useCount: 0,
      token,
      state: 'pending',
      expiresAt,
    }

    const invitation = await (repo.invitation.create as any)({
      data: { ...data, orgId: session.orgId, invitedBy: session.userId },
      include: { inviter: { select: { email: true, name: true } } },
    })

    await audit({
      action: 'invitation.create',
      target: `invitation:${invitation.email ?? 'share-link'}`,
      after: { role: input.role, isShareLink: !input.email },
    })

    return apiCreated({ invitation })
  },
})
