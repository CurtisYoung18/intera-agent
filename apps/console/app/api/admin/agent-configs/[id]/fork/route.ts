// POST /api/admin/agent-configs/[id]/fork
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { apiCreated } from '@intera/shared/contracts/envelope'

interface AgentConfigParams { id: string }

const FORK_SELECT = {
  id: true, name: true, version: true, isActive: true, parentId: true, model: true, createdAt: true, updatedAt: true,
} as const

export const POST = defineRoute<void, AgentConfigParams>({
  method: 'POST',
  async handler({ params, repo, audit }) {
    const { id: sourceId } = params
    const source = await repo.agentConfig.findUnique({ where: { id: sourceId } })
    if (!source) throw new NotFoundError('Config not found')

    for (let attempt = 0; attempt < 3; attempt++) {
      const max = await repo.agentConfig.findFirst({
        where: { name: source.name },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const newVersion = (max?.version ?? 0) + 1
      try {
        const forked = await (repo.agentConfig.create as any)({
          data: {
            name: source.name,
            version: newVersion,
            isActive: false,
            parentId: source.id,
            model: source.model,
            temperature: source.temperature,
            thinkingBudget: source.thinkingBudget,
            maxIterations: source.maxIterations,
            maxOutputTokens: source.maxOutputTokens,
            coreSystemPrompt: source.coreSystemPrompt,
            extendedThinking: source.extendedThinking,
            memoryStrategy: source.memoryStrategy,
            gptbotsApiKey: source.gptbotsApiKey,
            resumePrompt: source.resumePrompt,
          },
          select: FORK_SELECT,
        })

        // Deep-copy all sub-modules from source to fork
        await repo.raw.$transaction(async (tx: any) => {
          const toolIdMap = new Map<string, string>()
          const caseTypeIdMap = new Map<string, string>()
          const hookIdMap = new Map<string, string>()

          // Copy tools
          const tools = await tx.tool.findMany({ where: { agentConfigId: sourceId } })
          for (const t of tools) {
            const { id, createdAt, updatedAt, ...rest } = t
            const created = await tx.tool.create({ data: { ...rest, agentConfigId: forked.id } })
            toolIdMap.set(id, created.id)
          }

          // Copy case types
          const caseTypes = await tx.caseType.findMany({ where: { agentConfigId: sourceId } })
          for (const ct of caseTypes) {
            const { id, createdAt, updatedAt, ...rest } = ct
            const created = await tx.caseType.create({ data: { ...rest, agentConfigId: forked.id } })
            caseTypeIdMap.set(id, created.id)
          }

          // Copy hooks and bindings
          const hooks = await tx.hook.findMany({ where: { agentConfigId: sourceId } })
          for (const hook of hooks) {
            const { id, createdAt, updatedAt, ...rest } = hook
            const created = await tx.hook.create({ data: { ...rest, agentConfigId: forked.id } })
            hookIdMap.set(id, created.id)
          }
          const hookBindings = await tx.hookBinding.findMany({ where: { agentConfigId: sourceId } })
          for (const binding of hookBindings) {
            const { id, createdAt, updatedAt, hookId, caseTypeId, toolId, scopeType, scopeKey, ...rest } = binding
            const mappedHookId = hookIdMap.get(hookId)
            if (!mappedHookId) continue
            const mappedCaseTypeId = caseTypeId ? caseTypeIdMap.get(caseTypeId) ?? null : null
            const mappedToolId = toolId ? toolIdMap.get(toolId) ?? null : null
            let mappedScopeKey = scopeKey
            if (scopeType === 'caseType' && mappedCaseTypeId) mappedScopeKey = `caseType:${mappedCaseTypeId}`
            if (scopeType === 'procedureStep' && mappedCaseTypeId && typeof scopeKey === 'string') {
              const parts = scopeKey.split(':')
              mappedScopeKey = `procedureStep:${mappedCaseTypeId}:${parts[parts.length - 1] ?? ''}`
            }
            await tx.hookBinding.create({
              data: {
                ...rest,
                agentConfigId: forked.id,
                hookId: mappedHookId,
                scopeType,
                scopeKey: mappedScopeKey,
                caseTypeId: mappedCaseTypeId,
                toolId: mappedToolId,
              },
            })
          }

          // Copy knowledge sources
          const sources = await tx.knowledgeSource.findMany({ where: { agentConfigId: sourceId } })
          for (const ks of sources) {
            const { id, createdAt, updatedAt, ...rest } = ks
            await tx.knowledgeSource.create({ data: { ...rest, agentConfigId: forked.id } })
          }

          // Copy channel bindings
          const bindings = await tx.channelBinding.findMany({ where: { agentConfigId: sourceId } })
          for (const cb of bindings) {
            const { id, createdAt, updatedAt, ...rest } = cb
            await tx.channelBinding.create({ data: { ...rest, agentConfigId: forked.id } })
          }
        })

        await audit({
          action: 'agent_config.fork',
          target: `agent_config:${forked.id}`,
          before: { sourceId },
          after: forked as Record<string, unknown>,
        })
        return apiCreated({ config: forked })
      } catch (err: unknown) {
        if ((err as any)?.code === 'P2002') continue
        throw err
      }
    }
    throw new ValidationError('Could not allocate a new version after several attempts')
  },
})
