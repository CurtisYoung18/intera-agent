// GET + PUT /api/admin/agent — Agent config CRUD (upsert)

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureSqliteSchemaCompat, ensureDefaultOrg } from '@intera/shared/prisma'
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, DEFAULT_MEMORY_STRATEGY, DEFAULT_POLICY_HOOKS } from '@intera/shared/defaults'

import { getActiveOrgId } from '@/lib/auth'

async function resolveAgentConfig(orgId: string, agentId: string | null) {
  if (agentId) {
    const config = await prisma.agentConfig.findUnique({ where: { id: agentId } })
    if (config && config.orgId === orgId) {
      return config
    }
  }
  return prisma.agentConfig.findFirst({ where: { orgId, isActive: true } })
}

export async function GET(request: NextRequest) {
  try {
    const ORG_ID = await getActiveOrgId()
    await ensureSqliteSchemaCompat(prisma)
    const agentId = request.nextUrl.searchParams.get('agentId')
    let config = await resolveAgentConfig(ORG_ID, agentId)

    // Lazy init: create from defaults if DB is empty
    if (!config) {
      await ensureDefaultOrg(ORG_ID)
      config = await prisma.agentConfig.create({
        data: {
          orgId: ORG_ID,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          model: DEFAULT_MODEL,
          temperature: 0.5,
          thinkingBudget: 4096,
          maxIterations: 20,
          maxOutputTokens: 4096,
          showThinking: false,
          caseAddendum: null,
          useLegacyCasePrompt: false, // new configs use base+append by default
          resumePrompt: null,
          memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
          policyHooks: JSON.stringify(DEFAULT_POLICY_HOOKS),
        },
      })
    }

    return NextResponse.json({ config })
  } catch (err) {
    console.error('[Admin] GET agent config:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ORG_ID = await getActiveOrgId()
    await ensureSqliteSchemaCompat(prisma)
    const body = await req.json()
    const {
      model, temperature, thinkingBudget, maxIterations, maxOutputTokens,
      systemPrompt, coreSystemPrompt, caseAddendum, useLegacyCasePrompt,
      showThinking, memoryStrategy, policyHooks,
      resumePrompt,
      debugMode, invariantCheck,
      capabilityBindings,
    } = body

    const data: Record<string, unknown> = {}
    if (model !== undefined) data.model = model
    if (temperature !== undefined) data.temperature = temperature
    if (thinkingBudget !== undefined) data.thinkingBudget = thinkingBudget
    if (maxIterations !== undefined) data.maxIterations = maxIterations
    if (maxOutputTokens !== undefined) data.maxOutputTokens = maxOutputTokens
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt
    if (coreSystemPrompt !== undefined) data.coreSystemPrompt = coreSystemPrompt
    if (caseAddendum !== undefined) data.caseAddendum = caseAddendum
    if (useLegacyCasePrompt !== undefined) data.useLegacyCasePrompt = useLegacyCasePrompt
    if (showThinking !== undefined) data.showThinking = showThinking
    if (memoryStrategy !== undefined) data.memoryStrategy = typeof memoryStrategy === 'string' ? memoryStrategy : JSON.stringify(memoryStrategy)
    if (policyHooks !== undefined) data.policyHooks = typeof policyHooks === 'string' ? policyHooks : JSON.stringify(policyHooks)
    if (resumePrompt !== undefined) data.resumePrompt = resumePrompt
    if (debugMode !== undefined) data.debugMode = debugMode
    if (invariantCheck !== undefined) data.invariantCheck = invariantCheck
    if (capabilityBindings !== undefined) data.capabilityBindings = typeof capabilityBindings === 'string' ? capabilityBindings : JSON.stringify(capabilityBindings)

    await ensureDefaultOrg(ORG_ID)
    const agentId = req.nextUrl.searchParams.get('agentId')
    const existing = await resolveAgentConfig(ORG_ID, agentId)
    let config
    if (existing) {
      config = await prisma.agentConfig.update({
        where: { id: existing.id },
        data,
      })
    } else {
      config = await prisma.agentConfig.create({
        data: {
          orgId: ORG_ID,
          systemPrompt: systemPrompt || '',
          coreSystemPrompt: coreSystemPrompt ?? null,
          caseAddendum: caseAddendum ?? null,
          useLegacyCasePrompt: useLegacyCasePrompt ?? false, // new configs use base+append
          model: model || DEFAULT_MODEL,
          temperature: temperature ?? 0.5,
          thinkingBudget: thinkingBudget ?? 4096,
          maxIterations: maxIterations ?? 20,
          maxOutputTokens: maxOutputTokens ?? 4096,
          showThinking: showThinking ?? false,
          resumePrompt: resumePrompt ?? null,
          debugMode: debugMode ?? false,
          memoryStrategy: typeof memoryStrategy === 'string' ? memoryStrategy : JSON.stringify(memoryStrategy || {}),
          policyHooks: typeof policyHooks === 'string' ? policyHooks : JSON.stringify(policyHooks || {}),
        },
      })
    }

    return NextResponse.json({ config })
  } catch (err) {
    console.error('[Admin] PUT agent config:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
