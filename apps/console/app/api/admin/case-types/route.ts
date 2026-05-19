// GET + POST /api/admin/case-types

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureSqliteSchemaCompat, ensureDefaultCustomer } from '@intera/shared/prisma'
import { DEFAULT_CASE_TYPES } from '@intera/shared/defaults'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    await ensureSqliteSchemaCompat(prisma)
    let types = await prisma.caseType.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { type: 'asc' },
    })

    // Ensure all default case types exist (insert missing, skip existing)
    const existingTypes = new Set(types.map((t) => t.type))
    const missing = DEFAULT_CASE_TYPES.filter((ct) => !existingTypes.has(ct.type))

    if (missing.length > 0) {
      await ensureDefaultCustomer(CUSTOMER_ID)
      const { DEFAULT_STAGE_CONFIGS, DEFAULT_ORCHESTRATOR_CONFIG } = await import('@intera/shared/defaults')
      for (const ct of missing) {
        const stageConfigs = (DEFAULT_STAGE_CONFIGS as Record<string, unknown>)[ct.type] || null
        await prisma.caseType.create({
          data: {
            customerId: CUSTOMER_ID,
            type: ct.type,
            displayName: ct.displayName,
            description: ct.description,
            icon: ct.icon,
            requiredFacts: ct.requiredFacts,
            stages: ct.stages,
            stageConfigs: stageConfigs ? JSON.stringify(stageConfigs) : null,
            orchestratorConfig: JSON.stringify(DEFAULT_ORCHESTRATOR_CONFIG),
            defaultGoal: ct.defaultGoal,
            escalateOn: ct.escalateOn,
            enabled: ct.enabled ?? true,
            requireHumanReview: ct.requireHumanReview ?? false,
          },
        })
      }
      types = await prisma.caseType.findMany({
        where: { customerId: CUSTOMER_ID },
        orderBy: { type: 'asc' },
      })
    }

    return NextResponse.json({ types })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteSchemaCompat(prisma)
    await ensureDefaultCustomer(CUSTOMER_ID)
    const body = await req.json()
    const ct = await prisma.caseType.create({
      data: {
        customerId: CUSTOMER_ID,
        type: body.type,
        displayName: body.displayName || body.type,
        description: body.description || null,
        icon: body.icon || '📋',
        requiredFacts: typeof body.requiredFacts === 'string' ? body.requiredFacts : JSON.stringify(body.requiredFacts || []),
        stages: typeof body.stages === 'string' ? body.stages : JSON.stringify(body.stages || ['created', 'investigating', 'resolved']),
        stageConfigs: body.stageConfigs ? (typeof body.stageConfigs === 'string' ? body.stageConfigs : JSON.stringify(body.stageConfigs)) : null,
        orchestratorConfig: body.orchestratorConfig ? (typeof body.orchestratorConfig === 'string' ? body.orchestratorConfig : JSON.stringify(body.orchestratorConfig)) : null,
        defaultGoal: body.defaultGoal || '',
        escalateOn: typeof body.escalateOn === 'string' ? body.escalateOn : JSON.stringify(body.escalateOn || []),
        autoCloseConditions: body.autoCloseConditions ? (typeof body.autoCloseConditions === 'string' ? body.autoCloseConditions : JSON.stringify(body.autoCloseConditions)) : null,
        enabled: body.enabled !== false && body.enabled !== 0 && body.enabled !== 'false',
        requireHumanReview: body.requireHumanReview === true || body.requireHumanReview === 'true',
      },
    })
    return NextResponse.json({ caseType: ct }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
