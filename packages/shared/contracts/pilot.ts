import { z } from 'zod'
import {
  scenarioExecutionModeSchema,
  scenarioObservedEvidenceInputSchema,
  scenarioReceiptSchema,
  scenarioReceiptStatusSchema,
  scenarioValidationStateSchema,
  scenarioValidationSummarySchema,
} from './scenarios'

export const pilotBindingScopeSchema = z.enum(['draft_agent', 'pre_build_family'])
export type PilotBindingScope = z.infer<typeof pilotBindingScopeSchema>

export const pilotModeSchema = z.enum([
  'build_from_brief',
  'template_tailoring',
  'critique_existing_agent',
  'validation_triage',
  'release_review',
])
export type PilotMode = z.infer<typeof pilotModeSchema>

export const pilotSessionStatusSchema = z.enum(['in_progress', 'handoff_ready', 'archived'])
export type PilotSessionStatus = z.infer<typeof pilotSessionStatusSchema>

export const pilotMessageRoleSchema = z.enum(['user', 'pilot', 'system'])
export type PilotMessageRole = z.infer<typeof pilotMessageRoleSchema>

export const pilotMessageKindSchema = z.enum([
  'message',
  'clarification',
  'proposal',
  'accept',
  'apply',
  'receipt',
  'takeover',
  'compact',
  'handoff',
  'brief',
  'recommendation',
  'plan',
  'trace',
  'archive',
])
export type PilotMessageKind = z.infer<typeof pilotMessageKindSchema>

export const pilotProposalStatusSchema = z.enum([
  'drafted',
  'accepted',
  'applied',
  'rejected',
  'stale',
  'superseded',
])
export type PilotProposalStatus = z.infer<typeof pilotProposalStatusSchema>

export const pilotTodoItemTypeSchema = z.enum([
  'inspection',
  'config_change',
  'scenario_authoring',
  'validation_run',
  'release_handoff',
])
export type PilotTodoItemType = z.infer<typeof pilotTodoItemTypeSchema>

export const pilotTodoItemStatusSchema = z.enum([
  'pending',
  'active',
  'blocked',
  'completed',
  'skipped',
])
export type PilotTodoItemStatus = z.infer<typeof pilotTodoItemStatusSchema>

export const pilotReadinessVerdictSchema = z.enum([
  'not_ready',
  'ready_for_release_review',
])
export type PilotReadinessVerdict = z.infer<typeof pilotReadinessVerdictSchema>

export const pilotObjectRefSchema = z.object({
  type: z.enum([
    'session',
    'proposal',
    'todo_item',
    'todo_plan',
    'handoff',
    'receipt',
    'scenario',
    'agent_config',
    'build_brief',
    'template_recommendation',
    'template_tailoring_plan',
    'scratch_build_plan',
    'inspection_trace',
  ]),
  id: z.string(),
  label: z.string().optional(),
}).strict()
export type PilotObjectRef = z.infer<typeof pilotObjectRefSchema>

export const pilotBlockerSchema = z.object({
  code: z.string(),
  message: z.string(),
  linkedObjectRef: pilotObjectRefSchema.optional(),
}).strict()
export type PilotBlocker = z.infer<typeof pilotBlockerSchema>

export const pilotRiskSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
  linkedObjectRef: pilotObjectRefSchema.optional(),
}).strict()
export type PilotRisk = z.infer<typeof pilotRiskSchema>

export const pilotValidationPlanSchema = z.object({
  requiredScenarios: z.array(z.string()).default([]),
  recommendedScenarios: z.array(z.string()).default([]),
  manualPlaygroundChecks: z.array(z.string()).default([]),
  releaseBlockingCondition: z.string().optional(),
}).strict()
export type PilotValidationPlan = z.infer<typeof pilotValidationPlanSchema>

export const pilotPlanningGroupSchema = z.object({
  groupKey: z.string(),
  title: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().default(true),
  targetSurface: z.string().optional(),
  expectedEffect: z.string().optional(),
  firstValidationTargets: z.array(z.string()).default([]),
}).strict()
export type PilotPlanningGroup = z.infer<typeof pilotPlanningGroupSchema>

