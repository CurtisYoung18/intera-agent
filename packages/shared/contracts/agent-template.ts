// .intera-agent.json v1 — portable Agent Template Package contract.

import { z } from 'zod'
import { procedureV2Schema, templateCaseTypeSchema } from './case-types'
import { templateToolSchema } from './tools'
import {
  hookBindingContractSchema,
  hookContractSchema,
  stableNameSchema,
} from './hooks'
import { templateScenarioSchema } from './scenarios'

export const AGENT_TEMPLATE_SCHEMA_VERSION = 'intera.agentTemplate.v1' as const

export const templateSecretPlaceholderSchema = z.object({
  name: stableNameSchema,
  description: z.string().optional(),
  required: z.boolean().default(true),
  exampleRef: z.string().optional(),
})
export type TemplateSecretPlaceholder = z.infer<typeof templateSecretPlaceholderSchema>

export const agentTemplateProcedureSummarySchema = z.object({
  procedureId: stableNameSchema,
  displayName: z.string().optional(),
  description: z.string().optional(),
  caseTypeType: stableNameSchema.optional(),
  enabled: z.boolean().default(true),
  procedure: procedureV2Schema,
  legacy: z.record(z.unknown()).optional(),
})
export type AgentTemplateProcedureSummary = z.infer<typeof agentTemplateProcedureSummarySchema>

export const agentTemplateKnowledgeRefSchema = z.object({
  sourceId: z.string().optional(),
  name: z.string().min(1, 'knowledge ref name is required'),
  type: z.string().default('knowledge_source'),
  provider: z.string().default('gptbots'),
  description: z.string().optional(),
  status: z.enum(['enabled', 'disabled', 'required']).default('required'),
  enabled: z.boolean().optional(),
  caseTypeTag: z.string().optional(),
  groupRefs: z.array(z.string()).default([]),
  dataRefs: z.array(z.string()).default([]),
  retrieval: z.record(z.unknown()).optional(),
  legacy: z.record(z.unknown()).optional(),
})
export type AgentTemplateKnowledgeRef = z.infer<typeof agentTemplateKnowledgeRefSchema>

export const agentTemplateIntegrationRefSchema = z.object({
  channel: z.string().min(1, 'integration channel is required'),
  provider: z.string().optional(),
  name: z.string().optional(),
  status: z.enum(['enabled', 'disabled', 'required', 'unsupported']).default('required'),
  enabled: z.boolean().optional(),
  requiredCapabilities: z.array(z.string()).default([]),
  samplePayloadRefs: z.array(z.string()).default([]),
  requiredSecrets: z.array(stableNameSchema).default([]),
  defaults: z.record(z.unknown()).optional(),
  toolOverrides: z.record(z.unknown()).optional(),
  legacy: z.record(z.unknown()).optional(),
})
export type AgentTemplateIntegrationRef = z.infer<typeof agentTemplateIntegrationRefSchema>

export const agentTemplateRuntimeToolSchema = z.object({
  name: stableNameSchema,
  description: z.string().optional(),
  visibility: z.enum(['runtime', 'hidden', 'model_visible']).default('runtime'),
  runtimeManaged: z.boolean().default(true),
  category: z.string().optional(),
})
export type AgentTemplateRuntimeTool = z.infer<typeof agentTemplateRuntimeToolSchema>

export const agentTemplateSystemToolPolicySchema = z.object({
  runtimeManaged: z.boolean().default(true),
  importMode: z.enum(['ignore', 'require_runtime']).default('ignore'),
  runtimeManagedTools: z.array(agentTemplateRuntimeToolSchema).default([]),
})
export type AgentTemplateSystemToolPolicy = z.infer<typeof agentTemplateSystemToolPolicySchema>

export const agentTemplateValidationEvidenceSchema = z.object({
  source: z.literal('historical_reference').default('historical_reference'),
  runtimeValidated: z.boolean().default(false),
  lastValidatedAt: z.string().optional(),
  lastReceiptId: z.string().optional(),
  lastReceiptStatus: z.string().optional(),
  lastReceiptExecutionMode: z.string().optional(),
  scenarioCount: z.number().int().nonnegative().default(0),
  receiptCount: z.number().int().nonnegative().default(0),
  latestReceipts: z.array(z.object({
    scenarioName: stableNameSchema,
    runId: z.string(),
    status: z.string(),
    executionMode: z.string().optional(),
    completedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    startedAt: z.string().optional(),
    summary: z.string().optional(),
  })).default([]),
})
export type AgentTemplateValidationEvidence = z.infer<typeof agentTemplateValidationEvidenceSchema>

