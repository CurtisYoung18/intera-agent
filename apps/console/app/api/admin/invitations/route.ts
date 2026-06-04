// GET + POST /api/admin/invitations — List and create invitations (B-ii).
// Uses repo.invitation (orgId auto-injected by Proxy).

import { defineRoute, ConflictError } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'operator', 'viewer']),
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
    // Reject if email is already a member of this org.
    // Need raw user lookup since User isn't org-scoped.
    const existingMember = await repo.raw.membership.findFirst({
      where: { orgId: session.orgId, user: { email: input.email } },
    })
    if (existingMember) {
      throw new ConflictError('User is already a member of this organization')
    }

    // Check for existing pending invitation (org-scoped)
    const existingInvite = await repo.invitation.findFirst({
      where: { email: input.email, state: 'pending' },
    })
    if (existingInvite) {
      throw new ConflictError('A pending invitation already exists for this email')
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const invitation = await (repo.invitation.create as any)({
      data: {
        email: input.email,
        invitedBy: session.userId!,
        role: input.role,
        token,
        state: 'pending',
        expiresAt,
      },
      include: { inviter: { select: { email: true, name: true } } },
    })

    await audit({ action: 'invitation.create', target: `invitation:${invitation.email}`, after: { role: input.role } })

    return apiCreated({ invitation })
  },
})
