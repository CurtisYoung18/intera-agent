import { z } from 'zod'
import {
  hookCheckpointSchema,
  hookHandlerSchema,
  hookSeveritySchema,
  stableNameSchema,
} from '@intera/shared/contracts/hooks'
import {
  caseTypeCreateRequestSchema,
  caseTypeUpdateRequestSchema,
} from '@intera/shared/contracts/case-types'
import {
  toolCreateRequestSchema,
  toolUpdateRequestSchema,
} from '@intera/shared/contracts/tools'
import {
  scenarioCreateRequestSchema,
  scenarioUpdateRequestSchema,
  scenarioValidationSummarySchema,
} from '@intera/shared/contracts/scenarios'

export const configPilotSurfaceSchema = z.enum([
  'brain',
  'procedures',
  'tools',
  'hooks',
  'hookBindings',
  'knowledge',
  'integrations',
  'scenarios',
])
export type ConfigPilotSurface = z.infer<typeof configPilotSurfaceSchema>

export const configPilotDiffItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  status: z.enum(['added', 'changed', 'removed', 'unchanged', 'placeholder']),
  before: z.string().optional(),
  after: z.string().optional(),
}).strict()
export type ConfigPilotDiffItem = z.infer<typeof configPilotDiffItemSchema>

export const configPilotDiffGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['added', 'changed', 'removed', 'unchanged', 'placeholder']).optional(),
  summary: z.string().optional(),
  items: z.array(configPilotDiffItemSchema),
  placeholder: z.string().optional(),
}).strict()
export type ConfigPilotDiffGroup = z.infer<typeof configPilotDiffGroupSchema>

export const configPilotContextQuerySchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
export type ConfigPilotContextQuery = z.infer<typeof configPilotContextQuerySchema>

export const lockedCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  surface: z.string(),
  reason: z.string(),
  editable: z.literal(false),
}).strict()
export type LockedCapability = z.infer<typeof lockedCapabilitySchema>

export const configPilotPermissionsSchema = z.object({
  role: z.string().optional(),
  canRead: z.boolean(),
  canPropose: z.boolean(),
  canApply: z.boolean(),
  canPublish: z.literal(false),
}).strict()
export type ConfigPilotPermissions = z.infer<typeof configPilotPermissionsSchema>

export const configPilotAgentVersionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  isActive: z.boolean(),
  model: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable().optional(),
}).strict()
export type ConfigPilotAgentVersionSummary = z.infer<typeof configPilotAgentVersionSummarySchema>

export const configPilotContextResponseSchema = z.object({
  agentConfigId: z.string(),
  selected: configPilotAgentVersionSummarySchema,
  active: configPilotAgentVersionSummarySchema.nullable(),
  draft: configPilotAgentVersionSummarySchema.nullable(),
  draftFingerprint: z.string(),
  permissions: configPilotPermissionsSchema,
  lockedCapabilities: z.array(lockedCapabilitySchema),
  configuration: z.record(z.unknown()),
  validation: scenarioValidationSummarySchema,
}).strict()
export type ConfigPilotContextResponse = z.infer<typeof configPilotContextResponseSchema>

const nonEmptyObject = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const brainPatchFieldsSchema = nonEmptyObject(z.object({
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinkingBudget: z.number().int().min(0).max(200000).optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
  maxOutputTokens: z.number().int().min(1).max(200000).nullable().optional(),
  coreSystemPrompt: z.string().nullable().optional(),
  extendedThinking: z.boolean().optional(),
  memoryStrategy: z.union([z.string(), z.record(z.unknown())]).optional(),
  resumePrompt: z.string().nullable().optional(),
}))
export type BrainPatchFields = z.infer<typeof brainPatchFieldsSchema>

const procedureCreateValueSchema = caseTypeCreateRequestSchema.strict()
const procedureUpdateFieldsSchema = caseTypeUpdateRequestSchema.strict()

const hookCreateValueSchema = z.object({
  name: stableNameSchema,
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  checkpoint: hookCheckpointSchema.default('PreToolUse'),
  handlerKind: z.enum(['declarative', 'code', 'http']).default('declarative'),
  handler: hookHandlerSchema.optional(),
  enabled: z.boolean().default(true),
  severity: hookSeveritySchema.default('medium'),
}).strict()

const hookUpdateFieldsSchema = hookCreateValueSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

const hookBindingValueSchema = z.object({
  hookName: stableNameSchema,
  scopeType: z.enum(['agent', 'caseType', 'procedureStep', 'tool']),
  caseTypeType: stableNameSchema.optional(),
  procedureStepId: z.string().min(1).optional(),
  toolName: stableNameSchema.optional(),
  enabled: z.boolean().default(true),
}).strict()

const knowledgeFieldsSchema = z.object({
  name: stableNameSchema.optional(),
  description: z.string().nullable().optional(),
  groupIds: z.array(z.string()).optional(),
  dataIds: z.array(z.string()).nullable().optional(),
  embeddingRate: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(1).max(30).optional(),
  rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().min(0).max(1).nullable().optional(),
  modelControlTopK: z.boolean().optional(),
  caseTypeTag: stableNameSchema.nullable().optional(),
  enabled: z.boolean().optional(),
}).strict()

