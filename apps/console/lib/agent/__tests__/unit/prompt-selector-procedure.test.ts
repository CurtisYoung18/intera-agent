import { describe, it, expect } from 'vitest'
import { selectPromptAndTools, type PromptSelectorContext } from '../../prompt-selector'
import type { CaseAgentLoop } from '../../case-agent-loop'
import type { ConversationLoop } from '../../conversation-loop'
import type { ChatMemoryManager } from '../../memory'
import type { CaseSchemaConfig } from '@intera/shared/types'

// Procedure selector guard. Active cases with a case loop render the Procedure
// prompt; if the case loop is absent, selection falls back to discovery prompt.

const chatMemoryStub = {
  getTodos: () => [],
  getConfirmedFacts: () => ({}),
} as unknown as ChatMemoryManager

const conversationLoopStub = {
  buildPrompt: () => 'DISCOVERY_PROMPT',
  filterTools: (t: unknown[]) => t,
} as unknown as ConversationLoop

function makeCaseLoop(): CaseAgentLoop {
  return {
    buildProcedurePrompt: () => 'PROCEDURE_PROMPT',
    filterProcedureTools: (tools: unknown[]) => tools,
  } as unknown as CaseAgentLoop
}

function ctx(withCaseLoop: boolean): PromptSelectorContext {
  return {
    isCaseActive: true,
    isConsultation: false,
    caseSchema: { type: 'deposit_issue' } as unknown as CaseSchemaConfig,
    systemPrompt: 'BASE',
    currentStage: 'investigating',
    nudgeCount: 0,
    conversationLoop: conversationLoopStub,
    caseLoop: withCaseLoop ? makeCaseLoop() : null,
    chatMemory: chatMemoryStub,
    allTools: [],
  }
}

describe('selectPromptAndTools — Procedure branch (Phase 2)', () => {
  it('renders the Procedure prompt for an active case with a case loop', () => {
    expect(selectPromptAndTools(ctx(true)).prompt).toBe('PROCEDURE_PROMPT')
  })

  it('falls back to discovery prompt when no case loop is available', () => {
    expect(selectPromptAndTools(ctx(false)).prompt).toBe('DISCOVERY_PROMPT')
  })
})
