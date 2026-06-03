// POST /api/admin/agent-configs/[id]/fork — Clone a config into a new version of the same name.
// The new version is created with isActive=false (the caller must explicitly activate it).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const source = await prisma.agentConfig.findUnique({ where: { id } })
  if (!source || source.orgId !== orgId) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 })
  }

  // Retry a few times to win the race against concurrent forks
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await prisma.agentConfig.findFirst({
      where: { orgId, name: source.name },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const newVersion = (max?.version ?? 0) + 1
    try {
      const forked = await prisma.agentConfig.create({
        data: {
          orgId,
          name: source.name,
          version: newVersion,
          isActive: false,
          parentId: source.id,
          model: source.model,
          temperature: source.temperature,
          thinkingBudget: source.thinkingBudget,
          maxIterations: source.maxIterations,
          maxOutputTokens: source.maxOutputTokens,
          systemPrompt: source.systemPrompt,
          coreSystemPrompt: source.coreSystemPrompt,
          showThinking: source.showThinking,
          memoryStrategy: source.memoryStrategy,
          policyHooks: source.policyHooks,
          gptbotsApiKey: source.gptbotsApiKey,
          invariantCheck: source.invariantCheck,
          resumePrompt: source.resumePrompt,
          debugMode: source.debugMode,
        },
        select: {
          id: true, name: true, version: true, isActive: true, parentId: true,
          model: true, createdAt: true, updatedAt: true,
        },
      })
      return NextResponse.json({ config: forked })
    } catch (err) {
      if ((err as any)?.code === 'P2002') {
        continue
      }
      throw err
    }
  }
  return NextResponse.json(
    { error: 'Could not allocate a new version after several attempts — please retry' },
    { status: 409 },
  )
}