const integrationFieldsSchema = z.object({
  channel: stableNameSchema.optional(),
  enabled: z.boolean().optional(),
  credentialRefs: z.record(z.string()).optional(),
  toolOverrides: z.record(z.unknown()).nullable().optional(),
  defaults: z.record(z.unknown()).nullable().optional(),
  transferStrategy: z.enum(['transfer_chat', 'consult', 'silent_task']).nullable().optional(),
  transferTarget: z.record(z.unknown()).nullable().optional(),
}).strict()

export const configPilotPatchSchema = z.union([
  z.object({
    surface: z.literal('brain'),
    operation: z.literal('update'),
    fields: brainPatchFieldsSchema,
  }).strict(),
  z.object({
    surface: z.literal('procedures'),
    operation: z.literal('create'),
    value: procedureCreateValueSchema,
  }).strict(),
  z.object({
    surface: z.literal('procedures'),
    operation: z.literal('update'),
    target: z.object({ type: stableNameSchema }).strict(),
    fields: procedureUpdateFieldsSchema,
  }).strict(),
  z.object({
    surface: z.literal('tools'),
    operation: z.literal('create'),
    value: toolCreateRequestSchema.strict(),
  }).strict(),
  z.object({
    surface: z.literal('tools'),
    operation: z.literal('update'),
    target: z.object({ name: stableNameSchema }).strict(),
    fields: toolUpdateRequestSchema.strict(),
  }).strict(),
  z.object({
    surface: z.literal('hooks'),
    operation: z.literal('create'),
    value: hookCreateValueSchema,
  }).strict(),
  z.object({
    surface: z.literal('hooks'),
    operation: z.literal('update'),
    target: z.object({ name: stableNameSchema }).strict(),
    fields: hookUpdateFieldsSchema,
  }).strict(),
  z.object({
    surface: z.literal('hookBindings'),
    operation: z.literal('create'),
    value: hookBindingValueSchema,
  }).strict(),
  z.object({
    surface: z.literal('knowledge'),
    operation: z.literal('create'),
    value: knowledgeFieldsSchema.required({ name: true }),
  }).strict(),
  z.object({
    surface: z.literal('knowledge'),
    operation: z.literal('update'),
    target: z.object({ name: stableNameSchema }).strict(),
    fields: knowledgeFieldsSchema.refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
  }).strict(),
  z.object({
    surface: z.literal('integrations'),
    operation: z.literal('upsert'),
    target: z.object({ channel: stableNameSchema }).strict(),
    fields: integrationFieldsSchema,
  }).strict(),
  z.object({
    surface: z.literal('scenarios'),
    operation: z.literal('create'),
    value: scenarioCreateRequestSchema.strict(),
  }).strict(),
  z.object({
    surface: z.literal('scenarios'),
    operation: z.literal('update'),
    target: z.object({ name: stableNameSchema }).strict(),
    fields: scenarioUpdateRequestSchema.strict(),
  }).strict(),
])
export type ConfigPilotPatch = z.infer<typeof configPilotPatchSchema>

export const configPilotProposalSchema = z.object({
  id: z.string().optional(),
  pilotProposalId: z.string().optional(),
  baseDraftFingerprint: z.string().optional(),
  targetSurface: configPilotSurfaceSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().optional(),
  patches: z.array(configPilotPatchSchema).min(1).max(8),
  diffGroups: z.array(configPilotDiffGroupSchema).default([]),
  receiptSuggestions: z.array(z.string()).default([]),
  runSuggestions: z.array(z.string()).default([]),
  safetyNotes: z.array(z.string()).default([]),
}).strict()
export type ConfigPilotProposal = z.infer<typeof configPilotProposalSchema>

export const configPilotProposeRequestSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  request: z.string().trim().min(1, 'request is required').max(8000),
  targetSurface: configPilotSurfaceSchema.optional(),
}).strict()
export type ConfigPilotProposeRequest = z.infer<typeof configPilotProposeRequestSchema>

export const configPilotProposeResponseSchema = z.object({
  proposal: configPilotProposalSchema,
  modelUsed: z.string(),
  promptVersion: z.string(),
}).strict()
export type ConfigPilotProposeResponse = z.infer<typeof configPilotProposeResponseSchema>

export const configPilotApplyRequestSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  accepted: z.boolean(),
  proposal: configPilotProposalSchema,
}).strict()
export type ConfigPilotApplyRequest = z.infer<typeof configPilotApplyRequestSchema>

export const configPilotApplyResponseSchema = z.object({
  appliedPatches: z.array(z.object({
    surface: configPilotSurfaceSchema,
    operation: z.string(),
    target: z.string(),
  }).strict()),
  draftAgentConfigId: z.string(),
  createdDraft: z.boolean(),
  validation: scenarioValidationSummarySchema,
  artifacts: z.object({
    scenarios: z.array(z.unknown()).default([]),
  }).strict(),
}).strict()
export type ConfigPilotApplyResponse = z.infer<typeof configPilotApplyResponseSchema>
