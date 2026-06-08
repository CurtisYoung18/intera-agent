// GET + PUT + DELETE /api/admin/hooks/[name]
// Foundation Reset F4: item-level Hook CRUD, scoped by agentConfigId.

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  agentConfigQuerySchema,
  defaultHandlerForKind,
  hookUpdateInputSchema,
  normalizeHandler,
  serializeHandler,
  serializeHook,
  type AgentConfigQueryInput,
  type HookBindingRow,
  type HookHandlerKind,
  type HookRouteParams,
  type HookRow,
  type HookUpdateInput,
} from '../_helpers'

export const GET = defineRoute<AgentConfigQueryInput, HookRouteParams>({
  method: 'GET',
  inputSchema: agentConfigQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)

    const hook = await repo.raw.hook.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    }) as HookRow | null
    if (!hook) throw new NotFoundError(`Hook "${params.name}" not found`)

    const bindings = await repo.raw.hookBinding.findMany({
      where: { agentConfigId, hookId: hook.id },
      orderBy: [{ scopeType: 'asc' }, { createdAt: 'asc' }],
    }) as HookBindingRow[]

    return apiOk({ hook: serializeHook(hook, bindings) })
  },
})

export const PUT = defineRoute<HookUpdateInput, HookRouteParams>({
  method: 'PUT',
  inputSchema: hookUpdateInputSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, handler, handlerKind, ...fields } = input
    const hookName = params.name
    await assertAgentInOrg(repo, agentConfigId)

    const existing = await repo.raw.hook.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: hookName } },
    }) as HookRow | null
    if (!existing) throw new NotFoundError(`Hook "${hookName}" not found`)

    const nextKind = (handlerKind ?? existing.handlerKind) as HookHandlerKind
    let nextHandler: string | undefined
    if (handler !== undefined) {
      nextHandler = serializeHandler(normalizeHandler(nextKind, handler))
    } else if (handlerKind && handlerKind !== existing.handlerKind) {
      nextHandler = serializeHandler(defaultHandlerForKind(nextKind))
    }

    const data: Record<string, unknown> = { ...fields }
    if (handlerKind !== undefined) data.handlerKind = handlerKind
    if (nextHandler !== undefined) data.handler = nextHandler

    const hook = await repo.raw.hook.update({
      where: { agentConfigId_name: { agentConfigId, name: hookName } },
      data,
    }) as HookRow

    const bindings = await repo.raw.hookBinding.findMany({
      where: { agentConfigId, hookId: hook.id },
      orderBy: [{ scopeType: 'asc' }, { createdAt: 'asc' }],
    }) as HookBindingRow[]

    await audit({
      action: 'hook.update',
      target: `hook:${hook.name}`,
      before: existing as Record<string, unknown>,
      after: hook as Record<string, unknown>,
    })

    return apiOk({ hook: serializeHook(hook, bindings) })
  },
})

export const DELETE = defineRoute<AgentConfigQueryInput, HookRouteParams>({
  method: 'DELETE',
  inputSchema: agentConfigQuerySchema,
  parseQuery: true,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    const hookName = params.name
    await assertAgentInOrg(repo, agentConfigId)

    const existing = await repo.raw.hook.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: hookName } },
    }) as HookRow | null
    if (!existing) throw new NotFoundError(`Hook "${hookName}" not found`)

    await repo.raw.hook.delete({
      where: { agentConfigId_name: { agentConfigId, name: hookName } },
    })

    await audit({ action: 'hook.delete', target: `hook:${hookName}`, before: existing as Record<string, unknown> })

    return apiOk({ success: true })
  },
})
