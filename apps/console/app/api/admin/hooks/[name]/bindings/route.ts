// POST /api/admin/hooks/[name]/bindings
// Creates a HookBinding after validating the referenced scope belongs to the same agent.

import { ConflictError, defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiCreated } from '@intera/shared/contracts/envelope'
import {
  hookBindingCreateInputSchema,
  resolveBindingScope,
  serializeBinding,
  type HookBindingRow,
  type HookBindingCreateInput,
  type HookRouteParams,
  type HookRow,
} from '../../_helpers'

export const POST = defineRoute<HookBindingCreateInput, HookRouteParams>({
  method: 'POST',
  scope: 'agent',
  inputSchema: hookBindingCreateInputSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, enabled, ...scopeInput } = input
    const hookName = params.name

    const hook = await repo.raw.hook.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: hookName } },
    }) as HookRow | null
    if (!hook) throw new NotFoundError(`Hook "${hookName}" not found`)

    const scope = await resolveBindingScope(repo, agentConfigId, scopeInput)
    const existing = await repo.raw.hookBinding.findFirst({
      where: { agentConfigId, hookId: hook.id, scopeKey: scope.scopeKey },
    }) as HookBindingRow | null
    if (existing) {
      throw new ConflictError(`Hook "${hookName}" is already bound to ${scope.scopeKey}`)
    }

    const binding = await repo.raw.hookBinding.create({
      data: {
        agentConfigId,
        hookId: hook.id,
        enabled,
        ...scope,
      },
    }) as HookBindingRow

    await audit({
      action: 'hookBinding.create',
      target: `hook:${hookName}/binding:${binding.scopeKey}`,
      after: binding as Record<string, unknown>,
    })

    return apiCreated({ binding: serializeBinding(binding, hook.name) })
  },
})
