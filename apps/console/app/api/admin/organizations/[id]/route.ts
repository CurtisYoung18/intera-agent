// PUT /api/admin/organizations/[id] — Update organization name (admin/owner only)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getSession } from '@/lib/auth'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getSession()
  if (!session || (session.role !== 'admin' && session.role !== 'owner')) {
    return NextResponse.json({ error: 'Admin or owner role required' }, { status: 403 })
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
