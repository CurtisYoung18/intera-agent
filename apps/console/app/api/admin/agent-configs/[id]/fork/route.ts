// POST /api/admin/agent-configs/[id]/fork
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { apiCreated } from '@intera/shared/contracts/envelope'
interface AgentConfigParams { id: string }
const FORK_SELECT = { id: true, name: true, version: true, isActive: true, parentId: true, model: true, createdAt: true, updatedAt: true } as const
export const POST = defineRoute<void, AgentConfigParams>({
  method: 'POST',
  async handler({ params, repo, audit }) {
    const { id } = params
    const source = await repo.agentConfig.findUnique({ where: { id } })
    if (!source) throw new NotFoundError('Config not found')
    for (let attempt = 0; attempt < 3; attempt++) {
      const max = await repo.agentConfig.findFirst({ where: { name: source.name }, orderBy: { version: 'desc' }, select: { version: true } })
      const newVersion = (max?.version ?? 0) + 1
      try {
        const forked = await (repo.agentConfig.create as any)({
          data: { name: source.name, version: newVersion, isActive: false, parentId: source.id, model: source.model, temperature: source.temperature, thinkingBudget: source.thinkingBudget, maxIterations: source.maxIterations, maxOutputTokens: source.maxOutputTokens, systemPrompt: source.systemPrompt, coreSystemPrompt: source.coreSystemPrompt, showThinking: source.showThinking, memoryStrategy: source.memoryStrategy, policyHooks: source.policyHooks, gptbotsApiKey: source.gptbotsApiKey, invariantCheck: source.invariantCheck, resumePrompt: source.resumePrompt, debugMode: source.debugMode },
          select: FORK_SELECT,
        })
        await audit({ action: 'agent_config.fork', target: `agent_config:${forked.id}`, before: { sourceId: id }, after: forked as Record<string, unknown> })
        return apiCreated({ config: forked })
      } catch (err: unknown) { if ((err as any)?.code === 'P2002') continue; throw err }
    }
    throw new ValidationError('Could not allocate a new version after several attempts')
  },
})
