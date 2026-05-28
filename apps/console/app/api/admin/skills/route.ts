// GET + POST /api/admin/skills — List and create skills

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureDefaultCustomer } from '@intera/shared/prisma'
import { DEFAULT_SKILLS } from '@intera/shared/defaults'

import { getActiveCustomerId } from '@/lib/auth'
import { SYSTEM_SKILL_NAMES, SPECIAL_SKILL_NAMES, CHANNEL_SKILL_NAMES } from '@/lib/skill-classifications'

export async function GET() {
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    let skills = await prisma.skill.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { name: 'asc' },
    })

    // Auto-seed: always ensure system + special skills exist (idempotent upsert).
    // Previously only seeded when the table was empty, which meant new skills
    // added in later releases never appeared for existing customers.
    const requiredNames = new Set([...SYSTEM_SKILL_NAMES, ...SPECIAL_SKILL_NAMES])
    const existingNames = new Set(skills.map((s) => s.name))
    const toCreate = DEFAULT_SKILLS.filter((s) => !existingNames.has(s.name))
    const toUpsert = DEFAULT_SKILLS.filter((s) => requiredNames.has(s.name) && !existingNames.has(s.name))

    if (skills.length === 0 || toUpsert.length > 0) {
      await ensureDefaultCustomer(CUSTOMER_ID)
      const namesToSeed = skills.length === 0 ? DEFAULT_SKILLS : toUpsert
      for (const s of namesToSeed) {
        await prisma.skill.upsert({
          where: { customerId_name: { customerId: CUSTOMER_ID, name: s.name } },
          update: {
            description: s.description, inputSchema: s.inputSchema, outputSchema: s.outputSchema,
            mode: s.mode, isConcurrencySafe: s.isConcurrencySafe, enabled: s.enabled,
            guardPhase: s.guardPhase, endpoint: s.endpoint ?? null, httpMethod: s.httpMethod ?? 'POST',
            headers: s.headers ?? null, timeoutMs: s.timeoutMs ?? 8000,
            mockFixture: s.mockFixture ?? null,
            displayVerb: s.displayVerb ? JSON.stringify(s.displayVerb) : null,
          },
          create: {
            customerId: CUSTOMER_ID, name: s.name, description: s.description,
            inputSchema: s.inputSchema, outputSchema: s.outputSchema, mode: s.mode,
            isConcurrencySafe: s.isConcurrencySafe, enabled: s.enabled, guardPhase: s.guardPhase,
            endpoint: s.endpoint ?? null, httpMethod: s.httpMethod ?? 'POST',
            headers: s.headers ?? null, timeoutMs: s.timeoutMs ?? 8000,
            mockFixture: s.mockFixture ?? null,
            displayVerb: s.displayVerb ? JSON.stringify(s.displayVerb) : null,
          },
        })
      }
      skills = await prisma.skill.findMany({
        where: { customerId: CUSTOMER_ID },
        orderBy: { name: 'asc' },
      })
    }

    const enriched = skills.map((s) => ({
      ...s,
      isSystem: SYSTEM_SKILL_NAMES.has(s.name),
      isChannel: CHANNEL_SKILL_NAMES.has(s.name),
      isSpecial: SPECIAL_SKILL_NAMES.has(s.name),
    }))

    return NextResponse.json({ skills: enriched })
  } catch (err) {
    console.error('[Admin] GET skills:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const CUSTOMER_ID = await getActiveCustomerId()
    await ensureDefaultCustomer(CUSTOMER_ID)
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
        displayVerb: body.displayVerb ? (typeof body.displayVerb === 'string' ? body.displayVerb : JSON.stringify(body.displayVerb)) : null,
        renderHints: body.renderHints ? (typeof body.renderHints === 'string' ? body.renderHints : JSON.stringify(body.renderHints)) : null,
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
