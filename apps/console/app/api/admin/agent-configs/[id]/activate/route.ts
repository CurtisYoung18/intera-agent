// PUT /api/admin/agent-configs/[id]/activate
import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { clearConfigCache } from '@/lib/agent/config-cache'
interface AgentConfigParams { id: string }

const activateSchema = z.object({
  releaseNote: z.string().optional(),
})

export const PUT = defineRoute<z.infer<typeof activateSchema>, AgentConfigParams>({
  method: 'PUT',
  inputSchema: activateSchema,
  async handler({ input, params, repo, audit, session }) {
    const { id } = params
    const target = await repo.agentConfig.findUnique({ where: { id } })
    if (!target) throw new NotFoundError('Config not found')
    if (target.isActive) return apiOk({ config: { id: target.id, name: target.name, version: target.version, isActive: true } })
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
    await audit({ action: 'agent_config.activate', target: `agent_config:${id}`, before: { previousActiveId: previousActive?.id }, after: { activeId: id, releaseNote: input.releaseNote } })
    return apiOk({ config: { id: target.id, name: target.name, version: target.version, isActive: true } })
  },
})
