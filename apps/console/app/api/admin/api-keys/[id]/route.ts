// DELETE /api/admin/api-keys/[id] — revoke an API key

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // Verify key belongs to this org before revoking
  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.orgId !== orgId) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  }

  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