export const pilotSessionSummarySchema = z.object({
  confirmedGoals: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  currentPlanSummary: z.string().optional(),
  latestProposalSummary: z.string().optional(),
  latestValidationSummary: z.string().optional(),
  nextRecommendedStep: z.string().optional(),
}).strict()
export type PilotSessionSummary = z.infer<typeof pilotSessionSummarySchema>

export const pilotPermissionsSchema = z.object({
  role: z.string().optional(),
  canRead: z.boolean(),
  canPropose: z.boolean(),
  canAccept: z.boolean(),
  canApply: z.boolean(),
  canTakeOver: z.boolean(),
  canGenerateHandoff: z.boolean(),
  canPublish: z.literal(false),
}).strict()
export type PilotPermissions = z.infer<typeof pilotPermissionsSchema>

export const pilotCapabilityManifestSchema = z.object({
  capabilityKey: z.string(),
  surface: z.string(),
  mode: z.enum(['read', 'test', 'write']),
  llmVisible: z.enum(['full', 'redacted', 'metadata_only']),
  requiresDraft: z.boolean(),
  requiresExplicitAccept: z.boolean(),
  callableByPilot: z.boolean(),
  toolFamily: z.enum([
    'inspect_config_surface',
    'inspect_config_object',
    'compare_config_versions',
    'inspect_validation_artifact',
    'draft_batch_proposal',
    'revise_batch_proposal',
    'run_named_scenario',
    'generate_release_handoff',
  ]),
}).strict()
export type PilotCapabilityManifest = z.infer<typeof pilotCapabilityManifestSchema>

export const pilotInternalModelResolverRequestSchema = z.object({
  purpose: z.enum(['proposal', 'compact', 'critique', 'validation_summary', 'handoff']),
  agentConfigModel: z.string().nullable().optional(),
  overrideModel: z.string().nullable().optional(),
}).strict()
export type PilotInternalModelResolverRequest = z.infer<typeof pilotInternalModelResolverRequestSchema>

export const pilotInternalModelResolverResultSchema = z.object({
  model: z.string(),
  source: z.enum(['override', 'agent_config', 'system_default']),
  promptVersion: z.string().optional(),
}).strict()
export type PilotInternalModelResolverResult = z.infer<typeof pilotInternalModelResolverResultSchema>

export const pilotSessionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  agentConfigId: z.string().nullable().optional(),
  agentFamilyKey: z.string().nullable().optional(),
  bindingScope: pilotBindingScopeSchema,
  createdByUserId: z.string(),
  activeEditorUserId: z.string().nullable().optional(),
  status: pilotSessionStatusSchema,
  title: z.string(),
  currentMode: pilotModeSchema,
  summary: pilotSessionSummarySchema.nullable().optional(),
  pinnedState: z.record(z.unknown()).nullable().optional(),
  currentBuildBriefId: z.string().nullable().optional(),
  currentTodoPlanId: z.string().nullable().optional(),
  currentActiveTodoItemId: z.string().nullable().optional(),
  latestProposalId: z.string().nullable().optional(),
  latestReceiptRunId: z.string().nullable().optional(),
  latestHandoffId: z.string().nullable().optional(),
  memoryDegraded: z.boolean(),
  compactedAt: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  isCurrent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type PilotSession = z.infer<typeof pilotSessionSchema>

export const pilotMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: pilotMessageRoleSchema,
  kind: pilotMessageKindSchema,
  content: z.string(),
  structuredPayload: z.record(z.unknown()).nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
}).strict()
export type PilotMessage = z.infer<typeof pilotMessageSchema>

