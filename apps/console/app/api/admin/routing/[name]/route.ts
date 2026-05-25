// GET + PUT + DELETE /api/admin/routing/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

import { getActiveCustomerId } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    const route = await prisma.routing.findUnique({ where: { customerId_queue: { customerId: CUSTOMER_ID, queue: name } } })
    if (!route) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ route })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.queue !== undefined) data.queue = body.queue
    if (body.description !== undefined) data.description = body.description
    if (body.priority !== undefined) data.priority = body.priority
    if (body.autoAssign !== undefined) data.autoAssign = body.autoAssign
    if (body.maxWaitingTime !== undefined) data.maxWaitingTime = body.maxWaitingTime
    if (body.skillsAllowed !== undefined) data.skillsAllowed = typeof body.skillsAllowed === 'string' ? body.skillsAllowed : JSON.stringify(body.skillsAllowed)
    const route = await prisma.routing.update({ where: { customerId_queue: { customerId: CUSTOMER_ID, queue: name } }, data })
    return NextResponse.json({ route })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    await prisma.routing.delete({ where: { customerId_queue: { customerId: CUSTOMER_ID, queue: name } } })
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}
