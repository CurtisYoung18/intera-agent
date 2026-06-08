// .intera-agent.json v1 — portable Agent Template Package contract.

import { z } from 'zod'
import { templateCaseTypeSchema } from './case-types'
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
  guardrails: z.array(z.record(z.unknown())).optional(),
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
  tools: z.array(templateToolSchema).default([]),
  hooks: z.array(hookContractSchema).default([]),
  hookBindings: z.array(hookBindingContractSchema).default([]),
  scenarios: z.array(templateScenarioSchema).default([]),
  secrets: z.array(templateSecretPlaceholderSchema).optional(),
  legacy: agentTemplateLegacySchema.optional(),
}).strict()
export type InteraAgentTemplateV1 = z.infer<typeof interaAgentTemplateV1Schema>
