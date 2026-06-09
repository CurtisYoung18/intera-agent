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
    buildProcedureDefinitionPrompt: () => 'PROCEDURE_DEFINITION',
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
    procedureRunTail: 'DYNAMIC_PROCEDURE_RUN_TAIL',
  }
}

describe('selectPromptAndTools — Procedure branch (Phase 2)', () => {
  it('keeps the stable system prompt first and appends Procedure runtime tail', () => {
    const prompt = selectPromptAndTools(ctx(true)).prompt
    expect(prompt.startsWith('BASE')).toBe(true)
    expect(prompt).toContain('PROCEDURE_DEFINITION')
    expect(prompt.endsWith('DYNAMIC_PROCEDURE_RUN_TAIL')).toBe(true)
  })

  it('falls back to discovery prompt when no case loop is available', () => {
    expect(selectPromptAndTools(ctx(false)).prompt).toBe('DISCOVERY_PROMPT\n\nDYNAMIC_PROCEDURE_RUN_TAIL')
  })
})
