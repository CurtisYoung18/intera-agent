// GET + POST /api/admin/skills — List and create skills

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { DEFAULT_SKILLS } from '@intera/shared/defaults'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    let skills = await prisma.skill.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { name: 'asc' },
    })

    // Lazy init: create from defaults if DB is empty
    if (skills.length === 0) {
      for (const s of DEFAULT_SKILLS) {
        await prisma.skill.create({
          data: {
            customerId: CUSTOMER_ID,
            name: s.name,
            description: s.description,
            inputSchema: s.inputSchema,
            outputSchema: s.outputSchema,
            mode: s.mode,
            isConcurrencySafe: s.isConcurrencySafe,
            enabled: s.enabled,
            guardPhase: s.guardPhase,
          },
        })
      }
      skills = await prisma.skill.findMany({
        where: { customerId: CUSTOMER_ID },
        orderBy: { name: 'asc' },
      })
    }

    return NextResponse.json({ skills })
  } catch (err) {
    console.error('[Admin] GET skills:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const skill = await prisma.skill.create({
      data: {
        customerId: CUSTOMER_ID,
        name: body.name,
        description: body.description || '',
        inputSchema: typeof body.inputSchema === 'string' ? body.inputSchema : JSON.stringify(body.inputSchema || {}),
        outputSchema: typeof body.outputSchema === 'string' ? body.outputSchema : JSON.stringify(body.outputSchema || {}),
        mode: body.mode || 'mock',
        endpoint: body.endpoint || null,
        httpMethod: body.httpMethod || 'POST',
        headers: body.headers ? (typeof body.headers === 'string' ? body.headers : JSON.stringify(body.headers)) : null,
        timeoutMs: body.timeoutMs ?? 8000,
        mockFixture: body.mockFixture ? (typeof body.mockFixture === 'string' ? body.mockFixture : JSON.stringify(body.mockFixture)) : null,
        guardPhase: body.guardPhase || 'post',
        isConcurrencySafe: body.isConcurrencySafe ?? true,
        enabled: body.enabled ?? true,
      },
    })
    return NextResponse.json({ skill }, { status: 201 })
  } catch (err) {
    console.error('[Admin] POST skill:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
