import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { AgentConfigData } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { AgentLoop } from '../../loop'
import { ToolRouter } from '../../tools'
import {
  isProcedureToolSchemaFilteringEnabled,
  selectPromptAndTools,
  type PromptSelectorContext,
} from '../../prompt-selector'
import { resolvePrompt } from '../../prompt-resolver'
import type { ConversationLoop } from '../../conversation-loop'
import { CaseAgentLoop } from '../../case-agent-loop'
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

function knowledgeProcedure() {
  return {
    version: 'v2' as const,
    whenToUse: 'Use when knowledge lookup is needed.',
    steps: [
      {
        id: 'search_policy',
        title: 'Search policy',
        guidance: 'Search the configured knowledge source.',
        actions: [{
          id: 'search_deposit_policy',
          kind: 'search_knowledge' as const,
          label: 'Search deposit policy',
          suggestedSources: ['deposit_faq'],
        }],
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

function makeTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object', properties: {}, required: [] },
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

  it('keeps the stable prompt before the ProcedureRun tail while preserving always-on discovery schemas', () => {
    const caseId = 'r3-prompt-boundary'
    const router = new ToolRouter('agent_1')
    const toolsBefore = router.getTools()

    const conversationLoop = { buildPrompt: () => 'CORE_PROMPT', filterTools: (tools: unknown[]) => tools } as unknown as ConversationLoop
    const caseLoop = {
      buildProcedurePrompt: () => 'PROCEDURE_DEFINITION',
      filterProcedureTools: (tools: Tool[]) => tools.filter((tool) => [
        'start_procedure',
        'ask_user_questions',
        'read_user_profile',
        'remember',
        'get_current_time',
        'create_human_task',
        'search_knowledge',
      ].includes(tool.name)),
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

  it('keeps Available Tools compact while preserving routing constraints', () => {
    const longDescription = 'Verbose provider description with endpoint details, examples, and parameters. '.repeat(90)
    const prompt = resolvePrompt('CORE_PROMPT\n\n{{available_tools}}', {
      available_tools: [
        { name: 'search_knowledge', description: longDescription, needsMemberId: false, knowledgeProvider: 'gptbots', knowledgeTool: true },
        { name: 'start_procedure', description: longDescription, needsMemberId: false },
        { name: 'ask_user_questions', description: longDescription, needsMemberId: false },
        { name: 'get_latest_deposit', description: longDescription, needsMemberId: true },
        { name: 'create_human_task', description: longDescription, needsMemberId: false },
        { name: 'send_bonus_adjustment', description: longDescription, needsMemberId: false },
      ],
    })

    const toolsBlock = prompt.slice(prompt.indexOf('## Available Tools'))
    expect(toolsBlock.length).toBeLessThan(1200)
    expect(toolsBlock).toContain('Use `search_knowledge` for KB')
    expect(toolsBlock).toContain('Legacy override: if older instructions mention `kb_search_*`')
    expect(toolsBlock).toContain('Use `start_procedure`')
    expect(toolsBlock).toContain('call `ask_user_questions`')
    expect(toolsBlock).toContain('**Human Handoff**')
    expect(toolsBlock).toContain('**Tool Actions**')
    expect(toolsBlock).not.toContain('Verbose provider description')
  })

  it('keeps all tool schemas only when Procedure-aware filtering is explicitly disabled', () => {
    expect(isProcedureToolSchemaFilteringEnabled({})).toBe(true)
    expect(isProcedureToolSchemaFilteringEnabled({ INTERA_PROCEDURE_TOOL_SCHEMA_FILTERING: '0' })).toBe(false)

    const allTools = [
      makeTool('start_procedure'),
      makeTool('get_latest_deposit'),
      makeTool('get_latest_withdrawal'),
      makeTool('kb_search_deposit_faq'),
    ]
    const conversationLoop = { buildPrompt: () => 'CORE_PROMPT' } as unknown as ConversationLoop
    const filterProcedureTools = vi.fn(() => [makeTool('get_latest_deposit')])
    const caseLoop = {
      buildProcedurePrompt: () => 'PROCEDURE_DEFINITION',
      filterProcedureTools,
    } as unknown as CaseAgentLoop

    const selection = selectPromptAndTools({
      isCaseActive: true,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'investigating',
      nudgeCount: 0,
      conversationLoop,
      caseLoop,
      allTools,
      procedureToolSchemaFilteringEnabled: false,
    })

    expect(selection.tools).toBe(allTools)
    expect(selection.tools.map((tool) => tool.name)).toEqual(allTools.map((tool) => tool.name))
    expect(filterProcedureTools).not.toHaveBeenCalled()
  })

  it('filters Core discovery schemas to base tools by default', () => {
    const allTools = [
      makeTool('get_latest_deposit'),
      makeTool('start_procedure'),
      makeTool('ask_user_questions'),
      makeTool('read_chat_memory'),
      makeTool('read_user_profile'),
      makeTool('remember'),
      makeTool('get_current_time'),
      makeTool('create_human_task'),
      makeTool('finalize_procedure'),
      makeTool('search_knowledge'),
      makeTool('kb_search_deposit_faq'),
      makeTool('kb_search_withdrawal_faq'),
    ]
    const conversationLoop = { buildPrompt: () => 'CORE_PROMPT' } as unknown as ConversationLoop

    const selection = selectPromptAndTools({
      isCaseActive: false,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'created',
      nudgeCount: 0,
      conversationLoop,
      caseLoop: null,
      allTools,
    })

    const names = selection.tools.map((tool) => tool.name)
    expect(names).not.toContain('get_latest_deposit')
    expect(names).toEqual([
      'start_procedure',
      'ask_user_questions',
      'read_user_profile',
      'remember',
      'get_current_time',
      'create_human_task',
      'search_knowledge',
    ])
  })

  it('filters Procedure schemas to current step tools plus conservative system tools when enabled', () => {
    const caseId = 'r3-procedure-schema-filtering'
    const procedure = toolProcedure('get_latest_deposit')
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      agentConfigId: 'agent_1',
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure,
    })

    const caseLoop = new CaseAgentLoop({
      type: 'deposit_issue',
      displayName: 'Deposit',
      procedure,
    } as any, {
      caseId,
      orgId: 'org_1',
      agentConfigId: 'agent_1',
      userId: 'user_1',
      chatId: 'chat_1',
      config: config(),
      chatMemory: { getSummary: () => ({ caseStatus: 'investigating' }) },
      getHookEngine: vi.fn(),
      traceWriter: {},
      toolRouter: {
        getToolDefinitions: () => [
          { name: 'kb_search_deposit_faq', knowledgeSourceId: 'knowledge_1' },
        ],
      },
      getMessages: () => [],
      addMessage: vi.fn(),
    } as any)

    const allTools = [
      makeTool('start_procedure'),
      makeTool('ask_user_questions'),
      makeTool('read_chat_memory'),
      makeTool('read_user_profile'),
      makeTool('remember'),
      makeTool('get_current_time'),
      makeTool('create_human_task'),
      makeTool('finalize_procedure'),
      makeTool('kb_search_deposit_faq'),
      makeTool('kb_search_withdrawal_faq'),
      makeTool('get_latest_deposit'),
      makeTool('get_latest_withdrawal'),
      makeTool('void_customer_balance'),
    ]

    const selection = selectPromptAndTools({
      isCaseActive: true,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'investigating',
      nudgeCount: 0,
      conversationLoop: { buildPrompt: () => 'CORE_PROMPT' } as unknown as ConversationLoop,
      caseLoop,
      allTools,
      procedureToolSchemaFilteringEnabled: true,
    })

    const names = selection.tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'start_procedure',
      'ask_user_questions',
      'read_user_profile',
      'remember',
      'get_current_time',
      'create_human_task',
      'get_latest_deposit',
    ]))
    expect(names).not.toContain('read_chat_memory')
    expect(names).not.toContain('finalize_procedure')
    expect(names).not.toContain('kb_search_deposit_faq')
    expect(names).not.toContain('kb_search_withdrawal_faq')
    expect(names).not.toContain('get_latest_withdrawal')
    expect(names).not.toContain('void_customer_balance')
    closeSession(caseId)
  })

  it('keeps only unified knowledge tools for a Procedure knowledge step when enabled', () => {
    const caseId = 'r3-procedure-knowledge-schema-filtering'
    const procedure = knowledgeProcedure()
    recordInitialInputEvent(caseId, { content: 'what is the deposit policy?' })
    startProcedureRun(caseId, {
      agentConfigId: 'agent_1',
      procedureId: 'deposit_policy',
      displayName: 'Deposit Policy',
      procedure,
    })

    const caseLoop = new CaseAgentLoop({
      type: 'deposit_policy',
      displayName: 'Deposit Policy',
      procedure,
    } as any, {
      caseId,
      orgId: 'org_1',
      agentConfigId: 'agent_1',
      userId: 'user_1',
      chatId: 'chat_1',
      config: config(),
      chatMemory: { getSummary: () => ({ caseStatus: 'investigating' }) },
      getHookEngine: vi.fn(),
      traceWriter: {},
      toolRouter: {
        getToolDefinitions: () => [
          { name: 'kb_search_deposit_faq', knowledgeSourceId: 'knowledge_1' },
        ],
      },
      getMessages: () => [],
      addMessage: vi.fn(),
    } as any)

    const allTools = [
      makeTool('start_procedure'),
      makeTool('ask_user_questions'),
      makeTool('read_chat_memory'),
      makeTool('read_user_profile'),
      makeTool('remember'),
      makeTool('get_current_time'),
      makeTool('create_human_task'),
      makeTool('finalize_procedure'),
      makeTool('search_knowledge'),
      makeTool('kb_search_deposit_faq'),
      makeTool('kb_search_withdrawal_faq'),
      makeTool('get_latest_deposit'),
    ]

    const selection = selectPromptAndTools({
      isCaseActive: true,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'investigating',
      nudgeCount: 0,
      conversationLoop: { buildPrompt: () => 'CORE_PROMPT' } as unknown as ConversationLoop,
      caseLoop,
      allTools,
      procedureToolSchemaFilteringEnabled: true,
    })

    const names = selection.tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'start_procedure',
      'ask_user_questions',
      'read_user_profile',
      'remember',
      'get_current_time',
      'create_human_task',
      'search_knowledge',
    ]))
    expect(names).not.toContain('read_chat_memory')
    expect(names).not.toContain('finalize_procedure')
    expect(names).not.toContain('kb_search_deposit_faq')
    expect(names).not.toContain('kb_search_withdrawal_faq')
    expect(names).not.toContain('get_latest_deposit')
    closeSession(caseId)
  })

  it('keeps unified search_knowledge for a Procedure knowledge step without leaking unrelated legacy KB or business tools', () => {
    const caseId = 'r3-procedure-unified-knowledge-schema-filtering'
    const procedure = knowledgeProcedure()
    recordInitialInputEvent(caseId, { content: 'what is the deposit policy?' })
    startProcedureRun(caseId, {
      agentConfigId: 'agent_1',
      procedureId: 'deposit_policy',
      displayName: 'Deposit Policy',
      procedure,
    })

    const caseLoop = new CaseAgentLoop({
      type: 'deposit_policy',
      displayName: 'Deposit Policy',
      procedure,
    } as any, {
      caseId,
      orgId: 'org_1',
      agentConfigId: 'agent_1',
      userId: 'user_1',
      chatId: 'chat_1',
      config: config(),
      chatMemory: { getSummary: () => ({ caseStatus: 'investigating' }) },
      getHookEngine: vi.fn(),
      traceWriter: {},
      toolRouter: {
        getToolDefinitions: () => [
          { name: 'search_knowledge', knowledgeProvider: 'gptbots' },
          { name: 'kb_search_deposit_faq', knowledgeSourceId: 'legacy_1', providerHidden: true },
        ],
      },
      getMessages: () => [],
      addMessage: vi.fn(),
    } as any)

    const allTools = [
      makeTool('start_procedure'),
      makeTool('ask_user_questions'),
      makeTool('read_chat_memory'),
      makeTool('read_user_profile'),
      makeTool('remember'),
      makeTool('get_current_time'),
      makeTool('create_human_task'),
      makeTool('finalize_procedure'),
      makeTool('search_knowledge'),
      makeTool('kb_search_deposit_faq'),
      makeTool('kb_search_withdrawal_faq'),
      makeTool('get_latest_deposit'),
    ]

    const selection = selectPromptAndTools({
      isCaseActive: true,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'investigating',
      nudgeCount: 0,
      conversationLoop: { buildPrompt: () => 'CORE_PROMPT' } as unknown as ConversationLoop,
      caseLoop,
      allTools,
      procedureToolSchemaFilteringEnabled: true,
    })

    const names = selection.tools.map((tool) => tool.name)
    expect(names).toContain('search_knowledge')
    expect(names).not.toContain('read_chat_memory')
    expect(names).not.toContain('finalize_procedure')
    expect(names).not.toContain('kb_search_deposit_faq')
    expect(names).not.toContain('kb_search_withdrawal_faq')
    expect(names).not.toContain('get_latest_deposit')
    closeSession(caseId)
  })

  it('falls back to always-on schemas when the active step cannot be determined', () => {
    const caseId = 'r3-procedure-schema-filtering-fallback'
    const procedure = toolProcedure('get_latest_deposit')
    const caseLoop = new CaseAgentLoop({
      type: 'deposit_issue',
      displayName: 'Deposit',
      procedure,
    } as any, {
      caseId,
      orgId: 'org_1',
      agentConfigId: 'agent_1',
      userId: 'user_1',
      config: config(),
      chatMemory: { getSummary: () => ({ caseStatus: 'investigating' }) },
      getHookEngine: vi.fn(),
      traceWriter: {},
      toolRouter: { getToolDefinitions: () => [] },
      getMessages: () => [],
      addMessage: vi.fn(),
    } as any)
    const allTools = [
      makeTool('start_procedure'),
      makeTool('ask_user_questions'),
      makeTool('read_user_profile'),
      makeTool('remember'),
      makeTool('get_current_time'),
      makeTool('create_human_task'),
      makeTool('search_knowledge'),
      makeTool('get_latest_deposit'),
      makeTool('get_latest_withdrawal'),
    ]

    const selection = selectPromptAndTools({
      isCaseActive: true,
      isConsultation: false,
      systemPrompt: 'CORE_PROMPT',
      currentStage: 'investigating',
      nudgeCount: 0,
      conversationLoop: { buildPrompt: () => 'CORE_PROMPT' } as unknown as ConversationLoop,
      caseLoop,
      allTools,
      procedureToolSchemaFilteringEnabled: true,
    })

    expect(selection.tools.map((tool) => tool.name)).toEqual([
      'start_procedure',
      'ask_user_questions',
      'read_user_profile',
      'remember',
      'get_current_time',
      'create_human_task',
      'search_knowledge',
    ])
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
    expect(upsertArg.create.profile).toContain('## Preferences')
    expect(upsertArg.create.profile).toContain('- preference: prefers SMS updates')
    expect(upsertArg.create.profile).not.toContain('## Activity')
    expect(upsertArg.create.profile).not.toContain('Memory reason')
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
    expect(firstUpsertArg.create.profile).toContain('## Identity')
    expect(firstUpsertArg.create.profile).toContain('- vip_level: gold')
    expect(firstUpsertArg.create.profile).not.toContain('## Activity')
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