export const agentTemplateMetadataSchema = z.object({
  templateId: stableNameSchema.optional(),
  name: z.string().min(1, 'template name is required'),
  industry: stableNameSchema.optional(),
  locales: z.array(z.string()).optional(),
  publisher: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).optional(),
  marketplace: z.object({
    priceTier: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
})
export type AgentTemplateMetadata = z.infer<typeof agentTemplateMetadataSchema>

export const agentTemplateAgentSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  thinkingBudget: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
  coreSystemPrompt: z.string().optional(),
  memoryStrategy: z.record(z.unknown()).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  resumePrompt: z.string().optional(),
}).passthrough()
export type AgentTemplateAgent = z.infer<typeof agentTemplateAgentSchema>

export const agentTemplateLegacySchema = z.object({
  caseTypes: z.array(z.record(z.unknown())).optional(),
  policies: z.array(z.record(z.unknown())).optional(),
  hooks: z.array(z.record(z.unknown())).optional(),
  skills: z.array(z.record(z.unknown())).optional(),
  stageConfigs: z.array(z.record(z.unknown())).optional(),
  subAgents: z.array(z.record(z.unknown())).optional(),
}).passthrough()
export type AgentTemplateLegacy = z.infer<typeof agentTemplateLegacySchema>

export const interaAgentTemplateV1Schema = z.object({
  schemaVersion: z.literal(AGENT_TEMPLATE_SCHEMA_VERSION),
  metadata: agentTemplateMetadataSchema,
  agent: agentTemplateAgentSchema.default({}),
  caseTypes: z.array(templateCaseTypeSchema).default([]),
  procedures: z.array(agentTemplateProcedureSummarySchema).default([]),
  tools: z.array(templateToolSchema).default([]),
  hooks: z.array(hookContractSchema).default([]),
  hookBindings: z.array(hookBindingContractSchema).default([]),
  scenarios: z.array(templateScenarioSchema).default([]),
  scenarioDefinitions: z.array(templateScenarioSchema).default([]),
  knowledgeRefs: z.array(agentTemplateKnowledgeRefSchema).default([]),
  integrationRefs: z.array(agentTemplateIntegrationRefSchema).default([]),
  secrets: z.array(templateSecretPlaceholderSchema).optional(),
  requiredSecrets: z.array(templateSecretPlaceholderSchema).default([]),
  systemToolPolicy: agentTemplateSystemToolPolicySchema.default({
    runtimeManaged: true,
    importMode: 'ignore',
    runtimeManagedTools: [],
  }),
  validationEvidence: agentTemplateValidationEvidenceSchema.optional(),
  legacy: agentTemplateLegacySchema.optional(),
}).strict()
export type InteraAgentTemplateV1 = z.infer<typeof interaAgentTemplateV1Schema>

export const agentTemplateImportIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['warning', 'error']).default('warning'),
  target: z.string().optional(),
})
export type AgentTemplateImportIssue = z.infer<typeof agentTemplateImportIssueSchema>

export const agentTemplateImportReportSchema = z.object({
  canImport: z.boolean(),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  requiredSecrets: z.array(templateSecretPlaceholderSchema).default([]),
  unsupportedIntegrations: z.array(z.object({
    channel: z.string(),
    provider: z.string().optional(),
    name: z.string().optional(),
    reason: z.string(),
  })).default([]),
  missingKnowledgeRefs: z.array(agentTemplateKnowledgeRefSchema).default([]),
  conflicts: z.array(agentTemplateImportIssueSchema).default([]),
  plannedCreates: z.record(z.number().int().nonnegative()).default({}),
  plannedUpdates: z.record(z.number().int().nonnegative()).default({}),
  packageCoverage: z.record(z.number().int().nonnegative()).default({}),
})
export type AgentTemplateImportReport = z.infer<typeof agentTemplateImportReportSchema>
