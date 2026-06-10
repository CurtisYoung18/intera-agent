import { z } from 'zod'
import { ValidationError } from '@/lib/api/define-route'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import {
  hookCheckpointSchema,
  hookHandlerSchema,
  hookSeveritySchema,
  stableNameSchema,
  type HookHandler,
  type HookScopeType,
} from '@intera/shared/contracts/hooks'
import { parseProcedure } from '@intera/shared/contracts/case-types'

export const agentConfigQuerySchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
export type AgentConfigQueryInput = z.infer<typeof agentConfigQuerySchema>

export const hookHandlerKindSchema = z.enum(['declarative', 'code', 'http'])
export type HookHandlerKind = z.infer<typeof hookHandlerKindSchema>

const handlerInputSchema = z.union([hookHandlerSchema, z.string()])

export const hookCreateInputSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  name: stableNameSchema,
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  checkpoint: hookCheckpointSchema.default('PreToolUse'),
  handlerKind: hookHandlerKindSchema.default('declarative'),
  handler: handlerInputSchema.optional(),
  enabled: z.boolean().default(true),
  severity: hookSeveritySchema.default('medium'),
})
export type HookCreateInput = z.infer<typeof hookCreateInputSchema>

export const hookUpdateInputSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  name: stableNameSchema.optional(),
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  checkpoint: hookCheckpointSchema.optional(),
  handlerKind: hookHandlerKindSchema.optional(),
  handler: handlerInputSchema.optional(),
  enabled: z.boolean().optional(),
  severity: hookSeveritySchema.optional(),
})
export type HookUpdateInput = z.infer<typeof hookUpdateInputSchema>

export const bindingScopeInputSchema = z.object({
  scopeType: z.enum(['agent', 'caseType', 'procedureStep', 'tool']),
  caseTypeId: z.string().optional(),
  procedureStepId: z.string().optional(),
  toolId: z.string().optional(),
})
export type BindingScopeInput = z.infer<typeof bindingScopeInputSchema>

export const hookBindingCreateInputSchema = agentConfigQuerySchema
  .merge(bindingScopeInputSchema)
  .extend({ enabled: z.boolean().default(true) })
export type HookBindingCreateInput = z.infer<typeof hookBindingCreateInputSchema>

export const hookBindingUpdateInputSchema = agentConfigQuerySchema.extend({
  scopeType: z.enum(['agent', 'caseType', 'procedureStep', 'tool']).optional(),
  caseTypeId: z.string().nullable().optional(),
  procedureStepId: z.string().nullable().optional(),
  toolId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})
export type HookBindingUpdateInput = z.infer<typeof hookBindingUpdateInputSchema>

export interface HookRouteParams {
  name: string
}

export interface HookBindingRouteParams extends HookRouteParams {
  id: string
}

type HookRow = {
  id: string
  agentConfigId: string
  name: string
  displayName?: string | null
  description?: string | null
  checkpoint: string
  handlerKind: string
  handler: string
  enabled: boolean
  severity: string
  createdAt?: Date | string
  updatedAt?: Date | string
}

type HookBindingRow = {
  id: string
  agentConfigId: string
  hookId: string
  scopeType: string
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  toolId?: string | null
  enabled: boolean
  createdAt?: Date | string
  updatedAt?: Date | string
}

type CaseTypePickerRow = {
  id: string
  type: string
  displayName?: string | null
  procedure?: string | null
  enabled?: boolean
}

type ToolPickerRow = {
  id: string
  name: string
  description?: string | null
  mode?: string | null
  enabled?: boolean
}

export function defaultHandlerForKind(kind: HookHandlerKind): HookHandler {
  if (kind === 'code') {
    return {
      kind: 'code',
      runtime: 'javascript',
      source: 'async function hook(ctx) {\n  return { action: "allow" }\n}',
    }
  }
  if (kind === 'http') {
    return {
      kind: 'http',
      endpoint: 'https://example.com/intera-hook',
      method: 'POST',
      timeoutMs: 5000,
    }
  }
  return {
    kind: 'declarative',
    check: {},
    effect: { action: 'allow' },
  }
}

function parseRawHandler(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function normalizeHandler(kind: HookHandlerKind, input: unknown): HookHandler {
  const raw = input === undefined ? defaultHandlerForKind(kind) : input
  let candidate = raw
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw)
    } catch {
      throw new ValidationError('Hook handler must be valid JSON')
    }
  }

  const parsed = hookHandlerSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ValidationError('Hook handler is invalid', {
      handler: parsed.error.issues.map((issue) => issue.message).join('; '),
    })
  }
  if (parsed.data.kind !== kind) {
    throw new ValidationError(`handlerKind "${kind}" must match handler.kind "${parsed.data.kind}"`)
  }
  return parsed.data
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function validateHandlerToolReferences(
  repo: RepoForOrg,
  agentConfigId: string,
  handler: HookHandler,
): Promise<void> {
  if (handler.kind !== 'declarative') return

  const check = record(handler.check)
  const match = record(check.match)
  const referenced = new Set<string>([
    ...stringArray(match.tools),
    ...stringArray(check.denyTools),
    ...stringArray(check.requireTools),
    ...stringArray(check.requireToolsAny),
  ])
  if (referenced.size === 0) return

  const tools = await repo.raw.tool.findMany({
    where: { agentConfigId },
    select: { name: true },
  }) as Array<{ name: string }>
  const validNames = new Set(tools.map((tool) => tool.name))
  const missing = [...referenced].filter((name) => !validNames.has(name))
  if (missing.length > 0) {
    throw new ValidationError('Hook rule references unknown Tool names', {
      tools: missing.join(', '),
    })
  }
}

