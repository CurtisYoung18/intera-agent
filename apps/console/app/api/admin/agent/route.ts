// GET + PUT + POST /api/admin/agent — Agent config CRUD (upsert)
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).
// POST is an alias for PUT (apiClient defaults to POST when body is present).
// Phase 5 (2026-06-08): systemPrompt, caseAddendum, useLegacyCasePrompt, debugMode, invariantCheck dropped.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { DEFAULT_MODEL, DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { resolveEffectiveModel } from '@/lib/agent/resolve-model'

const getQuerySchema = z.object({
  agentId: z.string().optional(),
})

export const GET = defineRoute({
  method: 'GET',
  parseQuery: true,
  inputSchema: getQuerySchema,
  async handler({ input, repo }) {
    const agentId = input.agentId ?? null

    let config = agentId
      ? await repo.agentConfig.findUnique({ where: { id: agentId } })
      : await repo.agentConfig.findFirst({ where: { isActive: true } })

    if (!config) {
      await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
      config = await repo.agentConfig.create({
        data: {
          model: DEFAULT_MODEL,
          temperature: 0.5,
          thinkingBudget: 4096,
          maxIterations: 20,
          maxOutputTokens: 4096,
          extendedThinking: false,
          resumePrompt: null,
          memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
        } as any,
      })
    }

    return apiOk({ config, resolvedModel: resolveEffectiveModel(config) })
  },
})

const putSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().optional(),
  thinkingBudget: z.number().optional(),
  maxIterations: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  coreSystemPrompt: z.string().nullable().optional(),
  extendedThinking: z.boolean().optional(),
  memoryStrategy: z.union([z.string(), z.record(z.unknown())]).optional(),
  resumePrompt: z.string().nullable().optional(),
})
type PutInput = z.infer<typeof putSchema>

function toJsonIfObject(v: unknown): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function agentUpdateHandler(agentId: string | null) {
  return defineRoute<PutInput>({
    method: 'PUT',
    inputSchema: putSchema,
    requireRole: ['admin', 'owner'],
    async handler({ input, repo }) {
    await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })

    const data: Record<string, unknown> = {}
    if (input.model !== undefined) data.model = input.model
    if (input.temperature !== undefined) data.temperature = input.temperature
    if (input.thinkingBudget !== undefined) data.thinkingBudget = input.thinkingBudget
    if (input.maxIterations !== undefined) data.maxIterations = input.maxIterations
    if (input.maxOutputTokens !== undefined) data.maxOutputTokens = input.maxOutputTokens
    if (input.coreSystemPrompt !== undefined) data.coreSystemPrompt = input.coreSystemPrompt
    if (input.extendedThinking !== undefined) data.extendedThinking = input.extendedThinking
    if (input.memoryStrategy !== undefined) data.memoryStrategy = toJsonIfObject(input.memoryStrategy)
    if (input.resumePrompt !== undefined) data.resumePrompt = input.resumePrompt

    const existing = agentId
      ? await repo.agentConfig.findUnique({ where: { id: agentId } })
      : await repo.agentConfig.findFirst({ where: { isActive: true } })
    let config
    if (existing) {
      config = await repo.agentConfig.update({ where: { id: existing.id }, data: data as any })
    } else {
      config = await repo.agentConfig.create({
        data: {
          model: input.model || DEFAULT_MODEL,
          temperature: input.temperature ?? 0.5,
          thinkingBudget: input.thinkingBudget ?? 4096,
          maxIterations: input.maxIterations ?? 20,
          maxOutputTokens: input.maxOutputTokens ?? 4096,
          coreSystemPrompt: input.coreSystemPrompt ?? null,
          extendedThinking: input.extendedThinking ?? false,
          resumePrompt: input.resumePrompt ?? null,
          memoryStrategy: input.memoryStrategy ? toJsonIfObject(input.memoryStrategy) || JSON.stringify({}) : JSON.stringify(DEFAULT_MEMORY_STRATEGY),
        } as any,
      })
    }

    return apiOk({ config })
  },
})
}

export async function PUT(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId')
  return agentUpdateHandler(agentId)(req)
}

export async function POST(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId')
  return agentUpdateHandler(agentId)(req)
}
