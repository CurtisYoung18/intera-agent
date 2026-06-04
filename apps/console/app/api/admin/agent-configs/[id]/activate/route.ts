// PUT /api/admin/agent-configs/[id]/activate
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { clearConfigCache } from '@/lib/agent/config-cache'
interface AgentConfigParams { id: string }
export const PUT = defineRoute<void, AgentConfigParams>({
  method: 'PUT',
  async handler({ params, repo, audit }) {
    const { id } = params
    const target = await repo.agentConfig.findUnique({ where: { id } })
    if (!target) throw new NotFoundError('Config not found')
    if (target.isActive) return apiOk({ config: { id: target.id, name: target.name, version: target.version, isActive: true } })
    const previousActive = await repo.agentConfig.findFirst({ where: { name: target.name, isActive: true }, select: { id: true } })
    await repo.raw.$transaction([
      repo.raw.agentConfig.updateMany({ where: { orgId: repo.orgId, name: target.name, isActive: true }, data: { isActive: false } }),
      repo.raw.agentConfig.update({ where: { id: target.id }, data: { isActive: true }, select: { id: true, name: true, version: true, isActive: true } }),
    ])
    if (previousActive) clearConfigCache(repo.orgId, previousActive.id)
    clearConfigCache(repo.orgId, target.id); clearConfigCache(repo.orgId)
    await audit({ action: 'agent_config.activate', target: `agent_config:${id}`, before: { previousActiveId: previousActive?.id }, after: { activeId: id } })
    return apiOk({ config: { id: target.id, name: target.name, version: target.version, isActive: true } })
  },
})