export function serializeHandler(handler: HookHandler): string {
  return JSON.stringify(handler)
}

export function serializeHook(row: HookRow, bindings: HookBindingRow[] = []) {
  return {
    ...row,
    handler: parseRawHandler(row.handler),
    bindings: bindings.map((binding) => serializeBinding(binding, row.name)),
  }
}

export function serializeBinding(row: HookBindingRow, hookName?: string) {
  return {
    ...row,
    hookName,
  }
}

export function collectProcedureSteps(caseTypes: CaseTypePickerRow[]) {
  return caseTypes.flatMap((ct) => {
    const procedure = parseProcedure(ct.procedure)
    if (!procedure) return []
    return procedure.steps.map((step) => ({
      caseTypeId: ct.id,
      caseTypeType: ct.type,
      caseTypeDisplayName: ct.displayName ?? ct.type,
      id: step.id,
      action: step.action,
      target: step.target ?? null,
      guidance: step.guidance ?? null,
      label: `${ct.displayName ?? ct.type} / ${step.id}`,
    }))
  })
}

export async function resolveBindingScope(
  repo: RepoForOrg,
  agentConfigId: string,
  input: BindingScopeInput,
) {
  if (input.scopeType === 'agent') {
    return {
      scopeType: 'agent' as const,
      scopeKey: 'agent',
      caseTypeId: null,
      procedureStepId: null,
      toolId: null,
    }
  }

  if (input.scopeType === 'caseType') {
    if (!input.caseTypeId) throw new ValidationError('caseTypeId is required for caseType bindings')
    const caseType = await repo.raw.caseType.findFirst({
      where: { agentConfigId, id: input.caseTypeId },
      select: { id: true },
    })
    if (!caseType) throw new ValidationError('CaseType reference is invalid')
    return {
      scopeType: 'caseType' as const,
      scopeKey: `caseType:${caseType.id}`,
      caseTypeId: caseType.id,
      procedureStepId: null,
      toolId: null,
    }
  }

  if (input.scopeType === 'procedureStep') {
    if (!input.caseTypeId) throw new ValidationError('caseTypeId is required for procedureStep bindings')
    if (!input.procedureStepId) throw new ValidationError('procedureStepId is required for procedureStep bindings')
    const caseType = await repo.raw.caseType.findFirst({
      where: { agentConfigId, id: input.caseTypeId },
      select: { id: true, procedure: true },
    })
    if (!caseType) throw new ValidationError('CaseType reference is invalid')
    const procedure = parseProcedure(caseType.procedure)
    if (!procedure?.steps.some((step) => step.id === input.procedureStepId)) {
      throw new ValidationError('ProcedureStep reference is invalid')
    }
    return {
      scopeType: 'procedureStep' as const,
      scopeKey: `procedureStep:${caseType.id}:${input.procedureStepId}`,
      caseTypeId: caseType.id,
      procedureStepId: input.procedureStepId,
      toolId: null,
    }
  }

  if (!input.toolId) throw new ValidationError('toolId is required for tool bindings')
  const tool = await repo.raw.tool.findFirst({
    where: { agentConfigId, id: input.toolId },
    select: { id: true },
  })
  if (!tool) throw new ValidationError('Tool reference is invalid')
  return {
    scopeType: 'tool' as const,
    scopeKey: `tool:${tool.id}`,
    caseTypeId: null,
    procedureStepId: null,
    toolId: tool.id,
  }
}

export function scopeInputFromExisting(
  existing: HookBindingRow,
  input: HookBindingUpdateInput,
): BindingScopeInput {
  return {
    scopeType: (input.scopeType ?? existing.scopeType) as HookScopeType,
    caseTypeId: input.caseTypeId === null ? undefined : (input.caseTypeId ?? existing.caseTypeId ?? undefined),
    procedureStepId: input.procedureStepId === null ? undefined : (input.procedureStepId ?? existing.procedureStepId ?? undefined),
    toolId: input.toolId === null ? undefined : (input.toolId ?? existing.toolId ?? undefined),
  }
}

export function hasScopeUpdate(input: HookBindingUpdateInput): boolean {
  return input.scopeType !== undefined
    || input.caseTypeId !== undefined
    || input.procedureStepId !== undefined
    || input.toolId !== undefined
}

export type { HookRow, HookBindingRow, CaseTypePickerRow, ToolPickerRow }