export const pilotProposalSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  todoItemId: z.string().nullable().optional(),
  parentProposalId: z.string().nullable().optional(),
  status: pilotProposalStatusSchema,
  primarySurface: z.string(),
  title: z.string(),
  summary: z.string(),
  intentSummary: z.string().nullable().optional(),
  batchRationale: z.string().nullable().optional(),
  blastRadius: z.string().nullable().optional(),
  validationPlan: pilotValidationPlanSchema.nullable().optional(),
  proposal: z.record(z.unknown()),
  diffGroups: z.array(z.record(z.unknown())).nullable().optional(),
  patchCount: z.number().int().nonnegative(),
  baseAgentConfigId: z.string(),
  baseDraftFingerprint: z.string(),
  acceptedByUserId: z.string().nullable().optional(),
  acceptedAt: z.string().nullable().optional(),
  appliedByUserId: z.string().nullable().optional(),
  appliedAt: z.string().nullable().optional(),
  appliedDraftAgentConfigId: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type PilotProposal = z.infer<typeof pilotProposalSchema>

export const pilotTodoItemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  planId: z.string(),
  type: pilotTodoItemTypeSchema,
  status: pilotTodoItemStatusSchema,
  title: z.string(),
  description: z.string().nullable().optional(),
  isRequired: z.boolean(),
  visibleReason: z.string().nullable().optional(),
  latestProposalId: z.string().nullable().optional(),
  latestReceiptRunId: z.string().nullable().optional(),
  latestHandoffId: z.string().nullable().optional(),
  targetScenarioName: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type PilotTodoItem = z.infer<typeof pilotTodoItemSchema>

export const pilotTodoPlanSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string().nullable().optional(),
  isCurrent: z.boolean(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(pilotTodoItemSchema).default([]),
}).strict()
export type PilotTodoPlan = z.infer<typeof pilotTodoPlanSchema>

export const pilotHandoffSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  draftAgentConfigId: z.string(),
  draftFingerprint: z.string(),
  handoffSummary: z.string(),
  readinessVerdict: pilotReadinessVerdictSchema,
  blockers: z.array(pilotBlockerSchema).default([]),
  risks: z.array(pilotRiskSchema).default([]),
  referencedProposalIds: z.array(z.string()).default([]),
  referencedReceiptIds: z.array(z.string()).default([]),
  coveredTodoItemIds: z.array(z.string()).default([]),
  isCurrent: z.boolean(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type PilotHandoff = z.infer<typeof pilotHandoffSchema>

export const pilotBuildBriefStatusSchema = z.enum(['draft', 'confirmed', 'superseded'])
export type PilotBuildBriefStatus = z.infer<typeof pilotBuildBriefStatusSchema>

export const agentBuildBriefSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  agentFamilyKey: z.string(),
  sessionId: z.string().nullable().optional(),
  revision: z.number().int().positive(),
  status: pilotBuildBriefStatusSchema,
  businessGoal: z.string().nullable().optional(),
  targetChannels: z.array(z.string()).default([]),
  supportedUseCases: z.array(z.string()).default([]),
  outOfScopeUseCases: z.array(z.string()).default([]),
  escalationPolicy: z.string().nullable().optional(),
  requiredToolsAndIntegrations: z.array(z.string()).default([]),
  toneAndResponseConstraints: z.array(z.string()).default([]),
  validationExpectations: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  isCurrent: z.boolean(),
  confirmedAt: z.string().nullable().optional(),
  confirmedByUserId: z.string().nullable().optional(),
  supersededAt: z.string().nullable().optional(),
  supersededById: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type AgentBuildBrief = z.infer<typeof agentBuildBriefSchema>

export const templateCandidateSchema = z.object({
  templateId: z.string(),
  label: z.string(),
  fitSummary: z.string().optional(),
  mismatchSummary: z.string().optional(),
}).strict()
export type TemplateCandidate = z.infer<typeof templateCandidateSchema>

export const templateRecommendationSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  briefId: z.string(),
  candidateTemplates: z.array(templateCandidateSchema).default([]),
  recommendedTemplateId: z.string().nullable().optional(),
  fitSummary: z.string(),
  mismatchSummary: z.string().nullable().optional(),
  whyNotScratch: z.string().nullable().optional(),
  whyScratch: z.string().nullable().optional(),
  isCurrent: z.boolean(),
  supersededAt: z.string().nullable().optional(),
  supersededById: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type TemplateRecommendation = z.infer<typeof templateRecommendationSchema>

export const templateTailoringPlanSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  briefId: z.string(),
  recommendationId: z.string().nullable().optional(),
  selectedTemplateId: z.string(),
  fitAreas: z.array(z.string()).default([]),
  mismatchAreas: z.array(z.string()).default([]),
  requiredTailoringGroups: z.array(pilotPlanningGroupSchema).default([]),
  recommendedTailoringGroups: z.array(pilotPlanningGroupSchema).default([]),
  firstValidationTargets: z.array(z.string()).default([]),
  isCurrent: z.boolean(),
  supersededAt: z.string().nullable().optional(),
  supersededById: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type TemplateTailoringPlan = z.infer<typeof templateTailoringPlanSchema>

export const scratchBuildPlanSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  briefId: z.string(),
  scratchScope: z.string(),
  proposedFoundationSurfaces: z.array(z.string()).default([]),
  requiredBuildGroups: z.array(pilotPlanningGroupSchema).default([]),
  recommendedBuildGroups: z.array(pilotPlanningGroupSchema).default([]),
  initialToolingPlan: z.array(z.string()).default([]),
  initialValidationTargets: z.array(z.string()).default([]),
  isCurrent: z.boolean(),
  supersededAt: z.string().nullable().optional(),
  supersededById: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
export type ScratchBuildPlan = z.infer<typeof scratchBuildPlanSchema>

export const pilotInspectionTraceStepSchema = z.object({
  toolFamily: z.string(),
  target: z.string(),
  visibility: z.enum(['full', 'redacted', 'metadata_only']),
  summary: z.string(),
  evidenceSufficientAfterStep: z.boolean().default(false),
}).strict()
export type PilotInspectionTraceStep = z.infer<typeof pilotInspectionTraceStepSchema>

export const pilotInspectionTraceSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  sessionId: z.string(),
  actionClass: z.enum(['clarification', 'proposal', 'revision', 'validation_summary', 'handoff']),
  targetObjectRef: pilotObjectRefSchema.nullable().optional(),
  steps: z.array(pilotInspectionTraceStepSchema).default([]),
  evidenceSufficient: z.boolean(),
  stopReason: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string(),
}).strict()
export type PilotInspectionTrace = z.infer<typeof pilotInspectionTraceSchema>

