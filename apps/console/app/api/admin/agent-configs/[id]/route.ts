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
  const config = await prisma.agentConfig.findUnique({ where: { id } })
  if (!config || config.orgId !== orgId) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 })
  }
  const count = await prisma.agentConfig.count({ where: { orgId } })
  if (count <= 1) {
    return NextResponse.json({ error: 'Cannot delete the only agent config' }, { status: 400 })
  }
  await prisma.agentConfig.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
