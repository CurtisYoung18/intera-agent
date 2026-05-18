// Intera Harness - Policy Engine
// Guardrail policies evaluated at preTool, postTool, and preFinalize checkpoints.
// Policies load from DB (overlay on built-in seed) and hooks are driven by AgentConfig.policyHooks.
// PostTool evaluations are batched into a single LLM call per iteration.

import Anthropic from '@anthropic-ai/sdk'
import type { PolicyHook, PolicyResult, PolicyRule, PolicyHooks, StageGuardrail } from '@intera/shared/types'

export interface PolicyContext {
  skillName?: string
  skillInput?: Record<string, unknown>
  skillOutput?: unknown
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
}

export interface PolicyCheckResult {
  policyName: string
  result: PolicyResult
  reason?: string
  modelUsed?: string
}

export class PolicyEngine {
  private policies: Map<string, PolicyRule> = new Map()
  private hooks: Record<PolicyHook, string[]> = {
    preTool: [],
    postTool: [],
    preFinalize: [],
  }
  private policyModel: string
  private llmClient: Anthropic

  constructor(private customerId: string, policyHooks?: PolicyHooks) {
    this.policyModel = process.env.POLICY_EVAL_MODEL || 'MiniMax-M2.7-highspeed'
    this.llmClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })
    this.loadBuiltInPolicies()
    if (policyHooks) {
      this.hooks.preTool = policyHooks.preTool || []
      this.hooks.postTool = policyHooks.postTool || []
      this.hooks.preFinalize = policyHooks.preFinalize || []
    }
  }

  /** Create and initialize a PolicyEngine — loads built-ins + DB policies. */
  static async create(customerId: string, policyHooks?: PolicyHooks): Promise<PolicyEngine> {
    const engine = new PolicyEngine(customerId, policyHooks)

    try {
      const { prisma } = await import('@intera/shared/prisma')
      const dbPolicies = await prisma.policy.findMany({
        where: { customerId, enabled: true },
      })

      for (const p of dbPolicies) {
        const rule = JSON.parse(p.rule || '{}') as Record<string, unknown>
        engine.policies.set(p.name, rule as any)

        const hook = p.hook as 'preTool' | 'postTool' | 'preFinalize'
        if (!engine.hooks[hook].includes(p.name)) {
          engine.hooks[hook].push(p.name)
        }
      }
    } catch (err) {
      console.warn('[PolicyEngine] Failed to load policies from DB, using built-ins only:', err)
    }

    return engine
  }

  private loadBuiltInPolicies(): void {
    this.policies.set('no_high_risk_account_change', {
      deny_skills: ['refund_money', 'change_ban_status', 'delete_account'],
    })

    this.policies.set('conflict_requires_human', {
      evaluationPrompt:
        'Check whether the skill outputs contradict what the customer reported. ' +
        'If system data indicates success/normal but the customer reports a problem (not received, missing funds, failed transaction, etc), ' +
        'the result must be "escalated" because a human operator needs to investigate the discrepancy. ' +
        'If outputs align with the customer issue, return "pass". ' +
        'If the situation is unclear or data is ambiguous (e.g. status="pending"), return "hint".',
    })

    this.policies.set('evidence_required_before_resolution', {
      require_skills_any: ['query_order_status', 'query_account_status'],
    })

    this.policies.set('no_compensation_promise', {
      evaluationPrompt:
        'Check whether the finalize conclusion contains any promise of monetary compensation, refund, reimbursement, or direct financial remedy to the customer. ' +
        'If it does, return "blocked" — agents must not commit to compensation without human approval. ' +
        'If merely explaining policy or describing possible outcomes without making promises, return "pass".',
    })

    this.policies.set('must_cite_basis', {
      evaluationPrompt:
        'Check whether the finalize conclusion explicitly cites evidence sources or explains the factual basis for the resolution. ' +
        'The conclusion must reference specific findings from skills or facts gathered during the case. ' +
        'If the conclusion lacks any evidence citation or factual grounding, return "blocked". ' +
        'If evidence is properly cited, return "pass".',
    })

    this.policies.set('investigate_before_escalation', {
      require_skills_any: ['query_order_status', 'query_payment_channel_status', 'query_account_status'],
    })

    this.hooks.preTool = ['no_high_risk_account_change', 'investigate_before_escalation']
    this.hooks.postTool = ['conflict_requires_human']
    this.hooks.preFinalize = [
      'evidence_required_before_resolution',
      'no_compensation_promise',
      'must_cite_basis',
    ]
  }

  /** Check a single policy rule against context (preTool uses fast exact match; postTool/preFinalize may use LLM). */
  async check(
    hook: PolicyHook,
    context: PolicyContext,
  ): Promise<PolicyCheckResult> {
    const policyNames = this.hooks[hook]

    for (const policyName of policyNames) {
      const rule = this.policies.get(policyName)
      if (!rule) continue

      const result = await this.evaluateRule(rule, policyName, context, hook)
      if (result.result !== 'pass') {
        return result
      }
    }

    return { policyName: '', result: 'pass' }
  }

  /** Batch-evaluate all postTool policies against collected tool results in a single LLM call. */
  async evaluatePostToolBatch(
    toolResults: Array<{ name: string; output: unknown }>,
    confirmedFacts: Record<string, unknown>,
  ): Promise<PolicyCheckResult[]> {
    const policyNames = this.hooks.postTool
    const results: PolicyCheckResult[] = []

    for (const policyName of policyNames) {
      const rule = this.policies.get(policyName)
      if (!rule) continue

      // Collect all tool outputs for this policy
      const ctxSummary = toolResults
        .map((tr) => `[${tr.name}]: ${JSON.stringify(tr.output)}`)
        .join('\n')

      const result = await this.evaluateRule(
        rule,
        policyName,
        { skillOutput: ctxSummary, confirmedFacts },
        'postTool',
      )
      results.push(result)
    }

    return results
  }

  private async evaluateRule(
    rule: PolicyRule,
    policyName: string,
    context: PolicyContext,
    _hook: PolicyHook,
  ): Promise<PolicyCheckResult> {
    // ── deny_skills (preTool) — exact name match, no LLM needed ──
    if (
      rule.deny_skills &&
      context.skillName &&
      rule.deny_skills.includes(context.skillName)
    ) {
      return {
        policyName,
        result: 'blocked',
        reason: `Skill "${context.skillName}" is denied by policy`,
      }
    }

    // ── require_skills — exact name match (checked for finalize_case and create_human_task) ──
    if (rule.require_skills && (context.skillName === 'finalize_case' || context.skillName === 'create_human_task')) {
      const called = context.skillsCalled || []
      const missing = rule.require_skills.filter((s) => !called.includes(s))
      if (missing.length > 0) {
        return {
          policyName,
          result: 'blocked',
          reason: `Required skills not called before ${context.skillName}: ${missing.join(', ')}`,
        }
      }
    }

    // ── require_skills_any — exact name match (checked for finalize_case and create_human_task) ──
    if (rule.require_skills_any && rule.require_skills_any.length > 0 && (context.skillName === 'finalize_case' || context.skillName === 'create_human_task')) {
      const called = context.skillsCalled || []
      const ok = rule.require_skills_any.some((s) => called.includes(s))
      if (!ok) {
        return {
          policyName,
          result: 'blocked',
          reason: `Before finalize, call at least one of: ${rule.require_skills_any.join(', ')}`,
        }
      }
    }

    // ── min_evidence_count — numeric threshold ──
    if (rule.min_evidence_count) {
      const factCount = context.confirmedFacts
        ? Object.keys(context.confirmedFacts).length
        : 0
      if (factCount < rule.min_evidence_count) {
        return {
          policyName,
          result: 'hint',
          reason: `Insufficient evidence: have ${factCount}, need ${rule.min_evidence_count}`,
        }
      }
    }

    // ── LLM-based evaluation (replaces deny_keywords / allow_keywords) ──
    if (rule.evaluationPrompt && context.skillOutput) {
      try {
        const result = await this.runLlmEvaluation(rule.evaluationPrompt, policyName, context)
        return { ...result, modelUsed: this.policyModel }
      } catch (err) {
        console.warn(`[PolicyEngine] LLM evaluation failed for "${policyName}", flagging as hint:`, err)
        return { policyName, result: 'hint', reason: 'Policy evaluation unavailable — flagged for human awareness', modelUsed: this.policyModel }
      }
    }

    return { policyName: '', result: 'pass' }
  }

  private async runLlmEvaluation(
    evaluationPrompt: string,
    policyName: string,
    context: PolicyContext,
  ): Promise<PolicyCheckResult> {
    const facts = context.confirmedFacts
      ? JSON.stringify(context.confirmedFacts)
      : 'none'
    const output = JSON.stringify(context.skillOutput)

    const systemPrompt = [
      'You are a policy evaluation engine. Your job is to check whether an agent action violates a policy rule.',
      'Call the evaluate_policy tool with your decision.',
      '',
      'Guidelines:',
      '- "pass" — the action complies with the policy',
      '- "blocked" — the action violates the policy and must be stopped',
      '- "hint" — potential issue, flag for monitoring but do not block',
      '- "escalated" — conflict detected, requires human intervention',
    ].join('\n')

    const userPrompt = [
      `Policy: ${policyName}`,
      `Evaluation instruction: ${evaluationPrompt}`,
      '',
      `Confirmed facts: ${facts}`,
      `Skill output: ${output}`,
    ].join('\n')

    // Native tool_use: model MUST call evaluate_policy with structured input.
    // The API protocol guarantees valid JSON — no regex extraction needed.
    const policyTool: Anthropic.Tool = {
      name: 'evaluate_policy',
      description: 'Record the policy evaluation decision.',
      input_schema: {
        type: 'object' as const,
        properties: {
          result: { type: 'string' as const, enum: ['pass', 'blocked', 'hint', 'escalated'], description: 'The evaluation result' },
          reason: { type: 'string' as const, description: 'Brief explanation of the decision' },
        },
        required: ['result', 'reason'],
      },
    }

    const msg = await this.llmClient.messages.create({
      model: this.policyModel,
      max_tokens: 128,
      temperature: 0,
      system: systemPrompt,
      tools: [policyTool as any],
      messages: [{ role: 'user', content: userPrompt }],
    })

    // Read tool_use block first (native path, guaranteed valid JSON)
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const input = (block as any).input as Record<string, unknown> | undefined
        if (input) {
          const validResults = new Set<PolicyResult>(['pass', 'blocked', 'hint', 'escalated'])
          return {
            policyName,
            result: validResults.has(input.result as PolicyResult) ? (input.result as PolicyResult) : 'pass',
            reason: (input.reason as string) || 'LLM evaluation complete',
          }
        }
      }
    }

    // Fallback: text response (provider doesn't support tool_use)
    const text = (msg.content[0] as any)?.text || ''
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const validResults = new Set<PolicyResult>(['pass', 'blocked', 'hint', 'escalated'])
        return {
          policyName,
          result: validResults.has(parsed.result) ? parsed.result : 'pass',
          reason: parsed.reason || 'LLM evaluation complete',
        }
      }
    } catch {
      // fall through
    }

    return { policyName, result: 'pass', reason: 'LLM evaluation could not parse result' }
  }

  /** Programmatically update hook bindings (used by Admin console). */
  setHooks(hook: PolicyHook, policyNames: string[]): void {
    this.hooks[hook] = policyNames
  }

  /** Register or update a policy rule (used by Admin console). */
  setPolicy(name: string, rule: PolicyRule): void {
    this.policies.set(name, rule)
  }

  // Stage-loaded guardrail tracking — for cleanup on stage transition
  private stageLoadedPolicyNames: string[] = []

  /** Load stage-specific guardrails on top of global policies. */
  loadStageGuardrails(guardrails: StageGuardrail[]): void {
    for (const g of guardrails) {
      const stagePolicyName = `stage:${g.name}`
      this.policies.set(stagePolicyName, g.rule)
      if (!this.hooks[g.hook].includes(stagePolicyName)) {
        this.hooks[g.hook].push(stagePolicyName)
      }
      this.stageLoadedPolicyNames.push(stagePolicyName)
    }
  }

  /** Remove previously loaded stage-specific guardrails. */
  clearStageGuardrails(): void {
    for (const name of this.stageLoadedPolicyNames) {
      this.policies.delete(name)
      for (const hook of ['preTool', 'postTool', 'preFinalize'] as PolicyHook[]) {
        this.hooks[hook] = this.hooks[hook].filter((n) => n !== name)
      }
    }
    this.stageLoadedPolicyNames = []
  }
}
