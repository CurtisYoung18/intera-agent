// DELETE /api/admin/invitations/[id] — Revoke an invitation (B-ii).
// Uses repo.invitation (orgId auto-injected by Proxy).

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const DELETE = defineRoute<void, { id: string }>({
  method: 'DELETE',
  requireRole: ['admin', 'owner'],
  async handler({ params, repo, audit }) {
    const invitation = await repo.invitation.findFirst({
      where: { id: params.id },
    })
    if (!invitation) throw new NotFoundError('Invitation not found')

    await repo.invitation.delete({
      where: { id: params.id },
    })

    await audit({ action: 'invitation.revoke', target: `invitation:${invitation.email}`, before: { email: invitation.email, role: (invitation as any).role } })

    return apiOk({ ok: true })
  },
})
