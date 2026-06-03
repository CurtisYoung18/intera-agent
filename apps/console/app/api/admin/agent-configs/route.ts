// GET /api/admin/agent-configs — list all agent config versions for the active org
// POST /api/admin/agent-configs — create a new agent (name, v1, active) or fork (templateId → new version of same name, draft)
// DELETE /api/admin/agent-configs?name=X — delete ALL versions of agent name X for the active org

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'

const AGENT_CARD_SELECT = {
  id: true,
  name: true,
  version: true,
  isActive: true,
  parentId: true,
  model: true,
  createdAt: true,
  updatedAt: true,
} as const

export async function GET() {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configs = await prisma.agentConfig.findMany({
    where: { orgId },
    orderBy: [{ name: 'asc' }, { version: 'asc' }],
    select: AGENT_CARD_SELECT,
  })

  // Auto-create a default config if org has none
  if (configs.length === 0) {
    const created = await prisma.agentConfig.create({
      data: {
        orgId,
        name: 'Default',
        version: 1,
        isActive: true,
        systemPrompt: '',
        memoryStrategy: '{}',
        policyHooks: '{}',
      },
      select: AGENT_CARD_SELECT,
    })
    return NextResponse.json({ configs: [created] })
  }

  return NextResponse.json({ configs })
}

export async function POST(request: NextRequest) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const templateId = body.templateId as string | undefined
  const requestedName = (body.name as string)?.trim() || 'New Agent'

  // ── Path 1: fork (templateId provided + valid) → new version of same name, isActive=false
  if (templateId) {
    const source = await prisma.agentConfig.findUnique({ where: { id: templateId } })
    if (source && source.orgId === orgId) {
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
            select: AGENT_CARD_SELECT,
          })
          return NextResponse.json({ config: forked })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            // Concurrent fork — try again with a fresh max
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
  }

  // ── Path 2: create a new agent name (v1, active)
  const created = await prisma.agentConfig.create({
    data: {
      orgId,
      name: requestedName,
      version: 1,
      isActive: true,
      parentId: null,
      systemPrompt: '',
      memoryStrategy: '{}',
      policyHooks: '{}',
    },
    select: AGENT_CARD_SELECT,
  })
  return NextResponse.json({ config: created })
}

export async function DELETE(request: NextRequest) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const name = request.nextUrl.searchParams.get('name')?.trim()
  if (!name) {
    return NextResponse.json({ error: 'name query param required' }, { status: 400 })
  }

  const { count } = await prisma.agentConfig.deleteMany({
    where: { orgId, name },
  })

  if (count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, deleted: count })
}
