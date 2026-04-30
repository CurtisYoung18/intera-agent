// GET + PUT + DELETE /api/admin/skills/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params
  try {
    const skill = await prisma.skill.findUnique({ where: { customerId_name: { customerId: CUSTOMER_ID, name } } })
    if (!skill) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ skill })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params
  try {
    const body = await req.json()
    const data: Record<string, unknown> = {}
    const strFields = ['name', 'description', 'mode', 'endpoint', 'httpMethod', 'guardPhase']
    for (const f of strFields) if (body[f] !== undefined) data[f] = body[f]
    if (body.timeoutMs !== undefined) data.timeoutMs = body.timeoutMs
    if (body.isConcurrencySafe !== undefined) data.isConcurrencySafe = body.isConcurrencySafe
    if (body.enabled !== undefined) data.enabled = body.enabled
    for (const f of ['inputSchema', 'outputSchema', 'headers', 'mockFixture']) {
      if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f])
    }

    const skill = await prisma.skill.update({ where: { customerId_name: { customerId: CUSTOMER_ID, name } }, data })
    return NextResponse.json({ skill })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params
  try {
    await prisma.skill.delete({ where: { customerId_name: { customerId: CUSTOMER_ID, name } } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
