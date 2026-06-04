// GET + PUT /api/admin/agent — Agent config CRUD (upsert)
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, DEFAULT_MEMORY_STRATEGY, DEFAULT_POLICY_HOOKS } from '@intera/shared/defaults'

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

    // Lazy init: create from defaults if DB is empty
    if (!config) {
      await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
      config = await repo.agentConfig.create({
        data: {
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          model: DEFAULT_MODEL,
          temperature: 0.5,
          thinkingBudget: 4096,
          maxIterations: 20,
          maxOutputTokens: 4096,
          showThinking: false,
          caseAddendum: null,
          useLegacyCasePrompt: false,
          resumePrompt: null,
          memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
          policyHooks: JSON.stringify(DEFAULT_POLICY_HOOKS),
        } as any,
      })
    }

    return apiOk({ config })
  },
})

const putSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().optional(),
  thinkingBudget: z.number().optional(),
  maxIterations: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  systemPrompt: z.string().optional(),
  coreSystemPrompt: z.string().nullable().optional(),
  caseAddendum: z.string().nullable().optional(),
  useLegacyCasePrompt: z.boolean().optional(),
  showThinking: z.boolean().optional(),
  memoryStrategy: z.union([z.string(), z.record(z.unknown())]).optional(),
  policyHooks: z.union([z.string(), z.record(z.unknown())]).optional(),
  resumePrompt: z.string().nullable().optional(),
  debugMode: z.boolean().optional(),
  invariantCheck: z.boolean().optional(),
  capabilityBindings: z.union([z.string(), z.record(z.unknown())]).optional(),
})
type PutInput = z.infer<typeof putSchema>

function toJsonIfObject(v: unknown): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export async function PUT(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId')
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
    if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt
    if (input.coreSystemPrompt !== undefined) data.coreSystemPrompt = input.coreSystemPrompt
    if (input.caseAddendum !== undefined) data.caseAddendum = input.caseAddendum
    if (input.useLegacyCasePrompt !== undefined) data.useLegacyCasePrompt = input.useLegacyCasePrompt
    if (input.showThinking !== undefined) data.showThinking = input.showThinking
    if (input.memoryStrategy !== undefined) data.memoryStrategy = toJsonIfObject(input.memoryStrategy)
    if (input.policyHooks !== undefined) data.policyHooks = toJsonIfObject(input.policyHooks)
    if (input.resumePrompt !== undefined) data.resumePrompt = input.resumePrompt
    if (input.debugMode !== undefined) data.debugMode = input.debugMode
    if (input.invariantCheck !== undefined) data.invariantCheck = input.invariantCheck
    if (input.capabilityBindings !== undefined) data.capabilityBindings = toJsonIfObject(input.capabilityBindings)

    // Resolve the config to upsert
    const existing = agentId
      ? await repo.agentConfig.findUnique({ where: { id: agentId } })
      : await repo.agentConfig.findFirst({ where: { isActive: true } })
    let config
    if (existing) {
      config = await repo.agentConfig.update({ where: { id: existing.id }, data: data as any })
    } else {
      config = await repo.agentConfig.create({
        data: {
          systemPrompt: input.systemPrompt || '',
          coreSystemPrompt: input.coreSystemPrompt ?? null,
          caseAddendum: input.caseAddendum ?? null,
          useLegacyCasePrompt: input.useLegacyCasePrompt ?? false,
          model: input.model || DEFAULT_MODEL,
          temperature: input.temperature ?? 0.5,
          thinkingBudget: input.thinkingBudget ?? 4096,
          maxIterations: input.maxIterations ?? 20,
          maxOutputTokens: input.maxOutputTokens ?? 4096,
          showThinking: input.showThinking ?? false,
          resumePrompt: input.resumePrompt ?? null,
          debugMode: input.debugMode ?? false,
          memoryStrategy: input.memoryStrategy ? toJsonIfObject(input.memoryStrategy) || JSON.stringify({}) : JSON.stringify(DEFAULT_MEMORY_STRATEGY),
          policyHooks: input.policyHooks ? toJsonIfObject(input.policyHooks) || JSON.stringify({}) : JSON.stringify(DEFAULT_POLICY_HOOKS),
        } as any,
      })
    }

    return apiOk({ config })
  },
})(req)
}
