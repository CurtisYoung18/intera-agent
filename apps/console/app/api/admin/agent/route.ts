// GET + PUT /api/admin/agent — Agent config CRUD (upsert)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    const config = await prisma.agentConfig.findUnique({ where: { customerId: CUSTOMER_ID } })
    return NextResponse.json({ config })
  } catch (err) {
    console.error('[Admin] GET agent config:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      model, temperature, thinkingBudget, maxIterations,
      systemPrompt, toolParallelism, isConcurrencySafe,
      memoryStrategy, policyHooks,
    } = body

    const data: Record<string, unknown> = {}
    if (model !== undefined) data.model = model
    if (temperature !== undefined) data.temperature = temperature
    if (thinkingBudget !== undefined) data.thinkingBudget = thinkingBudget
    if (maxIterations !== undefined) data.maxIterations = maxIterations
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt
    if (toolParallelism !== undefined) data.toolParallelism = toolParallelism
    if (isConcurrencySafe !== undefined) data.isConcurrencySafe = isConcurrencySafe
    if (memoryStrategy !== undefined) data.memoryStrategy = typeof memoryStrategy === 'string' ? memoryStrategy : JSON.stringify(memoryStrategy)
    if (policyHooks !== undefined) data.policyHooks = typeof policyHooks === 'string' ? policyHooks : JSON.stringify(policyHooks)

    const config = await prisma.agentConfig.upsert({
      where: { customerId: CUSTOMER_ID },
      update: data,
      create: {
        customerId: CUSTOMER_ID,
        systemPrompt: systemPrompt || '',
        model: model || 'claude-sonnet-4-20250514',
        temperature: temperature ?? 0.5,
        thinkingBudget: thinkingBudget ?? 4096,
        maxIterations: maxIterations ?? 20,
        toolParallelism: toolParallelism ?? true,
        isConcurrencySafe: isConcurrencySafe ?? true,
        memoryStrategy: typeof memoryStrategy === 'string' ? memoryStrategy : JSON.stringify(memoryStrategy || {}),
        policyHooks: typeof policyHooks === 'string' ? policyHooks : JSON.stringify(policyHooks || {}),
      },
    })

    return NextResponse.json({ config })
  } catch (err) {
    console.error('[Admin] PUT agent config:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