export const pilotValidationReleaseEffectSchema = z.enum([
  'restores_runtime_validation',
  'debug_only_fixture',
  'failed_blocks_release',
  'runtime_blocked',
])
export type PilotValidationReleaseEffect = z.infer<typeof pilotValidationReleaseEffectSchema>

export const pilotValidationTriageSchema = z.object({
  scenarioName: z.string(),
  receiptRunId: z.string(),
  status: scenarioReceiptStatusSchema,
  executionMode: scenarioExecutionModeSchema,
  validationState: scenarioValidationStateSchema,
  runtimeBacked: z.boolean(),
  releaseReadinessEffect: pilotValidationReleaseEffectSchema,
  summary: z.string(),
  nextRecommendedStep: z.string(),
  failureReasons: z.array(z.string()).default([]),
}).strict()
export type PilotValidationTriage = z.infer<typeof pilotValidationTriageSchema>

export const pilotSessionSnapshotSchema = z.object({
  session: pilotSessionSchema,
  permissions: pilotPermissionsSchema,
  draftFingerprint: z.string(),
  messages: z.array(pilotMessageSchema),
  proposals: z.array(pilotProposalSchema),
  todoPlans: z.array(pilotTodoPlanSchema),
  handoffs: z.array(pilotHandoffSchema),
  buildBriefs: z.array(agentBuildBriefSchema).default([]),
  templateRecommendations: z.array(templateRecommendationSchema).default([]),
  templateTailoringPlans: z.array(templateTailoringPlanSchema).default([]),
  scratchBuildPlans: z.array(scratchBuildPlanSchema).default([]),
  inspectionTraces: z.array(pilotInspectionTraceSchema).default([]),
}).strict()
export type PilotSessionSnapshot = z.infer<typeof pilotSessionSnapshotSchema>

