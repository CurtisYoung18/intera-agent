// GET + PUT + DELETE /api/admin/policies/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

import { getActiveCustomerId } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    const policy = await prisma.policy.findUnique({ where: { customerId_name: { customerId: CUSTOMER_ID, name } } })
    if (!policy) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ policy })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.description !== undefined) data.description = body.description
    if (body.hook !== undefined) data.hook = body.hook
    if (body.enabled !== undefined) data.enabled = body.enabled
    if (body.name !== undefined) data.name = body.name
    if (body.rule !== undefined) data.rule = typeof body.rule === 'string' ? body.rule : JSON.stringify(body.rule)
    const policy = await prisma.policy.update({ where: { customerId_name: { customerId: CUSTOMER_ID, name } }, data })
    return NextResponse.json({ policy })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    await prisma.policy.delete({ where: { customerId_name: { customerId: CUSTOMER_ID, name } } })
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}
