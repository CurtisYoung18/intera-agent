// Shared audit-writer seam — the single place that writes AuditLog rows.
//
// Callable from BOTH defineRoute (HTTP routes, orgId+userId from session)
// AND the agent runtime (policy.ts/loop.ts, orgId passed explicitly).
// Keep it ONE seam so the later RLS dispatch can make it GUC-aware in one
// place without re-touching G11.

import { prisma } from '@intera/shared/prisma'
import type { AuditEvent } from '@intera/shared/contracts/audit'
import type { Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'

export async function writeAudit(event: AuditEvent): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: event.actorUserId,
        orgId: event.orgId,
        action: event.action,
        target: event.target,
        before: (event.before ?? undefined) as Prisma.InputJsonValue,
        after: (event.after ?? undefined) as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    // Audit failure must never break the request. Log and continue.
    logger.error('audit write failed', {
      action: event.action,
      target: event.target,
      orgId: event.orgId,
      error: (err as Error).message ?? String(err),
    })
  }
}
