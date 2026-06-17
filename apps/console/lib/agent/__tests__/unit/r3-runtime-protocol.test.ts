import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentConfigData } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { AgentLoop } from '../../loop'
import { ToolRouter } from '../../tools'
import { selectPromptAndTools, type PromptSelectorContext } from '../../prompt-selector'
import type { ConversationLoop } from '../../conversation-loop'
import type { CaseAgentLoop } from '../../case-agent-loop'
import { createMemoryPersistence } from '../../persistence-port'
import { RuntimeManagedToolResolver } from '../../runtime-managed-tools'
import { HookContextBuilder } from '../../hook-context-builder'
import type { ToolExecutionResult } from '../../streaming-tool-executor'
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
  toolFindMany: vi.fn(),
  caseTypeFindMany: vi.fn(),
  knowledgeSourceFindMany: vi.fn(),
  agentConfigFindUnique: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    userProfile: { findUnique: h.userProfileFindUnique, upsert: h.userProfileUpsert },
    case: { findMany: h.caseFindMany },
    chatSession: { upsert: h.chatSessionUpsert },
    tool: { findMany: h.toolFindMany },
    caseType: { findMany: h.caseTypeFindMany },
    knowledgeSource: { findMany: h.knowledgeSourceFindMany },
    agentConfig: { findUnique: h.agentConfigFindUnique },
  },
}))

function toolProcedure(toolName: string) {
  return {
    version: 'v2' as const,
    whenToUse: `Use when ${toolName} is needed.`,
    steps: [
      {
        id: 'lookup',
        title: 'Lookup',
        guidance: `Call ${toolName}.`,
        actions: [{ id: 'lookup_tool', kind: 'call_tool' as const, label: `Call ${toolName}`, toolName }],
        branches: [],
      },
      {
        id: 'close',
        title: 'Close',
        guidance: 'Finalize when done.',
        actions: [{ id: 'finish', kind: 'end' as const, label: 'Finish', status: 'completed' as const }],
        branches: [],
      },
    ],
  }
}

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

function endOnlyProcedure() {
  return {
    version: 'v2' as const,
    whenToUse: 'Use when the run only needs a clean finalize.',
    steps: [
      {
        id: 'close',
        title: 'Close',
        guidance: 'Finalize immediately.',
        actions: [{ id: 'finish', kind: 'end' as const, label: 'Finish', status: 'completed' as const }],
        branches: [],
      },
    ],
  }
}

function makeLoop(
  caseId: string,
  overrides: Partial<{ userId: string; chatId: string | null }> = {},
): AgentLoop {
  const memory = createMemoryPersistence()
  return new AgentLoop({
    config: config(),
    configId: 'agent_1',
    caseId,
    orgId: 'org_1',
    userId: overrides.userId ?? 'user_1',
    chatId: overrides.chatId ?? 'chat_1',
    systemPrompt: 'CORE_PROMPT',
    coreSystemPrompt: 'CORE_PROMPT',
    persistence: memory.port,
    dryRun: false,
  })
}

async function resolveRuntimeTool(loop: AgentLoop, name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const anyLoop = loop as any
  const result: ToolExecutionResult = {
    name,
    output: { ok: true, output: 'placeholder', latencyMs: 1 },
    latencyMs: 1,
    toolUse: { id: `toolu_${name}`, name, input },
  }

  await new RuntimeManagedToolResolver({
    caseId: anyLoop.deps.caseId,
    orgId: anyLoop.deps.orgId,
    userId: anyLoop.deps.userId,
    chatId: anyLoop.deps.chatId,
    configId: anyLoop.deps.configId,
    config: anyLoop.deps.config,
    caseSchema: anyLoop.deps.caseSchema,
    messages: anyLoop.messages,
    chatMemory: anyLoop.chatMemory,
    persistence: anyLoop.persistence,
    traceWriter: anyLoop.traceWriter,
    dryRun: anyLoop.dryRun,
    persistRuntimeMemory: anyLoop.deps.persistRuntimeMemory,
    canCreateHumanTaskInGeneralMode: false,
  }).resolve([result], new Map([[`toolu_${name}`, 1]]), 1)

  return (result.output as { output?: unknown }).output
}

