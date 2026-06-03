// e2e guard tests for CapabilityBindings runtime switch (Lane 1).
//
// Drives the REAL runtime entry points — SkillRouter and PolicyEngine —
// NOT mock/seam tests. Each test exercises the binding wiring through
// the actual create() factory methods.
//
// Red-green proof:
//   - Binding isolation: only tools in the bindings are returned
//   - Drift fail-soft: missing bound items log warnings, don't throw
//   - Guardrail regression: policy engine evaluates correctly with bindings.guardrails

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SkillRouter } from '@/lib/agent/skills'
import { PolicyEngine } from '@/lib/agent/policy'
import { EMPTY_BINDINGS } from '@intera/shared/types'
import type { CapabilityBindings } from '@intera/shared/types'

// ── Prisma mock (test-level isolate) ──
// SkillRouter.create() imports @intera/shared/prisma dynamically.
// PolicyEngine.create() imports @intera/shared/prisma dynamically.
// We mock the prisma module at test level so neither touches a real DB.

const mockSkillDb: Array<{ name: string; description: string; inputSchema: string; outputSchema: string; mode: string; endpoint: string | null; httpMethod: string; headers: string | null; timeoutMs: number; mockFixture: string | null; displayVerb: string | null; renderHints: string | null; guardPhase: string; toolCategory: string | null; isConcurrencySafe: boolean; enabled: boolean }> = []
const mockPolicyDb: Array<{ name: string; hook: string; rule: string; enabled: boolean }> = []
const mockCaseTypeDb: Array<{ type: string; displayName: string; description: string | null; icon: string; enabled: boolean }> = []
const mockKnowledgeDb: Record<string, unknown>[] = []

function resetMockDb() {
  mockSkillDb.length = 0
  mockPolicyDb.length = 0
  mockCaseTypeDb.length = 0
  mockKnowledgeDb.length = 0
}

// Helper: build mock knowledge source compatible with Prisma query shape
function makeMockKnowledgeSource(name: string, overrides?: Record<string, unknown>) {
  return {
    id: `ks_${name}`,
    orgId: 'test-org',
    name,
    description: `Description for ${name}`,
    enabled: true,
    groupIds: '[]',
    embeddingRate: 0.9,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    caseTypeTag: null,
    ...overrides,
  }
}

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    skill: {
      findMany: vi.fn(() => Promise.resolve(mockSkillDb)),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    caseType: {
      findMany: vi.fn((args: any) => {
        const where = args?.where || {}
        const enabled = where.enabled !== false
        const typeIn = where.type?.in
        let results = mockCaseTypeDb.filter((c) => enabled || c.enabled === enabled)
        if (typeIn) results = results.filter((c) => typeIn.includes(c.type))
        return Promise.resolve(results)
      }),
    },
    knowledgeSource: {
      findMany: vi.fn((args: any) => {
        const where = args?.where || {}
        const orgId = where.orgId as string | undefined
        const enabledFilter = where.enabled !== false
        const nameIn = where.name?.in as string[] | undefined
        let results = mockKnowledgeDb
        if (orgId) results = results.filter((k) => k.orgId === orgId)
        results = results.filter((k) => k.enabled === enabledFilter)
        if (nameIn) results = results.filter((k) => nameIn.includes(k.name as string))
        return Promise.resolve(results)
      }),
      update: vi.fn(() => Promise.resolve({})),
    },
    policy: {
      findMany: vi.fn((args: any) => {
        const where = args?.where || {}
        const enabled = where.enabled !== false
        return Promise.resolve(mockPolicyDb.filter((p) => enabled || p.enabled === enabled))
      }),
    },
    agentConfig: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findFirst: vi.fn(() => Promise.resolve(null)),
    },
  },
}))

// ── Test suite ──

