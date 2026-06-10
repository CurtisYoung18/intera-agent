// GET + POST /api/admin/hooks
// Foundation Reset F4: canonical Hook admin API, scoped by agentConfigId.

import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiCreated, apiOk } from '@intera/shared/contracts/envelope'
import {
  agentConfigQuerySchema,
  collectProcedureSteps,
  hookCreateInputSchema,
  normalizeHandler,
  serializeHandler,
  serializeHook,
  serializeBinding,
  validateHandlerToolReferences,
  type AgentConfigQueryInput,
  type HookBindingRow,
  type HookCreateInput,
  type HookRow,
  type CaseTypePickerRow,
  type ToolPickerRow,
} from './_helpers'

export const GET = defineRoute<AgentConfigQueryInput>({
  method: 'GET',
  inputSchema: agentConfigQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)

    const [hooks, bindings, caseTypes, tools] = await Promise.all([
      repo.raw.hook.findMany({
        where: { agentConfigId },
        orderBy: { name: 'asc' },
      }),
      repo.raw.hookBinding.findMany({
        where: { agentConfigId },
        orderBy: [{ scopeType: 'asc' }, { createdAt: 'asc' }],
      }),
      repo.raw.caseType.findMany({
        where: { agentConfigId },
        select: { id: true, type: true, displayName: true, procedure: true, enabled: true },
        orderBy: { type: 'asc' },
      }),
      repo.raw.tool.findMany({
        where: { agentConfigId },
        select: { id: true, name: true, description: true, mode: true, enabled: true },
        orderBy: { name: 'asc' },
      }),
    ]) as [HookRow[], HookBindingRow[], CaseTypePickerRow[], ToolPickerRow[]]

    const hookNameById = new Map(hooks.map((hook) => [hook.id, hook.name]))
    const bindingsByHookId = new Map<string, HookBindingRow[]>()
    for (const binding of bindings) {
      const rows = bindingsByHookId.get(binding.hookId) ?? []
      rows.push(binding)
      bindingsByHookId.set(binding.hookId, rows)
    }

    return apiOk({
      hooks: hooks.map((hook) => serializeHook(hook, bindingsByHookId.get(hook.id) ?? [])),
      bindings: bindings.map((binding) => serializeBinding(binding, hookNameById.get(binding.hookId))),
      caseTypes,
      procedureSteps: collectProcedureSteps(caseTypes),
      tools,
    })
  },
})

export const POST = defineRoute<HookCreateInput>({
  method: 'POST',
  inputSchema: hookCreateInputSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, audit }) {
    const { agentConfigId, handler, handlerKind, ...fields } = input
    await assertAgentInOrg(repo, agentConfigId)

    const normalizedHandler = normalizeHandler(handlerKind, handler)
    await validateHandlerToolReferences(repo, agentConfigId, normalizedHandler)
    const hook = await repo.raw.hook.create({
      data: {
        agentConfigId,
        ...fields,
        handlerKind,
        handler: serializeHandler(normalizedHandler),
      },
    })

    await audit({ action: 'hook.create', target: `hook:${hook.name}`, after: hook as Record<string, unknown> })

    return apiCreated({ hook: serializeHook(hook, []) })
  },
})
