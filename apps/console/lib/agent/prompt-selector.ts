// Prompt Selector — current prompt + tool selection.
//
// Determines which system prompt and tool set to use based on the current
// execution mode: Core discovery, human-waiting acknowledgement, or Procedure.

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CaseSchemaConfig } from '@intera/shared/types'
import type { ConversationLoop } from './conversation-loop'
import type { CaseAgentLoop } from './case-agent-loop'
import type { ChatMemoryManager } from './memory'

export interface PromptSelection {
  prompt: string
  tools: Tool[]
}

export interface PromptSelectorContext {
  isCaseActive: boolean
  isConsultation: boolean
  caseSchema?: CaseSchemaConfig | null
  systemPrompt: string
  currentStage: string
  nudgeCount: number
  conversationLoop: ConversationLoop
  caseLoop: CaseAgentLoop | null
  chatMemory: ChatMemoryManager
  allTools: Tool[]
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
    conversationLoop, caseLoop, chatMemory, allTools } = ctx

  if (!isCaseActive) {
    return {
      prompt: conversationLoop.buildPrompt(),
      tools: conversationLoop.filterTools(allTools),
    }
  }

  if (isConsultation) {
    return {
      prompt: [
        `[INTERA MODE: WAITING_HUMAN | type: ${caseSchema?.type || 'unknown'} | stage: ${currentStage}]`,
        'This case is currently under review by a human specialist. A human task has been created.',
        '',
        'Your ONLY job: acknowledge the customer\'s message warmly, confirm their case is being reviewed,',
        'and ask them to wait. Do NOT call any tools. Do NOT run any investigation.',
        'Do NOT make promises about outcomes. Keep the response brief (1-2 sentences).',
        '',
        systemPrompt,
      ].join('\n'),
      tools: [],
    }
  }

  if (caseLoop) {
    const prompt = caseLoop.buildProcedurePrompt(systemPrompt, chatMemory.getTodos(), chatMemory.getConfirmedFacts())
    return {
      prompt,
      tools: caseLoop.filterProcedureTools(allTools),
    }
  }

  return {
    prompt: conversationLoop.buildPrompt(),
    tools: conversationLoop.filterTools(allTools),
  }
}
