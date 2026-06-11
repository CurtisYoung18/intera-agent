import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentConfigData } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { AgentLoop } from '../../loop'
import { ToolRouter } from '../../tools'
import { selectPromptAndTools, type PromptSelectorContext } from '../../prompt-selector'
import type { ConversationLoop } from '../../conversation-loop'
import type { CaseAgentLoop } from '../../case-agent-loop'
import type { ChatMemoryManager } from '../../memory'
import { createMemoryPersistence } from '../../persistence-port'
import {
  closeSession,
  procedureRunPromptTail,
  recordInitialInputEvent,
  startProcedureRun,
} from '../../session-store'

const h = vi.hoisted(() => ({
  userProfileFindUnique: vi.fn(),
  userProfileUpsert: vi.fn(),
  caseFindMany: vi.fn(),
  chatSessionUpsert: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    userProfile: { findUnique: h.userProfileFindUnique, upsert: h.userProfileUpsert },
    case: { findMany: h.caseFindMany },
    chatSession: { upsert: h.chatSessionUpsert },
  },
}))

function config(): AgentConfigData {
  return {
    model: 'claude-sonnet-4-20250514',
    temperature: 0,
    thinkingBudget: 1024,
    maxIterations: 3,
    maxOutputTokens: 1024,
    coreSystemPrompt: 'CORE_PROMPT',
    extendedThinking: false,
    memoryStrategy: {
      ...DEFAULT_MEMORY_STRATEGY,
      enableAutocompact: false,
      enableChatMemory: true,
    },
  }
}

function makeLoop(caseId: string): AgentLoop {
  const memory = createMemoryPersistence()
  return new AgentLoop({
    config: config(),
    configId: 'agent_1',
    caseId,
    orgId: 'org_1',
    userId: 'user_1',
    chatId: 'chat_1',
    systemPrompt: 'CORE_PROMPT',
    coreSystemPrompt: 'CORE_PROMPT',
    persistence: memory.port,
    dryRun: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.userProfileFindUnique.mockResolvedValue(null)
  h.userProfileUpsert.mockResolvedValue({})
  h.caseFindMany.mockResolvedValue([])
})

describe('R3 ToolRouter and prompt cache boundaries', () => {
  it('advertises new system tools and hides compatibility aliases from model-visible definitions', () => {
    const router = new ToolRouter('agent_1')
    const visibleNames = router.getToolDefinitions().map((tool) => tool.name)

    expect(visibleNames).toEqual(expect.arrayContaining([
      'start_procedure',
      'finalize_procedure',
      'reconcile_procedure_input',
      'remember',
      'read_chat_memory',
      'read_user_profile',
      'ask_user_questions',
      'create_human_task',
    ]))
    expect(visibleNames).not.toContain('dispatch_case_agent')
    expect(visibleNames).not.toContain('finalize_case')
    expect(router.getTool('dispatch_case_agent')).toBeUndefined()
    expect(router.getTool('finalize_case')).toBeUndefined()
    expect(router.getTool('read_chat_memory')?.description).toContain('not ProcedureRun authority')
    expect(router.getTool('read_user_profile')?.description).toContain('never returns active ProcedureRun runtime state')
  })

  it('keeps tool schema stable and appends ProcedureRun state only at the prompt tail', () => {
    const caseId = 'r3-prompt-boundary'
    const router = new ToolRouter('agent_1')
    const toolsBefore = router.getTools()

    const conversationLoop = { buildPrompt: () => 'CORE_PROMPT', filterTools: (tools: unknown[]) => tools } as unknown as ConversationLoop
    const caseLoop = {
      buildProcedureDefinitionPrompt: () => 'PROCEDURE_DEFINITION',
    } as unknown as CaseAgentLoop
    const chatMemory = { getTodos: () => [], getConfirmedFacts: () => ({}) } as unknown as ChatMemoryManager
    const beforeCtx: PromptSelectorContext = {
      isCaseActive: false,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'created',
      nudgeCount: 0,
      conversationLoop,
      caseLoop: null,
      chatMemory,
      allTools: toolsBefore,
    }
    const before = selectPromptAndTools(beforeCtx)

    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: { steps: [{ id: 'lookup', action: 'use', target: 'get_latest_deposit' }] },
    })
    const tail = procedureRunPromptTail(caseId)
    const after = selectPromptAndTools({
      ...beforeCtx,
      isCaseActive: true,
      caseLoop,
      procedureRunTail: tail,
    })

    expect(after.prompt.startsWith('CORE_PROMPT')).toBe(true)
    expect(after.prompt.indexOf('CORE_PROMPT')).toBeLessThan(after.prompt.indexOf('<procedure_run_runtime>'))
    expect(after.prompt).toContain('PROCEDURE_DEFINITION')
    expect(after.prompt).toContain('currentStepId: lookup')
    expect(after.tools.map((tool) => tool.name)).toEqual(before.tools.map((tool) => tool.name))
    closeSession(caseId)
  })
})

