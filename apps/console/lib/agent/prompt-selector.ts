// Prompt Selector — current prompt + tool selection.
//
// Determines which system prompt and tool set to use based on the current
// execution mode: Core discovery, human-waiting acknowledgement, or Procedure.

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CaseSchemaConfig } from '@intera/shared/types'
import type { ConversationLoop } from './conversation-loop'
import type { CaseAgentLoop } from './case-agent-loop'
import { isUnifiedKnowledgeToolName } from './knowledge-tooling'

export interface PromptSelection {
  prompt: string
  tools: Tool[]
}

export const PROCEDURE_TOOL_SCHEMA_FILTERING_ENV = 'INTERA_PROCEDURE_TOOL_SCHEMA_FILTERING'

const PROCEDURE_SCHEMA_ALWAYS_ON_TOOL_NAMES = new Set([
  'start_procedure',
  'ask_user_questions',
  'read_user_profile',
  'remember',
  'get_current_time',
  'create_human_task',
  'search_knowledge',
])

export interface PromptSelectorContext {
  isCaseActive: boolean
  isConsultation: boolean
  caseSchema?: CaseSchemaConfig | null
  systemPrompt: string
  currentStage: string
  nudgeCount: number
  conversationLoop: ConversationLoop
  caseLoop: CaseAgentLoop | null
  allTools: Tool[]
  procedureRunTail?: string
  procedureToolSchemaFilteringEnabled?: boolean
}

export function isProcedureToolSchemaFilteringEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[PROCEDURE_TOOL_SCHEMA_FILTERING_ENV]?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return true
}

export function isProcedureSchemaSystemToolName(name: string): boolean {
  return PROCEDURE_SCHEMA_ALWAYS_ON_TOOL_NAMES.has(name)
}

export function isCoreDiscoverySchemaToolName(name: string): boolean {
  return isProcedureSchemaSystemToolName(name) || isUnifiedKnowledgeToolName(name)
}

export function filterCoreDiscoveryToolSchemas(allTools: Tool[]): Tool[] {
  return allTools.filter((tool) => isCoreDiscoverySchemaToolName(tool.name))
}

/**
 * Select the system prompt and filtered tool set for the current iteration.
 *
 * Three modes:
 * - Core (discovery): no active case → conversational discovery prompt + tools
 * - Consultation: human specialist reviewing → acknowledgement-only prompt, no tools
 * - Procedure: single case owner executes typed steps with Hook checkpoints
 */
export function selectPromptAndTools(ctx: PromptSelectorContext): PromptSelection {
  const { isCaseActive, isConsultation, caseSchema, systemPrompt, currentStage,
    conversationLoop, caseLoop, allTools, procedureRunTail } = ctx
  const procedureToolSchemaFilteringEnabled =
    ctx.procedureToolSchemaFilteringEnabled ?? isProcedureToolSchemaFilteringEnabled()

  const appendDynamicTail = (prompt: string): string =>
    procedureRunTail?.trim() ? `${prompt.trim()}\n\n${procedureRunTail.trim()}` : prompt

  if (!isCaseActive) {
    return {
      prompt: appendDynamicTail(conversationLoop.buildPrompt()),
      tools: procedureToolSchemaFilteringEnabled ? filterCoreDiscoveryToolSchemas(allTools) : allTools,
    }
  }

  if (isConsultation) {
    return {
      prompt: appendDynamicTail([
        `## Waiting Human Runtime Context`,
        `- procedureType: ${caseSchema?.type || 'unknown'}`,
        `- stage: ${currentStage}`,
        'This case is currently under review by a human specialist. A human task has been created.',
        '',
        'Your ONLY job: acknowledge the customer\'s message warmly, confirm their case is being reviewed,',
        'and ask them to wait. Do NOT call any tools. Do NOT run any investigation.',
        'Do NOT make promises about outcomes. Keep the response brief (1-2 sentences).',
        '',
        systemPrompt,
      ].join('\n')),
      tools: [],
    }
  }

  if (caseLoop) {
    const prompt = [
      systemPrompt,
      '',
      '## Procedure Definition Context',
      'Use this Procedure definition as guidance. Runtime ProcedureRun state, current step, and evidence authority appear only in the dynamic tail below.',
      caseLoop.buildProcedurePrompt(),
    ].join('\n')
    return {
      prompt: appendDynamicTail(prompt),
      tools: procedureToolSchemaFilteringEnabled ? caseLoop.filterProcedureTools(allTools) : allTools,
    }
  }

  return {
    prompt: appendDynamicTail(conversationLoop.buildPrompt()),
    tools: procedureToolSchemaFilteringEnabled ? filterCoreDiscoveryToolSchemas(allTools) : allTools,
  }
}