beforeEach(() => {
  vi.clearAllMocks()
  h.userProfileFindUnique.mockResolvedValue(null)
  h.userProfileUpsert.mockResolvedValue({})
  h.caseFindMany.mockResolvedValue([])
  h.chatSessionUpsert.mockResolvedValue({})
  h.toolFindMany.mockResolvedValue([])
  h.caseTypeFindMany.mockResolvedValue([])
  h.knowledgeSourceFindMany.mockResolvedValue([])
  h.agentConfigFindUnique.mockResolvedValue(null)
})

describe('R3 ToolRouter and prompt cache boundaries', () => {
  it('advertises new system tools and hides compatibility aliases from model-visible definitions', () => {
    const router = new ToolRouter('agent_1')
    const visibleNames = router.getToolDefinitions().map((tool) => tool.name)

    expect(visibleNames).toEqual(expect.arrayContaining([
      'start_procedure',
      'finalize_procedure',
      'remember',
      'read_chat_memory',
      'read_user_profile',
      'get_current_time',
      'ask_user_questions',
      'create_human_task',
    ]))
    expect(visibleNames).not.toContain('dispatch_case_agent')
    expect(visibleNames).not.toContain('finalize_case')
    expect(router.getTool('dispatch_case_agent')).toBeUndefined()
    expect(router.getTool('finalize_case')).toBeUndefined()
    expect(router.getTool('read_chat_memory')?.description).toContain('not ProcedureRun authority')
    expect(router.getTool('read_user_profile')?.description).toContain('never returns active ProcedureRun runtime state')
    expect((router.getTool('remember')?.inputSchema as { properties?: { scope?: { enum?: string[] } } })?.properties?.scope?.enum).toEqual(['user'])
  })

  it('keeps procedure catalog in {{case_types}} only, not in start_procedure tool description', async () => {
    h.caseTypeFindMany.mockResolvedValue([
      { type: 'deposit_issue', displayName: 'Deposit', description: 'Investigate deposit issues', icon: 'money' },
    ])

    const router = await ToolRouter.create('agent_1')
    const startDescription = router.getTool('start_procedure')?.description ?? ''

    expect(startDescription).toContain('Start or select a runtime ProcedureRun')
    expect(startDescription).not.toContain('## Procedure Catalog')
    expect(startDescription).not.toContain('deposit_issue')
  })

  it('handles get_current_time as a runtime-managed system tool', async () => {
    const router = new ToolRouter('agent_1')
    const loop = makeLoop('r3-current-time')
    const output = await resolveRuntimeTool(loop, 'get_current_time') as Record<string, unknown>

    expect(router.getTool('get_current_time')?.mode).toBe('system_managed')
    expect(router.getTool('get_current_time')?.toolCategory).toBe('system_info')
    expect(output.timeZone).toBe('Asia/Shanghai')
    expect(output.utcTime).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    expect(output.localDateTime).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/))
  })

  it('keeps tool schema stable and appends ProcedureRun state only at the prompt tail', () => {
    const caseId = 'r3-prompt-boundary'
    const router = new ToolRouter('agent_1')
    const toolsBefore = router.getTools()

    const conversationLoop = { buildPrompt: () => 'CORE_PROMPT', filterTools: (tools: unknown[]) => tools } as unknown as ConversationLoop
    const caseLoop = {
      buildProcedurePrompt: () => 'PROCEDURE_DEFINITION',
    } as unknown as CaseAgentLoop
    const beforeCtx: PromptSelectorContext = {
      isCaseActive: false,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'created',
      nudgeCount: 0,
      conversationLoop,
      caseLoop: null,
      allTools: toolsBefore,
    }
    const before = selectPromptAndTools(beforeCtx)

    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: toolProcedure('get_latest_deposit'),
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
    expect(after.prompt).not.toContain('action=call_tool')
    expect(after.tools.map((tool) => tool.name)).toEqual(before.tools.map((tool) => tool.name))
    closeSession(caseId)
  })
})