export const pilotCurrentSessionRequestSchema = z.object({
  agentConfigId: z.string().min(1).optional(),
  agentFamilyKey: z.string().min(1).optional(),
  bindingScope: pilotBindingScopeSchema.default('draft_agent'),
  currentMode: pilotModeSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.bindingScope === 'draft_agent' && !value.agentConfigId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agentConfigId'], message: 'agentConfigId is required for draft_agent sessions' })
  }
  if (value.bindingScope === 'pre_build_family' && !value.agentFamilyKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agentFamilyKey'], message: 'agentFamilyKey is required for pre_build_family sessions' })
  }
})
export type PilotCurrentSessionRequest = z.infer<typeof pilotCurrentSessionRequestSchema>

export const pilotArchiveSessionRequestSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().max(1000).optional(),
}).strict()
export type PilotArchiveSessionRequest = z.infer<typeof pilotArchiveSessionRequestSchema>

export const pilotTakeoverSessionRequestSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().max(1000).optional(),
}).strict()
export type PilotTakeoverSessionRequest = z.infer<typeof pilotTakeoverSessionRequestSchema>

export const pilotManualCompactRequestSchema = z.object({
  sessionId: z.string().min(1),
}).strict()
export type PilotManualCompactRequest = z.infer<typeof pilotManualCompactRequestSchema>

export const pilotBuildBriefUpsertRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  agentFamilyKey: z.string().min(1),
  businessGoal: z.string().max(4000).nullable().optional(),
  targetChannels: z.array(z.string()).default([]),
  supportedUseCases: z.array(z.string()).default([]),
  outOfScopeUseCases: z.array(z.string()).default([]),
  escalationPolicy: z.string().max(4000).nullable().optional(),
  requiredToolsAndIntegrations: z.array(z.string()).default([]),
  toneAndResponseConstraints: z.array(z.string()).default([]),
  validationExpectations: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
}).strict()
export type PilotBuildBriefUpsertRequest = z.infer<typeof pilotBuildBriefUpsertRequestSchema>

export const pilotConfirmBriefRequestSchema = z.object({
  briefId: z.string().min(1),
}).strict()
export type PilotConfirmBriefRequest = z.infer<typeof pilotConfirmBriefRequestSchema>

export const pilotCreateTemplateRecommendationRequestSchema = z.object({
  briefId: z.string().min(1),
  candidateTemplates: z.array(templateCandidateSchema).default([]),
  recommendedTemplateId: z.string().nullable().optional(),
  fitSummary: z.string().min(1).max(8000),
  mismatchSummary: z.string().max(8000).nullable().optional(),
  whyNotScratch: z.string().max(8000).nullable().optional(),
  whyScratch: z.string().max(8000).nullable().optional(),
}).strict()
export type PilotCreateTemplateRecommendationRequest = z.infer<typeof pilotCreateTemplateRecommendationRequestSchema>

export const pilotCreateTemplateTailoringPlanRequestSchema = z.object({
  briefId: z.string().min(1),
  recommendationId: z.string().min(1).optional(),
  selectedTemplateId: z.string().min(1),
  fitAreas: z.array(z.string()).default([]),
  mismatchAreas: z.array(z.string()).default([]),
  requiredTailoringGroups: z.array(pilotPlanningGroupSchema).default([]),
  recommendedTailoringGroups: z.array(pilotPlanningGroupSchema).default([]),
  firstValidationTargets: z.array(z.string()).default([]),
}).strict()
export type PilotCreateTemplateTailoringPlanRequest = z.infer<typeof pilotCreateTemplateTailoringPlanRequestSchema>

export const pilotCreateScratchBuildPlanRequestSchema = z.object({
  briefId: z.string().min(1),
  scratchScope: z.string().min(1).default('default'),
  proposedFoundationSurfaces: z.array(z.string()).default([]),
  requiredBuildGroups: z.array(pilotPlanningGroupSchema).default([]),
  recommendedBuildGroups: z.array(pilotPlanningGroupSchema).default([]),
  initialToolingPlan: z.array(z.string()).default([]),
  initialValidationTargets: z.array(z.string()).default([]),
}).strict()
export type PilotCreateScratchBuildPlanRequest = z.infer<typeof pilotCreateScratchBuildPlanRequestSchema>

