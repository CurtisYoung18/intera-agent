// GET + PUT /api/cases/[id]/memory — Read and edit case memory

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const mem = await prisma.caseMemory.findUnique({ where: { caseId: id } })
    if (!mem) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ memory: mem })
  } catch (err) {
    console.error('[Memory API] GET failed:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const body = await req.json()
    const {
      confirmedFacts,
      missingFacts,
      skillsCalled,
      summary,
    } = body

    // Validate JSON fields
    const validated: Record<string, string> = {}

    if (confirmedFacts !== undefined) {
      if (typeof confirmedFacts === 'object') {
        validated.confirmedFacts = JSON.stringify(confirmedFacts)
      } else {
        return NextResponse.json({ error: 'confirmedFacts must be an object' }, { status: 400 })
      }
    }

    if (missingFacts !== undefined) {
      if (Array.isArray(missingFacts)) {
        validated.missingFacts = JSON.stringify(missingFacts)
      } else {
        return NextResponse.json({ error: 'missingFacts must be an array' }, { status: 400 })
      }
    }

    if (skillsCalled !== undefined) {
      if (Array.isArray(skillsCalled)) {
        validated.skillsCalled = JSON.stringify(skillsCalled)
      } else {
        return NextResponse.json({ error: 'skillsCalled must be an array' }, { status: 400 })
      }
    }

    if (summary !== undefined) {
      if (typeof summary === 'string') {
        validated.summary = summary
      } else {
        return NextResponse.json({ error: 'summary must be a string' }, { status: 400 })
      }
    }

    // Upsert — create if this is the first memory entry
    const mem = await prisma.caseMemory.upsert({
      where: { caseId: id },
      update: validated,
      create: {
        caseId: id,
        confirmedFacts: validated.confirmedFacts || '{}',
        missingFacts: validated.missingFacts || '[]',
        skillsCalled: validated.skillsCalled || '[]',
        summary: validated.summary || null,
      },
    })

    // Write audit trace
    await prisma.actionTrace.create({
      data: {
        caseId: id,
        actionType: 'fact_extracted',
        title: 'Memory manually edited by operator',
        payload: JSON.stringify({ editedFields: Object.keys(validated) }),
      },
    })

    return NextResponse.json({ memory: mem })
  } catch (err) {
    console.error('[Memory API] PUT failed:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
