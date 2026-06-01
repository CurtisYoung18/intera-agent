// GET /api/admin/api-keys — list API keys for the active org
// POST /api/admin/api-keys — generate a new API key

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'
import { generateApiKey } from '@/lib/api-auth'

export async function GET() {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keys = await prisma.apiKey.findMany({
    where: { orgId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ keys })
}

export async function POST(request: NextRequest) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const name = (body.name as string)?.trim() || 'default'

  const { plaintext, hash, prefix } = generateApiKey()

  const key = await prisma.apiKey.create({
    data: { orgId, name, hash, prefix },
    select: { id: true, name: true, prefix: true, createdAt: true },
  })

  return NextResponse.json({ key, plaintext })
}
