// PUT /api/admin/organizations/[id] — Update organization name (staff only)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getSession } from '@/lib/auth'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getSession()
  if (!session || session.role !== 'staff') {
    return NextResponse.json({ error: 'Staff only' }, { status: 403 })
  }

  let body: { name?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'name required (max 100 chars)' }, { status: 400 })
  }

  await prisma.organization.update({
    where: { id },
    data: { name },
  })

  return NextResponse.json({ ok: true })
}
