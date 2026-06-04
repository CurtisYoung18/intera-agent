// GET + POST + DELETE /api/admin/agent-configs — List, create/fork, and bulk-delete agent configs
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'

const AGENT_CARD_SELECT = {
  id: true, name: true, version: true, isActive: true, parentId: true, model: true, createdAt: true, updatedAt: true,
} as const

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    let configs = await repo.agentConfig.findMany({
      orderBy: [{ name: 'asc' }, { version: 'asc' }], select: AGENT_CARD_SELECT,
    })
    if (configs.length === 0) {
      await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
      const created = await (repo.agentConfig.create as any)({
        data: { name: 'Default', version: 1, isActive: true, systemPrompt: '', memoryStrategy: '{}', policyHooks: '{}' },
        select: AGENT_CARD_SELECT,
      })
      return apiOk({ configs: [created] })
    }
    return apiOk({ configs })
  },
})

const postSchema = z.object({ name: z.string().optional(), templateId: z.string().optional() })
type PostInput = z.infer<typeof postSchema>

export const POST = defineRoute<PostInput>({
  method: 'POST', inputSchema: postSchema,
  async handler({ input, repo, audit }) {
    const { templateId, name: requestedNameRaw } = input
    const requestedName = requestedNameRaw?.trim() || 'Default'
    await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })

    if (templateId) {
      const source = await repo.agentConfig.findUnique({ where: { id: templateId } })
      if (source) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const max = await repo.agentConfig.findFirst({ where: { name: source.name }, orderBy: { version: 'desc' }, select: { version: true } })
          const newVersion = (max?.version ?? 0) + 1
          try {
            const forked = await (repo.agentConfig.create as any)({
              data: {
                name: source.name, version: newVersion, isActive: false, parentId: source.id,
                model: source.model, temperature: source.temperature, thinkingBudget: source.thinkingBudget,
                maxIterations: source.maxIterations, maxOutputTokens: source.maxOutputTokens,
                systemPrompt: source.systemPrompt, coreSystemPrompt: source.coreSystemPrompt,
                showThinking: source.showThinking, memoryStrategy: source.memoryStrategy,
                policyHooks: source.policyHooks, gptbotsApiKey: source.gptbotsApiKey,
                invariantCheck: source.invariantCheck, resumePrompt: source.resumePrompt, debugMode: source.debugMode,
              },
              select: AGENT_CARD_SELECT,
            })
            await audit({ action: 'agent_config.fork', target: `agent_config:${forked.id}`, after: forked as Record<string, unknown> })
            return apiCreated({ config: forked })
          } catch (err: unknown) {
            if ((err as any)?.code === 'P2002') continue
            throw err
          }
        }
        throw new ValidationError('Could not allocate a new version after several attempts — please retry')
      }
    }

    try {
      const created = await (repo.agentConfig.create as any)({
        data: { name: requestedName, version: 1, isActive: true, parentId: null, systemPrompt: '', memoryStrategy: '{}', policyHooks: '{}' },
        select: AGENT_CARD_SELECT,
      })
      await audit({ action: 'agent_config.create', target: `agent_config:${created.id}`, after: created as Record<string, unknown> })
      return apiCreated({ config: created })
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') throw new ValidationError(`An agent named "${requestedName}" already exists`)
      throw err
    }
  },
})

const deleteSchema = z.object({ name: z.string().min(1) })
type DeleteInput = z.infer<typeof deleteSchema>

export const DELETE = defineRoute<DeleteInput>({
  method: 'DELETE', inputSchema: deleteSchema, parseQuery: true,
  async handler({ input, repo, audit }) {
    const { name } = input
    const existing = await repo.agentConfig.findFirst({ where: { name }, select: { id: true, name: true } })
    if (!existing) throw new NotFoundError(`No agent configs found with name "${name}"`)
    const result = await repo.agentConfig.deleteMany({ where: { name } })
    await audit({ action: 'agent_config.delete_bulk', target: `agent_config:${name}`, before: { name, count: result.count } })
    return apiOk({ ok: true, deleted: result.count })
  },
})
