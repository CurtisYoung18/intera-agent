// GET + PUT + DELETE /api/admin/skills/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

import { getActiveCustomerId } from '@/lib/auth'
import { CRITICAL_SKILL_NAMES } from '@/lib/skill-classifications'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
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
    const CUSTOMER_ID = await getActiveCustomerId()
    const body = await req.json()

    // Critical skills: reject changes to name, inputSchema, mode
    if (CRITICAL_SKILL_NAMES.has(name)) {
      const blocked: string[] = []
      if (body.name !== undefined && body.name !== name) blocked.push('name')
      if (body.inputSchema !== undefined) blocked.push('inputSchema')
      if (body.mode !== undefined) blocked.push('mode')
      if (blocked.length > 0) {
        return NextResponse.json(
          { error: `Cannot modify ${blocked.join(', ')} on critical skill "${name}"` },
          { status: 400 },
        )
      }
    }

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
    const CUSTOMER_ID = await getActiveCustomerId()
    await prisma.skill.delete({ where: { customerId_name: { customerId: CUSTOMER_ID, name } } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
