// PUT + DELETE /api/admin/agent-configs/[id] — Rename and delete agent config versions
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute, NotFoundError, ValidationError, ConflictError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { clearConfigCache } from '@/lib/agent/config-cache'

interface AgentConfigParams { id: string }
const RESERVED_NAMES = new Set<string>(['default'])

const renameSchema = z.object({ name: z.string().min(1, 'Name is required') })
type RenameInput = z.infer<typeof renameSchema>

export const PUT = defineRoute<RenameInput, AgentConfigParams>({
  method: 'PUT', inputSchema: renameSchema,
  async handler({ input, params, repo, audit }) {
    const { id } = params; const { name } = input
    const config = await repo.agentConfig.findUnique({ where: { id } })
    if (!config) throw new NotFoundError('Config not found')
    const cleanName = name.trim()
    if (RESERVED_NAMES.has(cleanName.toLowerCase())) throw new ValidationError(`"${cleanName}" is a reserved name`)
    if (cleanName === config.name) {
      return apiOk({ config: { id: config.id, name: config.name, version: config.version, isActive: config.isActive, model: config.model, createdAt: config.createdAt, updatedAt: config.updatedAt } })
    }
    const clash = await repo.agentConfig.findFirst({ where: { name: cleanName }, select: { id: true } })
    if (clash) throw new ConflictError(`An agent named "${cleanName}" already exists`)
    const oldName = config.name
    await repo.agentConfig.updateMany({ where: { name: oldName }, data: { name: cleanName } })
    const updated = await repo.agentConfig.findUnique({ where: { id }, select: { id: true, name: true, version: true, isActive: true, model: true, createdAt: true, updatedAt: true } })
    const allInGroup = await repo.agentConfig.findMany({ where: { name: cleanName }, select: { id: true } })
    for (const row of allInGroup) clearConfigCache(repo.orgId, row.id)
    clearConfigCache(repo.orgId)
    await audit({ action: 'agent_config.rename', target: `agent_config:${id}`, before: { oldName }, after: { newName: cleanName } })
    return apiOk({ config: updated })
  },
})

export const DELETE = defineRoute<void, AgentConfigParams>({
  method: 'DELETE',
  async handler({ params, repo, audit }) {
    const { id } = params
    const config = await repo.agentConfig.findUnique({ where: { id } })
    if (!config) throw new NotFoundError('Config not found')
    const childCount = await repo.agentConfig.count({ where: { parentId: id } })
    if (childCount > 0) throw new ValidationError(`Cannot delete — this version has ${childCount} child version${childCount !== 1 ? 's' : ''}.`)
    const siblingCount = await repo.agentConfig.count({ where: { name: config.name } })
    if (siblingCount <= 1) throw new ValidationError('Cannot delete the only version of this agent')
    if (config.isActive) {
      const successor = await repo.agentConfig.findFirst({ where: { name: config.name, id: { not: id }, isActive: false }, orderBy: { version: 'desc' }, select: { id: true } })
      if (!successor) throw new ValidationError('No other version available to promote')
      await repo.raw.$transaction([repo.raw.agentConfig.update({ where: { id: successor.id }, data: { isActive: true } }), repo.raw.agentConfig.delete({ where: { id } })])
      clearConfigCache(repo.orgId, successor.id)
    } else {
      await repo.agentConfig.delete({ where: { id } })
    }
    clearConfigCache(repo.orgId, id); clearConfigCache(repo.orgId)
    await audit({ action: 'agent_config.delete', target: `agent_config:${id}`, before: { name: config.name, version: config.version } })
    return apiOk({ ok: true })
  },
})
