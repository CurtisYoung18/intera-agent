// PUT /api/admin/agent-configs/[id]/activate
import { z } from 'zod'
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { clearConfigCache } from '@/lib/agent/config-cache'
import { getScenarioValidationSummary } from '@/lib/scenarios/store'
interface AgentConfigParams { id: string }

const activateSchema = z.object({
  releaseNote: z.string().optional(),
  overrideValidationReason: z.string().trim().min(1).optional(),
})

export const PUT = defineRoute<z.infer<typeof activateSchema>, AgentConfigParams>({
  method: 'PUT',
  inputSchema: activateSchema,
  async handler({ input, params, repo, audit, session }) {
    const { id } = params
    const target = await repo.agentConfig.findUnique({ where: { id } })
    if (!target) throw new NotFoundError('Config not found')
    const validation = await getScenarioValidationSummary(id)
    if (target.isActive) return apiOk({
      config: { id: target.id, name: target.name, version: target.version, isActive: true },
      validation: {
        ...validation,
        overrideReason: validation.overrideRequired ? input.overrideValidationReason : undefined,
      },
    })
    if (validation.overrideRequired && !input.overrideValidationReason) {
      throw new ValidationError('Scenario validation is stale or failed. Provide overrideValidationReason to activate anyway.', {
        overrideValidationReason: 'Override reason is required when Scenario validation is not fresh.',
      })
    }
    const previousActive = await repo.agentConfig.findFirst({ where: { name: target.name, isActive: true }, select: { id: true } })
    await repo.raw.$transaction([
      repo.raw.agentConfig.updateMany({ where: { orgId: repo.orgId, name: target.name, isActive: true }, data: { isActive: false } }),
      repo.raw.agentConfig.update({
        where: { id: target.id },
        data: {
          isActive: true,
          releaseNote: input.releaseNote ?? null,
          publishedAt: new Date(),
          publishedBy: session?.userId ?? null,
        } as any,
        select: { id: true, name: true, version: true, isActive: true },
      }),
    ])
    if (previousActive) clearConfigCache(previousActive.id)
    clearConfigCache(target.id)
    await audit({
      action: 'agent_config.activate',
      target: `agent_config:${id}`,
      before: { previousActiveId: previousActive?.id },
      after: {
        activeId: id,
        releaseNote: input.releaseNote,
        validationState: validation.state,
        overrideValidationReason: input.overrideValidationReason,
      },
    })
    return apiOk({
      config: { id: target.id, name: target.name, version: target.version, isActive: true },
      validation: {
        ...validation,
        overrideReason: validation.overrideRequired ? input.overrideValidationReason : undefined,
      },
    })
  },
})
