// GET + PUT + DELETE /api/admin/policies/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

import { getActiveOrgId } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const ORG_ID = await getActiveOrgId()
    const policy = await prisma.policy.findUnique({ where: { orgId_name: { orgId: ORG_ID, name } } })
    if (!policy) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ policy })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const ORG_ID = await getActiveOrgId()
    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.description !== undefined) data.description = body.description
    if (body.hook !== undefined) data.hook = body.hook
    if (body.enabled !== undefined) data.enabled = body.enabled
    if (body.name !== undefined) data.name = body.name
    if (body.rule !== undefined) data.rule = typeof body.rule === 'string' ? body.rule : JSON.stringify(body.rule)
    const policy = await prisma.policy.update({ where: { orgId_name: { orgId: ORG_ID, name } }, data })
    return NextResponse.json({ policy })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const ORG_ID = await getActiveOrgId()
    await prisma.policy.delete({ where: { orgId_name: { orgId: ORG_ID, name } } })
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}