describe('R3 HookContext and memory boundaries', () => {
  it('passes active ProcedureRun currentStepId into HookContext', () => {
    const caseId = 'r3-hook-context'
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        steps: [
          { id: 'lookup', action: 'use', target: 'get_latest_deposit' },
          { id: 'close', action: 'finalize', target: 'resolved' },
        ],
      },
    })
    const loop = makeLoop(caseId)
    const ctx = (loop as unknown as { buildHookContext: Function }).buildHookContext('PreToolUse', {
      toolName: 'get_latest_deposit',
      toolInput: {},
    })

    expect(ctx.procedureStepIds).toEqual(['lookup'])
    expect(ctx.metadata.procedureRun.currentStepId).toBe('lookup')
    closeSession(caseId)
  })

  it('remember(scope="chat") feeds read_chat_memory and rejects ProcedureRun authority keys', async () => {
    const caseId = 'r3-chat-memory'
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: { steps: [{ id: 'lookup', action: 'use', target: 'get_latest_deposit' }] },
    })
    const loop = makeLoop(caseId)

    const remember = await (loop as unknown as { rememberToolOutput: Function }).rememberToolOutput({
      scope: 'chat',
      facts: { memberId: 'M123', currentStepId: 'close', needsReconcile: false },
      reason: 'customer provided member id',
    })
    const read = (loop as unknown as { readChatMemoryToolOutput: Function }).readChatMemoryToolOutput()

    expect(remember.writtenKeys).toEqual(['memberId'])
    expect(remember.rejectedKeys.sort()).toEqual(['currentStepId', 'needsReconcile'].sort())
    expect(read.confirmedFacts).toEqual({ memberId: 'M123' })
    expect(JSON.stringify(read)).not.toContain('currentStepId')
    closeSession(caseId)
  })

  it('remember(scope="user") writes what read_user_profile reads', async () => {
    const loop = makeLoop('r3-user-memory')
    await (loop as unknown as { rememberToolOutput: Function }).rememberToolOutput({
      scope: 'user',
      key: 'preference',
      value: 'prefers SMS updates',
      reason: 'customer stated a contact preference',
    })

    const upsertArg = h.userProfileUpsert.mock.calls[0][0]
    h.userProfileFindUnique.mockResolvedValueOnce({
      profile: upsertArg.create.profile,
      sections: upsertArg.create.sections,
      totalChats: 0,
      totalCases: 0,
      resolvedCases: 0,
      escalatedCases: 0,
      lastCaseType: null,
      firstSeenAt: null,
      lastSeenAt: null,
    })

    const read = await (loop as unknown as { readUserProfileToolOutput: Function }).readUserProfileToolOutput()
    expect(read.profile).toContain('prefers SMS updates')
    expect(JSON.stringify(read)).not.toContain('currentStepId')
  })
})