describe('CapabilityBindings e2e guard tests', () => {
  beforeEach(() => {
    resetMockDb()
  })

  // ── 1. Binding isolation ──

  describe('SkillRouter tool binding isolation', () => {
    it('returns only tools listed in bindings.tools when bindings are provided', async () => {
      // Seed: three skills in the library
      mockSkillDb.push(
        { name: 'skill_a', description: 'a', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
        { name: 'skill_b', description: 'b', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
        { name: 'skill_c', description: 'c', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
      )

      // Version A bindings: only skill_a and skill_b
      const bindingsA: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: ['skill_a', 'skill_b'],
        caseTypes: [],
        knowledge: [],
      }

      // Version B bindings: only skill_c
      const bindingsB: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: ['skill_c'],
        caseTypes: [],
        knowledge: [],
      }

      const routerA = await SkillRouter.create('test-org', true, bindingsA)
      const routerB = await SkillRouter.create('test-org', true, bindingsB)

      const toolsA = routerA.getToolDefinitions().map((t) => t.name)
      const toolsB = routerB.getToolDefinitions().map((t) => t.name)

      // Version A should have skill_a and skill_b (plus built-ins that are always present)
      expect(toolsA).toContain('skill_a')
      expect(toolsA).toContain('skill_b')
      expect(toolsA).not.toContain('skill_c')

      // Version B should have skill_c but NOT skill_a or skill_b
      expect(toolsB).toContain('skill_c')
      expect(toolsB).not.toContain('skill_a')
      expect(toolsB).not.toContain('skill_b')
    })

    it('returns all enabled tools when no bindings are provided (backward compat)', async () => {
      mockSkillDb.push(
        { name: 'skill_a', description: 'a', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
        { name: 'skill_b', description: 'b', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
        { name: 'skill_c', description: 'c', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
      )

      // No bindings at all
      const router = await SkillRouter.create('test-org', true, null)

      const toolNames = router.getToolDefinitions().map((t) => t.name)
      expect(toolNames).toContain('skill_a')
      expect(toolNames).toContain('skill_b')
      expect(toolNames).toContain('skill_c')
    })

    it('disabled library skills are excluded even when in bindings', async () => {
      // skill_a enabled, skill_b disabled
      mockSkillDb.push(
        { name: 'skill_a', description: 'a', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
        { name: 'skill_b', description: 'b', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: false },
      )

      const bindings: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: ['skill_a', 'skill_b'],
        caseTypes: [],
        knowledge: [],
      }

      const router = await SkillRouter.create('test-org', true, bindings)

      const toolNames = router.getToolDefinitions().map((t) => t.name)
      expect(toolNames).toContain('skill_a')
      // skill_b is in bindings but disabled in library — should be excluded
      expect(toolNames).not.toContain('skill_b')
    })
  })

  // ── 2. Drift fail-soft ──

  describe('Drift detection (fail-soft)', () => {
    it('logs drift warning but does not throw when a bound skill is missing from library', async () => {
      mockSkillDb.push(
        { name: 'skill_a', description: 'a', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
      )

      const bindings: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: ['skill_a', 'nonexistent_skill'],
        caseTypes: [],
        knowledge: [],
      }

      const warnSpy = vi.spyOn(console, 'warn')

      // Should NOT throw
      const router = await SkillRouter.create('test-org', true, bindings)

      const toolNames = router.getToolDefinitions().map((t) => t.name)

      // skill_a should be present
      expect(toolNames).toContain('skill_a')
      // nonexistent_skill should NOT be present
      expect(toolNames).not.toContain('nonexistent_skill')

      // A drift warning should have been logged
      const driftWarnings = warnSpy.mock.calls.filter(
        (call) => call[0] && typeof call[0] === 'string' && call[0].includes('drift'),
      )
      expect(driftWarnings.length).toBeGreaterThan(0)

      warnSpy.mockRestore()
    })

    it('fails soft with EMPTY_BINDINGS (no tools, no errors)', async () => {
      mockSkillDb.push(
        { name: 'skill_a', description: 'a', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
      )

      const router = await SkillRouter.create('test-org', true, EMPTY_BINDINGS)

      const toolNames = router.getToolDefinitions().map((t) => t.name)
      // With EMPTY_BINDINGS, no tools should be bound — including DB skills
      // (built-in SOP tools like todo_write are always available as engine-managed)
      expect(toolNames).not.toContain('skill_a')
    })

    it('drifts on knowledge sources: only creates kb_search_* for bound sources', async () => {
      mockKnowledgeDb.push(
        makeMockKnowledgeSource('Deposit FAQ'),
        makeMockKnowledgeSource('Withdrawal FAQ'),
        makeMockKnowledgeSource('Game FAQ'),
      )

      const bindings: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: [],
        caseTypes: [],
        knowledge: ['Deposit FAQ', 'Game FAQ'], // Withdrawal FAQ omitted
      }

      const router = await SkillRouter.create('test-org', true, bindings)

      const toolNames = router.getToolDefinitions().map((t) => t.name)
      expect(toolNames).toContain('kb_search_Deposit_FAQ')
      expect(toolNames).toContain('kb_search_Game_FAQ')
      // Withdrawal FAQ is not in bindings → should NOT have a kb_search_*
      expect(toolNames).not.toContain('kb_search_Withdrawal_FAQ')
    })
  })

  // ── 3. Guardrail migration regression ──

  describe('PolicyEngine guardrail migration', () => {
    it('evaluates policies correctly when guardrails come from capabilityBindings', async () => {
      // Register a custom policy in the mock DB
      mockPolicyDb.push(
        {
          name: 'custom_block_skill',
          hook: 'preTool',
          rule: JSON.stringify({ deny_skills: ['blocked_skill'] }),
          enabled: true,
        },
      )

      // Create engine with guardrails from capabilityBindings format
      const guardrails: CapabilityBindings['guardrails'] = {
        preTool: ['custom_block_skill'],
        postTool: [],
        preFinalize: ['evidence_required_before_resolution'],
      }

      const engine = await PolicyEngine.create('test-org', guardrails)

      // Calling a blocked skill should be blocked
      const blockedResult = await engine.evaluate('preTool', {
        skillName: 'blocked_skill',
        skillInput: {},
      })
      expect(blockedResult.summary).toBe('blocked')

      // Calling an allowed skill should pass
      const passResult = await engine.evaluate('preTool', {
        skillName: 'allowed_skill',
        skillInput: {},
      })
      expect(passResult.summary).toBe('pass')
    })

    it('falls back to DB policies when no guardrails are provided (backward compat)', async () => {
      mockPolicyDb.push(
        {
          name: 'db_block_skill',
          hook: 'preTool',
          rule: JSON.stringify({ deny_skills: ['blocked_skill'] }),
          enabled: true,
        },
      )

      // No guardrails at all — engine should load from DB
      const engine = await PolicyEngine.create('test-org')

      const result = await engine.evaluate('preTool', {
        skillName: 'blocked_skill',
        skillInput: {},
      })
      expect(result.summary).toBe('blocked')
    })

    it('evaluates built-in policies when neither guardrails nor DB policies exist', async () => {
      // Empty mock DB (no policies), no guardrails — should fall back to built-in defaults
      const engine = await PolicyEngine.create('test-org')

      // Built-in default preTool hook: no_high_risk_account_change blocks refund_money
      const result = await engine.evaluate('preTool', {
        skillName: 'refund_money',
        skillInput: {},
      })
      expect(result.summary).toBe('blocked')

      // Built-in default postTool hook: conflict_requires_human
      // This policy has hook_skills + evaluationPrompt — it fires for the listed investigative skills
      // When skillOutput is not provided, LLM evaluation is skipped (no output to evaluate)
      // but exact-match rules still run — the hook_skills gate passes for matching skills
      const postResult = await engine.evaluate('postTool', {
        skillName: 'get_latest_deposit',
        skillInput: {},
        skillOutput: { status: 'completed' },
      })
      // conflict_requires_human returns 'hint' or 'pass' depending on LLM — but since we mock
      // the Anthropic client isn't available, the LLM call fails and falls back to 'hint'.
      // Accept both pass and hint since the policy engine processes this asynchronously.
      expect(['pass', 'hint']).toContain(postResult.summary)
    })

    it('resolves guardrail names against the policy map (filters unknown names)', async () => {
      mockPolicyDb.push(
        {
          name: 'existing_policy',
          hook: 'preTool',
          rule: JSON.stringify({ deny_skills: ['blocked_skill'] }),
          enabled: true,
        },
      )

      const guardrails: CapabilityBindings['guardrails'] = {
        preTool: ['existing_policy', 'nonexistent_policy'],
        postTool: [],
        preFinalize: [],
      }

      const engine = await PolicyEngine.create('test-org', guardrails)

      // 'existing_policy' is in the DB → should block
      expect(engine['hooks'].preTool).toContain('existing_policy')
      // 'nonexistent_policy' is NOT in the DB → should be filtered out
      expect(engine['hooks'].preTool).not.toContain('nonexistent_policy')
    })
  })

  // ── 4. Multi-version binding isolation (end-to-end) ──

  describe('Multi-version tool isolation (Version A vs Version B)', () => {
    it('version A and version B see only their own bound tools', async () => {
      mockSkillDb.push(
        { name: 'tool_x', description: 'x', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
        { name: 'tool_y', description: 'y', inputSchema: '{}', outputSchema: '{}', mode: 'static', endpoint: null, httpMethod: 'GET', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, guardPhase: 'post', toolCategory: 'operational', isConcurrencySafe: true, enabled: true },
      )

      const bindingsV1: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: ['tool_x'],
        caseTypes: [],
        knowledge: [],
      }

      const bindingsV2: CapabilityBindings = {
        guardrails: { preTool: [], postTool: [], preFinalize: [] },
        tools: ['tool_y'],
        caseTypes: [],
        knowledge: [],
      }

      const routerV1 = await SkillRouter.create('test-org', true, bindingsV1)
      const routerV2 = await SkillRouter.create('test-org', true, bindingsV2)

      const toolsV1 = routerV1.getToolDefinitions().map((t) => t.name)
      const toolsV2 = routerV2.getToolDefinitions().map((t) => t.name)

      expect(toolsV1).toContain('tool_x')
      expect(toolsV1).not.toContain('tool_y')

      expect(toolsV2).toContain('tool_y')
      expect(toolsV2).not.toContain('tool_x')
    })
  })
})
