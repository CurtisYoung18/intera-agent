// Phase 1 guard tests — deterministic prompt injection.
// Verifies that system-managed context blocks are always present
// in the assembled prompt, regardless of {{...}} token presence.
import { describe, it, expect, vi } from 'vitest'

// Mock buildPromptContext to avoid DB calls; we test injection logic here.
vi.mock('@/lib/agent/prompt-resolver', async () => {
  const actual = await vi.importActual('@/lib/agent/prompt-resolver')
  const mockBuildCtx = vi.fn(async (params?: Record<string, unknown>) => ({
    case_types: [
      { type: 'deposit_issue', displayName: 'Deposit not credited', description: 'Test' },
    ],
    active_hooks: [
      { name: 'no_high_risk_account_change', checkpoint: 'PreToolUse', description: 'Block high-risk' },
    ],
    case_schema: (params?.caseSchema as object) ?? null,
    case_state: (params?.caseState as object) ?? null,
    session_binding: (params?.sessionBinding as object) ?? { userId: 'test-user-123', userLabel: 'Test User' },
    available_tools: (params?.available_tools as unknown[]) ?? [
      { name: 'search_knowledge', description: 'Search configured knowledge sources', needsMemberId: false, knowledgeProvider: 'gptbots', knowledgeTool: true },
    ],
  }))
  return {
    ...(actual as object),
    buildPromptContext: mockBuildCtx,
  }
})

import { buildModePrompt } from '../buildModePrompt'
import { buildConversationContinuityContext } from '../conversation-continuity'