export const pilotPromotePlanningGroupsRequestSchema = z.object({
  sessionId: z.string().min(1),
  sourceType: z.enum(['template_tailoring_plan', 'scratch_build_plan']),
  sourceId: z.string().min(1),
  groupKeys: z.array(z.string()).default([]),
}).strict()
export type PilotPromotePlanningGroupsRequest = z.infer<typeof pilotPromotePlanningGroupsRequestSchema>

export const pilotRecordInspectionTraceRequestSchema = z.object({
  sessionId: z.string().min(1),
  actionClass: pilotInspectionTraceSchema.shape.actionClass,
  targetObjectRef: pilotObjectRefSchema.optional(),
  steps: z.array(pilotInspectionTraceStepSchema).default([]),
  evidenceSufficient: z.boolean().default(false),
  stopReason: z.string().max(4000).nullable().optional(),
}).strict()
export type PilotRecordInspectionTraceRequest = z.infer<typeof pilotRecordInspectionTraceRequestSchema>

export const pilotRunScenarioRequestSchema = z.object({
  sessionId: z.string().min(1),
  agentConfigId: z.string().min(1),
  scenarioName: z.string().min(1),
  executionMode: scenarioExecutionModeSchema.default('agentRuntime'),
  observed: scenarioObservedEvidenceInputSchema.optional(),
  todoItemId: z.string().min(1).optional(),
}).strict()
export type PilotRunScenarioRequest = z.infer<typeof pilotRunScenarioRequestSchema>

export const pilotRunScenarioResponseSchema = z.object({
  receipt: scenarioReceiptSchema,
  validation: scenarioValidationSummarySchema,
  triage: pilotValidationTriageSchema,
  todoItem: pilotTodoItemSchema.nullable().optional(),
  inspectionTrace: pilotInspectionTraceSchema,
}).strict()
export type PilotRunScenarioResponse = z.infer<typeof pilotRunScenarioResponseSchema>

export const pilotProposeReceiptFixRequestSchema = z.object({
  sessionId: z.string().min(1),
  agentConfigId: z.string().min(1),
  receiptRunId: z.string().min(1),
  operatorInstruction: z.string().max(2000).optional(),
}).strict()
export type PilotProposeReceiptFixRequest = z.infer<typeof pilotProposeReceiptFixRequestSchema>

export const pilotProposeReceiptFixResponseSchema = z.object({
  proposal: z.record(z.unknown()),
  modelUsed: z.string(),
  promptVersion: z.string(),
  sourceReceiptRunId: z.string(),
  inspectionTrace: pilotInspectionTraceSchema,
}).strict()
export type PilotProposeReceiptFixResponse = z.infer<typeof pilotProposeReceiptFixResponseSchema>

export const pilotAcceptProposalRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
}).strict()
export type PilotAcceptProposalRequest = z.infer<typeof pilotAcceptProposalRequestSchema>

export const pilotApplyProposalRequestSchema = z.object({}).strict()
export type PilotApplyProposalRequest = z.infer<typeof pilotApplyProposalRequestSchema>

export const pilotGenerateHandoffRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  draftAgentConfigId: z.string().min(1, 'draftAgentConfigId is required'),
  handoffSummary: z.string().min(1).max(12000),
  readinessVerdict: pilotReadinessVerdictSchema.default('not_ready'),
  blockers: z.array(pilotBlockerSchema).default([]),
  risks: z.array(pilotRiskSchema).default([]),
  referencedProposalIds: z.array(z.string()).default([]),
  referencedReceiptIds: z.array(z.string()).default([]),
  coveredTodoItemIds: z.array(z.string()).default([]),
}).strict()
export type PilotGenerateHandoffRequest = z.infer<typeof pilotGenerateHandoffRequestSchema>

export const pilotGenerateReleaseHandoffRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  draftAgentConfigId: z.string().min(1, 'draftAgentConfigId is required').optional(),
}).strict()
export type PilotGenerateReleaseHandoffRequest = z.infer<typeof pilotGenerateReleaseHandoffRequestSchema>
