// GET /api/admin/agent-configs — list all agent configs for the active org
// POST /api/admin/agent-configs — create a new agent config

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'

export async function GET() {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configs = await prisma.agentConfig.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      model: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  // Auto-create a default config if org has none
  if (configs.length === 0) {
    const created = await prisma.agentConfig.create({
      data: {
        orgId,
        name: 'Default',
        systemPrompt: '',
        memoryStrategy: '{}',
        policyHooks: '{}',
      },
      select: {
        id: true,
        name: true,
        model: true,
        createdAt: true,
        updatedAt: true,
      },
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
  const name = (body.name as string)?.trim() || 'New Agent'
  const templateId = body.templateId as string | undefined

  // Clone a specific config if templateId is provided and valid, else fall back to first config
  let template = null
  if (templateId) {
    template = await prisma.agentConfig.findUnique({ where: { id: templateId } })
    if (!template || template.orgId !== orgId) {
      template = null
    }
  }
  if (!template) {
    template = await prisma.agentConfig.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
    })
  }

  const config = await prisma.agentConfig.create({
    data: {
      orgId,
      name,
      model: template?.model ?? 'claude-sonnet-4-20250514',
      temperature: template?.temperature ?? 0.5,
      thinkingBudget: template?.thinkingBudget ?? 4096,
      maxIterations: template?.maxIterations ?? 20,
      systemPrompt: template?.systemPrompt ?? '',
      memoryStrategy: template?.memoryStrategy ?? '{}',
      policyHooks: template?.policyHooks ?? '{}',
    },
  })

  return NextResponse.json({ config })
}