describe('buildModePrompt — deterministic injection (Phase 1)', () => {
  const baseInput = {
    agentConfigId: 'test-agent',
    coreSystemPrompt: null,
    systemPrompt: null,
    caseAddendum: null,
    useLegacyCasePrompt: false,
    hasActiveCase: false,
    caseSchema: null,
    caseState: null,
    sessionBinding: { userId: 'test-user-123', userLabel: 'Test User' },
    availableTools: [
      { name: 'start_procedure', description: 'Start a ProcedureRun', needsMemberId: false },
      { name: 'search_knowledge', description: 'Search configured knowledge sources', needsMemberId: false, knowledgeProvider: 'gptbots', knowledgeTool: true },
      { name: 'ask_user_questions', description: 'Ask structured customer questions', needsMemberId: false },
      { name: 'create_human_task', description: 'Create a human handoff task', needsMemberId: false },
      { name: 'read_user_profile', description: 'Read user profile memory', needsMemberId: false },
      { name: 'remember', description: 'Save user profile memory', needsMemberId: false },
      { name: 'get_current_time', description: 'Read current server time', needsMemberId: false },
    ],
  }

  // ── Golden-snapshot: default prompt with tokens → semantically equivalent ──
  it('produces blocks identical to token-based resolution for standard prompt', async () => {
    const result = await buildModePrompt(baseInput)
    // All canonical blocks must be present
    expect(result.prompt).toContain('## Response Focus')
    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).toContain('## Available Procedures')
    expect(result.prompt).toContain('## Current User')
    // No raw {{...}} tokens remain
    expect(result.prompt).not.toMatch(/\{\{[a-z_]+\}\}/)
    expect(result.prompt).toContain('Full tool descriptions and parameters are in the provider tool schemas')
    expect(result.prompt).not.toContain('Start a ProcedureRun')
    expect(result.prompt).not.toContain('Create a human handoff task')
  })

  // ── No-token config still receives all injection blocks ──
  it('injects tools/case_types/session_binding even without tokens in prose', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      // coreSystemPrompt without any {{...}} tokens
      coreSystemPrompt: 'You are a helpful assistant. Be concise.',
    })
    expect(result.prompt).toContain('## Response Focus')
    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).toContain('## Available Procedures')
    expect(result.prompt).toContain('## Current User')
    expect(result.prompt).not.toMatch(/\{\{[a-z_]+\}\}/)
  })

  it('injects optional conversation continuity context without forcing member id behavior', async () => {
    const continuityContext = buildConversationContinuityContext({
      knownFacts: {
        member_id: 'JAYA1126511',
        withdrawal_status: 'pending',
      },
      previousSegmentDigest: 'Customer previously asked about a delayed withdrawal.',
    })

    const result = await buildModePrompt({
      ...baseInput,
      coreSystemPrompt: 'You are a helpful assistant.',
      continuityContext,
    })

    expect(result.prompt).toContain('## Conversation Continuity Context')
    expect(result.prompt).toContain('- member_id: JAYA1126511')
    expect(result.prompt).toContain('Customer previously asked about a delayed withdrawal.')
    expect(result.prompt).not.toMatch(/do not ask|don't ask|do not repeat|don't repeat|不要.*问|不要.*重复/i)
  })

  // ── No double-injection: blocks appear exactly once ──
  it('does not double-inject when tokens are present in prose', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      coreSystemPrompt: 'System prompt with {{available_tools}} and {{case_types}}.',
    })
    // Count occurrences of the heading — each must appear exactly once
    const toolsCount = (result.prompt.match(/## Available Tools/g) || []).length
    const caseTypesCount = (result.prompt.match(/## Available Procedures/g) || []).length
    expect(toolsCount).toBe(1)
    expect(caseTypesCount).toBe(1)
  })

  it('renders unified search_knowledge as the only KB prompt summary with a legacy-name override', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      coreSystemPrompt: 'You are a support agent.',
      availableTools: [
        {
          name: 'search_knowledge',
          description: 'Search knowledge sources. Available sources: source="deposit_bonus" - Deposit Bonus.',
          needsMemberId: false,
          knowledgeProvider: 'gptbots',
          knowledgeTool: true,
        },
      ],
    })

    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).toContain('search_knowledge')
    expect(result.prompt).toContain('## Knowledge Tool Override')
    expect(result.prompt).toContain('kb_search_*')
    expect(result.prompt).not.toContain('kb_search_deposit')
    expect(result.prompt).not.toContain('Available sources: source="deposit_bonus"')
    expect(result.prompt).not.toContain('Deposit Bonus')
  })

  it('filters business and legacy tools out of the core prompt tool summary', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      coreSystemPrompt: 'You are a support agent.',
      availableTools: [
        ...baseInput.availableTools,
        { name: 'get_latest_deposit', description: 'Lookup latest deposit', needsMemberId: true },
        { name: 'kb_search_deposit_faq', description: 'Legacy deposit FAQ', needsMemberId: false, knowledgeSourceId: 'ks_deposit' },
        { name: 'finalize_procedure', description: 'Finalize the ProcedureRun', needsMemberId: false },
      ],
    })

    expect(result.prompt).toContain('search_knowledge')
    expect(result.prompt).toContain('ask_user_questions')
    expect(result.prompt).not.toContain('get_latest_deposit')
    expect(result.prompt).not.toContain('kb_search_deposit_faq')
    expect(result.prompt).not.toContain('finalize_procedure')
  })

  // ── Case mode: case-specific blocks injected ──
  it('injects case_schema/case_state/hooks in case mode', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      hasActiveCase: true,
      caseSchema: {
        type: 'deposit_issue',
        displayName: 'Test Case',
        icon: '💰',
        defaultGoal: 'Verify',
        requiredFacts: ['userId'],
        escalateOn: ['conflict'],
      },
      caseState: {
        toolsCalled: ['get_account_status'],
        missingFacts: [],
        summary: 'Member provided a member id and asked for verification.',
        keyEvents: [{ at: '2026-06-12T00:00:00.000Z', text: 'Member asked about account status.', source: 'llm' }],
      },
    })
    expect(result.prompt).toContain('## Procedure Type Schema')
    expect(result.prompt).toContain('## Current Chat Context')
    expect(result.prompt).toContain('## Active Hooks')
    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).toContain('Summary:')
    expect(result.prompt).toContain('Recent events:')
    expect(result.prompt).not.toMatch(/\{\{[a-z_]+\}\}/)
  })

  it('hides internal procedure runtime state from Current Chat Context', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      hasActiveCase: true,
      caseSchema: {
        type: 'deposit_issue',
        displayName: 'Test Case',
        icon: 'case',
        defaultGoal: 'Verify',
        requiredFacts: ['userId'],
        escalateOn: ['conflict'],
      },
      caseState: {
        summary: 'Customer asked for help with a deposit.',
        keyEvents: [
          { at: '2026-06-12T00:00:00.000Z', text: 'Customer typed member id 123.', source: 'dashboard' },
          { at: '2026-06-12T00:00:01.000Z', text: '__intera_procedure_runtime should never appear', source: 'dashboard' },
        ],
        toolsCalled: [],
        missingFacts: [],
      },
    })

    expect(result.prompt).toContain('## Current Chat Context')
    expect(result.prompt).toContain('Customer typed member id 123.')
    expect(result.prompt).not.toContain('__intera_procedure_runtime')
    expect(result.prompt).not.toContain('activeProcedureRun')
  })

  // ── Empty context blocks are not injected ──
  it('omits empty blocks (no tools → no Available Tools section)', async () => {
    const { buildPromptContext } = await import('@/lib/agent/prompt-resolver')
    ;(buildPromptContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      case_types: [],
      active_hooks: [],
      case_schema: null,
      case_state: null,
      session_binding: null,
      available_tools: [],
    })

    const result = await buildModePrompt({
      ...baseInput,
      availableTools: [],
      sessionBinding: undefined,
    })
    // Empty blocks should not create headings
    expect(result.prompt).not.toContain('## Available Tools')
    expect(result.prompt).not.toContain('## Current User')
    expect(result.prompt).not.toContain('## Available Procedures')
  })
})
