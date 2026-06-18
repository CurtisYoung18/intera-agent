// Hooks domain contract — shared schemas for Hook runtime, API, and packages.

import { z } from 'zod'

export const STABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/

export const stableNameSchema = z.string()
  .min(1, 'stable name is required')
  .regex(STABLE_NAME_PATTERN, 'Use a stable lowercase name such as investigate_before_resolve')

// Runtime-observed tool names can include legacy customer config such as
// `CheckLatestDepositStatus`. Keep authoring contracts strict, but do not crash
// Hook evaluation when replaying or executing already-shipped tool names.
const runtimeToolNameSchema = z.string().min(1, 'tool name is required')

export const HOOK_CHECKPOINTS = ['PreToolUse', 'PostToolUse', 'Stop'] as const
export const hookCheckpointSchema = z.enum(HOOK_CHECKPOINTS)
export type HookCheckpoint = z.infer<typeof hookCheckpointSchema>

export const LEGACY_HOOK_CHECKPOINTS = ['preTool', 'postTool', 'preFinalize'] as const
export const legacyHookCheckpointSchema = z.enum(LEGACY_HOOK_CHECKPOINTS)
export type LegacyHookCheckpoint = z.infer<typeof legacyHookCheckpointSchema>

export function mapLegacyHookCheckpoint(value: string | null | undefined): HookCheckpoint {
  switch (value) {
    case 'preTool':
    case 'PreToolUse':
      return 'PreToolUse'
    case 'postTool':
    case 'PostToolUse':
      return 'PostToolUse'
    case 'preFinalize':
    case 'Stop':
      return 'Stop'
    default:
      return 'Stop'
  }
}

export const HOOK_DECISION_ACTIONS = ['allow', 'warn', 'block', 'escalate'] as const
export const hookDecisionActionSchema = z.enum(HOOK_DECISION_ACTIONS)
export type HookDecisionAction = z.infer<typeof hookDecisionActionSchema>

export const hookSeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type HookSeverity = z.infer<typeof hookSeveritySchema>

export const hookDecisionSchema = z.object({
  action: hookDecisionActionSchema,
  reason: z.string().optional(),
  guidance: z.string().optional(),
  severity: hookSeveritySchema.optional(),
  trace: z.record(z.unknown()).optional(),
  humanTask: z.object({
    queue: z.string().optional(),
    question: z.string().optional(),
    fields: z.array(z.record(z.unknown())).optional(),
  }).optional(),
}).passthrough()
export type HookDecision = z.infer<typeof hookDecisionSchema>

export const hookSecretRefSchema = z.object({
  name: stableNameSchema,
  ref: z.string().min(1, 'secret ref is required'),
})
export type HookSecretRef = z.infer<typeof hookSecretRefSchema>

export const hookCheckSchema = z.record(z.unknown())
export type HookCheck = z.infer<typeof hookCheckSchema>

export const hookEffectSchema = z.record(z.unknown())
export type HookEffect = z.infer<typeof hookEffectSchema>

export const declarativeHookHandlerSchema = z.object({
  kind: z.literal('declarative'),
  check: hookCheckSchema,
  effect: hookEffectSchema,
  legacy: z.record(z.unknown()).optional(),
})

export const codeHookHandlerSchema = z.object({
  kind: z.literal('code'),
  runtime: z.literal('javascript'),
  source: z.string().min(1, 'source is required'),
})

export const httpHookHandlerSchema = z.object({
  kind: z.literal('http'),
  endpoint: z.string().min(1, 'endpoint is required'),
  method: z.literal('POST'),
  headers: z.record(z.string()).optional(),
  secretRefs: z.array(hookSecretRefSchema).optional(),
  timeoutMs: z.number().int().positive().max(30000),
})

export const hookHandlerSchema = z.discriminatedUnion('kind', [
  declarativeHookHandlerSchema,
  codeHookHandlerSchema,
  httpHookHandlerSchema,
])
export type HookHandler = z.infer<typeof hookHandlerSchema>

export const HOOK_SCOPE_TYPES = ['agent', 'caseType', 'procedureStep', 'tool'] as const
export const hookScopeTypeSchema = z.enum(HOOK_SCOPE_TYPES)
export type HookScopeType = z.infer<typeof hookScopeTypeSchema>

export const hookBindingScopeSchema = z.discriminatedUnion('scopeType', [
  z.object({
    scopeType: z.literal('agent'),
    scopeKey: z.literal('agent'),
  }),
  z.object({
    scopeType: z.literal('caseType'),
    scopeKey: z.string().regex(/^caseType:[A-Za-z0-9_-]+$/),
    caseTypeId: z.string().min(1).optional(),
    caseTypeName: stableNameSchema.optional(),
  }),
  z.object({
    scopeType: z.literal('procedureStep'),
    scopeKey: z.string().regex(/^procedureStep:[A-Za-z0-9_-]+:[A-Za-z0-9_.-]+$/),
    caseTypeId: z.string().min(1).optional(),
    caseTypeName: stableNameSchema.optional(),
    procedureStepId: z.string().min(1),
  }),
  z.object({
    scopeType: z.literal('tool'),
    scopeKey: z.string().regex(/^tool:[A-Za-z0-9_-]+$/),
    toolId: z.string().min(1).optional(),
    toolName: stableNameSchema.optional(),
  }),
])
export type HookBindingScope = z.infer<typeof hookBindingScopeSchema>

export const hookContextSchema = z.object({
  checkpoint: hookCheckpointSchema,
  agentConfigId: z.string().optional(),
  caseId: z.string().optional(),
  chatId: z.string().optional(),
  caseType: z.object({
    id: z.string().optional(),
    type: stableNameSchema,
    displayName: z.string().optional(),
  }).optional(),
  procedureStepIds: z.array(z.string()).default([]),
  tool: z.object({
    id: z.string().optional(),
    name: runtimeToolNameSchema,
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  }).optional(),
  caseFacts: z.record(z.unknown()).default({}),
  missingFacts: z.array(z.string()).default([]),
  previousToolCalls: z.array(z.object({
    name: runtimeToolNameSchema,
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  }).passthrough()).default([]),
  currentToolCalls: z.array(z.object({
    name: runtimeToolNameSchema,
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  }).passthrough()).default([]),
  traceSummary: z.array(z.record(z.unknown())).default([]),
  replyDraft: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})
export type HookContext = z.infer<typeof hookContextSchema>

export const hookContractSchema = z.object({
  id: z.string().optional(),
  name: stableNameSchema,
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  checkpoint: hookCheckpointSchema,
  handlerKind: z.enum(['declarative', 'code', 'http']),
  handler: hookHandlerSchema,
  enabled: z.boolean().default(true),
  severity: hookSeveritySchema.default('medium'),
})
export type HookContract = z.infer<typeof hookContractSchema>

export const hookBindingContractSchema = z.object({
  id: z.string().optional(),
  hookName: stableNameSchema,
  enabled: z.boolean().default(true),
}).and(hookBindingScopeSchema)
export type HookBindingContract = z.infer<typeof hookBindingContractSchema>
