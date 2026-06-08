// GET + PUT + DELETE /api/admin/hooks/[name]/bindings/[id]
// Foundation Reset F4: nested HookBinding CRUD.

import { ConflictError, defineRoute, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  agentConfigQuerySchema,
  hasScopeUpdate,
  hookBindingUpdateInputSchema,
  resolveBindingScope,
  scopeInputFromExisting,
  serializeBinding,
  type AgentConfigQueryInput,
  type HookBindingRouteParams,
  type HookBindingRow,
  type HookBindingUpdateInput,
  type HookRow,
} from '../../../_helpers'

async function findHookAndBinding(
  repo: Parameters<typeof assertAgentInOrg>[0],
  agentConfigId: string,
  hookName: string,
  bindingId: string,
) {
  const hook = await repo.raw.hook.findUnique({
    where: { agentConfigId_name: { agentConfigId, name: hookName } },
  }) as HookRow | null
  if (!hook) throw new NotFoundError(`Hook "${hookName}" not found`)

  const binding = await repo.raw.hookBinding.findFirst({
    where: { id: bindingId, agentConfigId, hookId: hook.id },
  }) as HookBindingRow | null
  if (!binding) throw new NotFoundError('Hook binding not found')

  return { hook, binding }
}

export const GET = defineRoute<AgentConfigQueryInput, HookBindingRouteParams>({
  method: 'GET',
  inputSchema: agentConfigQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    const { name, id } = params
    await assertAgentInOrg(repo, agentConfigId)

    const { hook, binding } = await findHookAndBinding(repo, agentConfigId, name, id)
    return apiOk({ binding: serializeBinding(binding, hook.name) })
  },
})

export const PUT = defineRoute<HookBindingUpdateInput, HookBindingRouteParams>({
  method: 'PUT',
  inputSchema: hookBindingUpdateInputSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, enabled } = input
    const { name, id } = params
    await assertAgentInOrg(repo, agentConfigId)

    const { hook, binding: existing } = await findHookAndBinding(repo, agentConfigId, name, id)
    const data: Record<string, unknown> = {}
    if (enabled !== undefined) data.enabled = enabled

    if (hasScopeUpdate(input)) {
      const scope = await resolveBindingScope(repo, agentConfigId, scopeInputFromExisting(existing, input))
      const duplicate = await repo.raw.hookBinding.findFirst({
        where: { agentConfigId, hookId: hook.id, scopeKey: scope.scopeKey },
      }) as HookBindingRow | null
      if (duplicate && duplicate.id !== existing.id) {
        throw new ConflictError(`Hook "${hook.name}" is already bound to ${scope.scopeKey}`)
      }
      Object.assign(data, scope)
    }

    const binding = await repo.raw.hookBinding.update({
      where: { id: existing.id },
      data,
    }) as HookBindingRow

    await audit({
      action: 'hookBinding.update',
      target: `hook:${hook.name}/binding:${binding.id}`,
      before: existing as Record<string, unknown>,
      after: binding as Record<string, unknown>,
    })

    return apiOk({ binding: serializeBinding(binding, hook.name) })
  },
})

export const DELETE = defineRoute<AgentConfigQueryInput, HookBindingRouteParams>({
  method: 'DELETE',
  inputSchema: agentConfigQuerySchema,
  parseQuery: true,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    const { name, id } = params
    await assertAgentInOrg(repo, agentConfigId)

    const { hook, binding } = await findHookAndBinding(repo, agentConfigId, name, id)
    await repo.raw.hookBinding.delete({ where: { id: binding.id } })

    await audit({
      action: 'hookBinding.delete',
      target: `hook:${hook.name}/binding:${binding.id}`,
      before: binding as Record<string, unknown>,
    })

    return apiOk({ success: true })
  },
})
