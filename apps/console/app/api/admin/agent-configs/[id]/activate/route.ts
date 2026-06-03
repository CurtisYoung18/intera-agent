// PUT /api/admin/agent-configs/[id]/activate — Promote a draft version to active for its (orgId, name).
// Demotes the previous active version inside the same transaction. Invalidates cache for both ids.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'
import { clearConfigCache } from '@/lib/agent/config-cache'

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const target = await prisma.agentConfig.findUnique({ where: { id } })
  if (!target || target.orgId !== orgId) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 })
  }

  // Idempotent: if already active, just return it
  if (target.isActive) {
    return NextResponse.json({ config: { id: target.id, name: target.name, version: target.version, isActive: true } })
  }

  // Find the current active sibling (for cache invalidation)
  const previousActive = await prisma.agentConfig.findFirst({
    where: { orgId, name: target.name, isActive: true },
    select: { id: true },
  })

  // Atomic: demote previous + promote this one
  await prisma.$transaction([
    prisma.agentConfig.updateMany({
      where: { orgId, name: target.name, isActive: true },
      data: { isActive: false },
    }),
    prisma.agentConfig.update({
      where: { id: target.id },
      data: { isActive: true },
      select: { id: true, name: true, version: true, isActive: true },
    }),
  ])

  // Cache invalidation for both the demoted and the promoted id — in-flight runs
  // on the demoted config would otherwise read the stale row for up to 30s.
  if (previousActive) clearConfigCache(orgId, previousActive.id)
  clearConfigCache(orgId, target.id)
  // Also invalidate the no-agentId lookup used by runtime consumers
  clearConfigCache(orgId)

  return NextResponse.json({ config: { id: target.id, name: target.name, version: target.version, isActive: true } })
}