describe('R3 HookContext and memory boundaries', () => {
  it('persistTurnMemory waits for chat memory/session writes before resolving', async () => {
    let releaseMemoryWrite!: () => void
    const saveMemoryGate = new Promise<void>((resolve) => { releaseMemoryWrite = resolve })
    let saveMemoryResolved = false

    const persistence = createMemoryPersistence().port
    const saveMemory = vi.fn(async (...args: Parameters<typeof persistence.saveMemory>) => {
      await saveMemoryGate
      saveMemoryResolved = true
      return persistence.saveMemory(...args)
    })

    const loop = new AgentLoop({
      config: config(),
      configId: 'agent_1',
      caseId: 'r3-awaited-memory',
      orgId: 'org_1',
      userId: 'user_1',
      chatId: 'chat_1',
      systemPrompt: 'CORE_PROMPT',
      coreSystemPrompt: 'CORE_PROMPT',
      persistence: {
        ...persistence,
        saveMemory,
      },
      dryRun: false,
    })

    loop.loadMemory({
      contextMap: '{}',
      missingFacts: '[]',
      toolsCalled: '[]',
      toolResults: '{}',
      keyEvents: '[]',
      summary: 'Compacted summary',
    })

    let settled = false
    const persistPromise = (loop as any).persistTurnMemory().then((result: unknown) => {
      settled = true
      return result
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(saveMemory).toHaveBeenCalled()
    expect(h.chatSessionUpsert).toHaveBeenCalled()
    expect(saveMemoryResolved).toBe(false)
    expect(settled).toBe(false)

    releaseMemoryWrite()

    await persistPromise
    expect(saveMemoryResolved).toBe(true)
    expect(saveMemory).toHaveBeenCalledWith('r3-awaited-memory', expect.objectContaining({
      caseId: 'r3-awaited-memory',
      summary: 'Compacted summary',
    }))
  })

  it('lets runtime-managed finalize_procedure complete an active end step before terminal finalize', async () => {
    const caseId = 'r3-finalize-order'
    recordInitialInputEvent(caseId, { content: 'close this cleanly' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: endOnlyProcedure(),
    })
    const loop = makeLoop(caseId)

    const output = await resolveRuntimeTool(loop, 'finalize_procedure', {
      runId: started.run.runId,
      status: 'completed',
      conclusion: 'Done.',
    }) as Record<string, unknown>

    expect(output).toMatchObject({
      ok: true,
      status: 'completed',
      runId: started.run.runId,
    })
    expect(procedureRunPromptTail(caseId)).toBe('')
    closeSession(caseId)
  })

  it('passes active ProcedureRun currentStepId into HookContext', () => {
    const caseId = 'r3-hook-context'
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: toolProcedure('get_latest_deposit'),
    })
    const loop = makeLoop(caseId)
    const anyLoop = loop as any
    const ctx = new HookContextBuilder({
      agentConfigId: anyLoop.deps.configId,
      caseId: anyLoop.deps.caseId,
      chatId: anyLoop.deps.chatId,
      chatMemory: anyLoop.chatMemory,
      getCaseSchema: () => anyLoop.deps.caseSchema,
      getCurrentStage: () => anyLoop.currentStage,
      getIterationCount: () => anyLoop.iterationCount,
    }).build('PreToolUse', {
      toolName: 'get_latest_deposit',
      toolInput: {},
    })

    expect(ctx.procedureStepIds).toEqual(['lookup'])
    const metadata = ctx.metadata as { procedureRun?: { currentStepId?: string } }
    expect(metadata.procedureRun?.currentStepId).toBe('lookup')
    closeSession(caseId)
  })

  it('read_chat_memory returns context signals only, and remember(scope="chat") rejects structured fact writes', async () => {
    const caseId = 'r3-chat-memory'
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [{ id: 'lookup', title: 'Lookup deposit', guidance: 'Check the latest deposit.', actions: [{ id: 'lookup_tool', kind: 'call_tool', label: 'Check latest deposit', toolName: 'get_latest_deposit' }] }],
      },
    })
    const loop = makeLoop(caseId)

    const remember = await resolveRuntimeTool(loop, 'remember', {
      scope: 'chat',
      facts: { memberId: 'M123', currentStepId: 'close', inputEpoch: 2 },
      reason: 'customer provided member id',
    })
    const read = await resolveRuntimeTool(loop, 'read_chat_memory')

    expect((remember as any).ok).toBe(false)
    expect((remember as any).writtenKeys).toEqual([])
    expect((remember as any).rejectedKeys.sort()).toEqual(['currentStepId', 'inputEpoch', 'memberId'].sort())
    expect(read).not.toHaveProperty('contextMap')
    expect(read).not.toHaveProperty('contextMapAvailable')
    expect(JSON.stringify(read)).not.toContain('currentStepId')
    closeSession(caseId)
  })

  it('keeps read_chat_memory free of raw context blobs and rejects chat writes on Procedure v2 runs', async () => {
    const caseId = 'r3-v2-memory-boundary'
    recordInitialInputEvent(caseId, { content: 'I need help with a deposit page' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'triage',
            title: 'Triage',
            guidance: 'Use runtime evidence only.',
            actions: [],
            branches: [],
          },
        ],
      },
    })
    const loop = makeLoop(caseId)

    const remember = await resolveRuntimeTool(loop, 'remember', {
      scope: 'chat',
      facts: { memberId: 'M123' },
      reason: 'customer typed a member id in free text',
    })
    const read = await resolveRuntimeTool(loop, 'read_chat_memory')

    expect((remember as any).ok).toBe(false)
    expect(String((remember as any).error)).toContain('Chat-scoped fact writes are no longer supported')
    expect(read).not.toHaveProperty('contextMapAvailable')
    expect(read).not.toHaveProperty('contextMap')
    closeSession(caseId)
  })

  it('remember(scope="user") writes what read_user_profile reads', async () => {
    const loop = makeLoop('r3-user-memory')
    await resolveRuntimeTool(loop, 'remember', {
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

    const read = await resolveRuntimeTool(loop, 'read_user_profile')
    expect((read as any).profile).toContain('prefers SMS updates')
    expect(JSON.stringify(read)).not.toContain('currentStepId')
  })

  it('lets a fresh chat read durable user memory from an earlier chat for the same user', async () => {
    const firstLoop = makeLoop('r3-user-memory-session-a', { chatId: 'chat_A' })
    await resolveRuntimeTool(firstLoop, 'remember', {
      scope: 'user',
      key: 'vip_level',
      value: 'gold',
      reason: 'customer disclosed their membership tier',
    })

    const firstUpsertArg = h.userProfileUpsert.mock.calls[0][0]
    h.userProfileFindUnique.mockResolvedValueOnce({
      profile: firstUpsertArg.create.profile,
      sections: firstUpsertArg.create.sections,
      totalChats: 1,
      totalCases: 1,
      resolvedCases: 1,
      escalatedCases: 0,
      lastCaseType: 'general',
      firstSeenAt: null,
      lastSeenAt: null,
    })

    const secondLoop = makeLoop('r3-user-memory-session-b', { chatId: 'chat_B' })
    const read = await resolveRuntimeTool(secondLoop, 'read_user_profile')

    expect((read as any).profile).toContain('gold')
    expect(h.userProfileFindUnique).toHaveBeenLastCalledWith({
      where: {
        orgId_userId: {
          orgId: 'org_1',
          userId: 'user:user_1',
        },
      },
    })
  })
})
