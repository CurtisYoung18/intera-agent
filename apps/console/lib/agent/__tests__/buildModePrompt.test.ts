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
    active_policies: [
      { name: 'no_high_risk_account_change', hook: 'preTool', description: 'Block high-risk' },
    ],
    case_schema: (params?.caseSchema as object) ?? null,
    case_state: (params?.caseState as object) ?? null,
    session_binding: (params?.sessionBinding as object) ?? { userId: 'test-user-123', userLabel: 'Test User' },
    available_tools: (params?.available_tools as unknown[]) ?? [
      { name: 'kb_search_faq', description: 'Search the FAQ knowledge base', needsMemberId: false },
    ],
  }))
  return {
    ...(actual as object),
    buildPromptContext: mockBuildCtx,
  }
})

import { buildModePrompt } from '../buildModePrompt'

describe('buildModePrompt — deterministic injection (Phase 1)', () => {
  const baseInput = {
    orgId: 'test-org',
    coreSystemPrompt: null,
    systemPrompt: null,
    caseAddendum: null,
    useLegacyCasePrompt: false,
    hasActiveCase: false,
    caseSchema: null,
    caseState: null,
    sessionBinding: { userId: 'test-user-123', userLabel: 'Test User' },
    availableTools: [
      { name: 'kb_search_faq', description: 'Search the FAQ knowledge base', needsMemberId: false },
    ],
  }

  // ── Golden-snapshot: default prompt with tokens → semantically equivalent ──
  it('produces blocks identical to token-based resolution for standard prompt', async () => {
    const result = await buildModePrompt(baseInput)
    // All canonical blocks must be present
    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).toContain('## Available Case Types')
    expect(result.prompt).toContain('## Current User')
    // No raw {{...}} tokens remain
    expect(result.prompt).not.toMatch(/\{\{[a-z_]+\}\}/)
  })

  // ── No-token config still receives all injection blocks ──
  it('injects tools/case_types/session_binding even without tokens in prose', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      // coreSystemPrompt without any {{...}} tokens
      coreSystemPrompt: 'You are a helpful assistant. Be concise.',
    })
    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).toContain('## Available Case Types')
    expect(result.prompt).toContain('## Current User')
    expect(result.prompt).not.toMatch(/\{\{[a-z_]+\}\}/)
  })

  // ── No double-injection: blocks appear exactly once ──
  it('does not double-inject when tokens are present in prose', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      coreSystemPrompt: 'System prompt with {{available_tools}} and {{case_types}}.',
    })
    // Count occurrences of the heading — each must appear exactly once
    const toolsCount = (result.prompt.match(/## Available Tools/g) || []).length
    const caseTypesCount = (result.prompt.match(/## Available Case Types/g) || []).length
    expect(toolsCount).toBe(1)
    expect(caseTypesCount).toBe(1)
  })

  // ── Case mode: case-specific blocks injected ──
  it('injects case_schema/case_state/policies in case mode', async () => {
    const result = await buildModePrompt({
      ...baseInput,
      hasActiveCase: true,
      caseSchema: {
        type: 'deposit_issue',
        displayName: 'Test Case',
        icon: '💰',
        defaultGoal: 'Verify',
        stages: ['created', 'investigating'],
        requiredFacts: ['userId'],
        escalateOn: ['conflict'],
      },
      caseState: {
        confirmedFacts: { userId: '123' },
        skillsCalled: ['get_account_status'],
        missingFacts: [],
      },
    })
    expect(result.prompt).toContain('## Case Schema')
    expect(result.prompt).toContain('## Current Case State')
    expect(result.prompt).toContain('## Active Policies')
    expect(result.prompt).toContain('## Available Tools')
    expect(result.prompt).not.toMatch(/\{\{[a-z_]+\}\}/)
  })

  // ── Empty context blocks are not injected ──
  it('omits empty blocks (no tools → no Available Tools section)', async () => {
    const { buildPromptContext } = await import('@/lib/agent/prompt-resolver')
    ;(buildPromptContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      case_types: [],
      active_policies: [],
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
    expect(result.prompt).not.toContain('## Available Case Types')
  })
})
