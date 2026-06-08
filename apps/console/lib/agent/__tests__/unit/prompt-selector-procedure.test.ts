import { describe, it, expect } from 'vitest'
import { selectPromptAndTools, type PromptSelectorContext } from '../../prompt-selector'
import type { CaseAgentLoop } from '../../case-agent-loop'
import type { ConversationLoop } from '../../conversation-loop'
import type { ChatMemoryManager } from '../../memory'
import type { CaseSchemaConfig } from '@intera/shared/types'

// Procedure refactor — Phase 2. The dry-run playground cannot activate a case
// across turns (dispatch_case_agent is mocked), so this drives the real prompt
// selector to prove the integration link: an active cc case with a Procedure
// renders the Procedure prompt; without one it falls back to the legacy SOP.

const chatMemoryStub = {
  getTodos: () => [],
  getConfirmedFacts: () => ({}),
} as unknown as ChatMemoryManager

const conversationLoopStub = {
  buildPrompt: () => 'DISCOVERY_PROMPT',
  filterTools: (t: unknown[]) => t,
} as unknown as ConversationLoop

function makeCaseLoop(isProcedure: boolean): CaseAgentLoop {
  return {
    isProcedureMode: () => isProcedure,
    buildProcedurePrompt: () => 'PROCEDURE_PROMPT',
    buildSopPrompt: () => 'SOP_PROMPT',
    filterSopTools: (tools: unknown[]) => tools,
  } as unknown as CaseAgentLoop
}

function ctx(isProcedure: boolean): PromptSelectorContext {
  return {
    isCaseActive: true,
    isConsultation: false,
    caseSchema: { type: 'deposit_issue', executionMode: 'cc' } as unknown as CaseSchemaConfig,
    systemPrompt: 'BASE',
    currentStage: 'investigating',
    nudgeCount: 0,
    conversationLoop: conversationLoopStub,
    caseLoop: makeCaseLoop(isProcedure),
    chatMemory: chatMemoryStub,
    allTools: [],
  }
}

describe('selectPromptAndTools — Procedure branch (Phase 2)', () => {
  it('renders the Procedure prompt for an active cc case in procedure mode', () => {
    expect(selectPromptAndTools(ctx(true)).prompt).toBe('PROCEDURE_PROMPT')
  })

  it('falls back to the legacy SOP prompt when the cc case has no procedure', () => {
    expect(selectPromptAndTools(ctx(false)).prompt).toBe('SOP_PROMPT')
  })
})
