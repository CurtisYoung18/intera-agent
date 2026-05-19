// Intera Harness - Policy Engine
// Guardrail policies evaluated at preTool, postTool, and preFinalize checkpoints.
// Policies load from DB (overlay on built-in seed) and hooks are driven by AgentConfig.policyHooks.
// All evaluationPrompt policies at a checkpoint are batched into a single LLM call.
// Non-pass results are fed back to the agent as [POLICY] messages in the conversation stream.

import Anthropic from '@anthropic-ai/sdk'
import type {
  PolicyHook,
  PolicyResult,
  PolicyRule,
  PolicyHooks,
  PolicyCheckResult,
  PolicyEvaluationResult,
  StageGuardrail,
} from '@intera/shared/types'

export interface PolicyContext {
  skillName?: string
  skillInput?: Record<string, unknown>
  skillOutput?: unknown
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  /** Skill names executed this iteration (postTool filtering). */
  executedSkills?: string[]
  /** Full skill results including sub-agent outputs (for investigate_before_escalation check). */
  skillResults?: Record<string, unknown>
}

// PolicyCheckResult and PolicyEvaluationResult are now in @intera/shared/types

/** Severity ordering for computing the aggregate summary. */
const SEVERITY: Record<PolicyResult, number> = {
  pass: 0,
  hint: 1,
  blocked: 2,
  escalated: 3,
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
      if (policyHooks.preTool !== undefined) this.hooks.preTool = policyHooks.preTool
      if (policyHooks.postTool !== undefined) this.hooks.postTool = policyHooks.postTool
      if (policyHooks.preFinalize !== undefined) this.hooks.preFinalize = policyHooks.preFinalize
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

  // ── Built-in policies ─────────────────────────────────────────────────

  private loadBuiltInPolicies(): void {
    this.policies.set('no_high_risk_account_change', {
      deny_skills: ['refund_money', 'change_ban_status', 'delete_account'],
    })

    this.policies.set('conflict_requires_human', {
      hook_skills: ['query_order_status', 'query_payment_channel_status', 'get_account_status', 'get_kyc_status'],
      evaluationPrompt: [
        'Check whether the skill outputs contradict what the customer reported.',
        '',
        'Skill output: {{skill_output}}',
        'Confirmed facts: {{confirmed_facts}}',
        '',
        'Escalate to human (result=escalated) when system data contradicts the customer report — for example:',
        '(1) system shows completed/successful but customer says not received / missing funds',
        '(2) system shows account normal but customer reports access issues',
        '(3) system shows payment channel normal but customer says payment failed',
        '',
        'If outputs align with the customer issue, return "pass".',
        'If data is ambiguous or incomplete (e.g. status="pending"), return "hint".',
      ].join('\n'),
    })

    this.policies.set('evidence_required_before_resolution', {
      require_skills_any: ['query_order_status', 'get_account_status', 'get_kyc_status'],
    })

    this.policies.set('no_compensation_promise', {
      evaluationPrompt: [
        'Check whether the finalize conclusion promises or commits to any monetary compensation.',
        '',
        'Finalize output: {{skill_output}}',
        'Confirmed facts: {{confirmed_facts}}',
        '',
        'Block (result=blocked) if the agent promises refund, cash reimbursement, voucher with cash value, or direct financial remedy — only human operators may authorize compensation.',
        'Pass if the conclusion explains findings, policy, or next steps without committing to pay the customer.',
        'Also pass if the agent only relays what a human operator already approved.',
      ].join('\n'),
    })

    this.policies.set('must_cite_basis', {
      evaluationPrompt: [
        'Check whether the finalize conclusion references specific evidence gathered during case investigation.',
        '',
        'Finalize output: {{skill_output}}',
        'Confirmed facts: {{confirmed_facts}}',
        'Skills called: {{skills_called}}',
        '',
        'The conclusion must cite at least one of: (1) a specific skill result, (2) confirmed facts, (3) a policy reference.',
        'Block (result=blocked) if the conclusion makes claims without any factual grounding.',
        'Pass if evidence is properly cited and the reasoning is traceable to collected facts.',
      ].join('\n'),
    })

    this.policies.set('investigate_before_escalation', {
      hook_skills: ['create_human_task'],
      require_skills_any: ['query_order_status', 'query_payment_channel_status', 'get_account_status', 'get_kyc_status'],
    })

    this.hooks.preTool = ['no_high_risk_account_change', 'investigate_before_escalation']
    this.hooks.postTool = ['conflict_requires_human']
    this.hooks.preFinalize = [
      'evidence_required_before_resolution',
      'no_compensation_promise',
      'must_cite_basis',
    ]
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Evaluate all policies for a checkpoint.
   * Exact-match policies run synchronously. evaluationPrompt policies are
   * batched into a single LLM call. Returns aggregate result with feedback
   * message ready for injection into the agent's conversation.
   */
  async evaluate(
    hook: PolicyHook,
    context: PolicyContext,
    hitCounts?: Map<string, number>,
  ): Promise<PolicyEvaluationResult> {
    const policyNames = this.hooks[hook]
    if (policyNames.length === 0) {
      return { hook, results: [], summary: 'pass' }
    }

    const results: PolicyCheckResult[] = []

    // Phase 1: Exact-match rules (synchronous, fast)
    for (const policyName of policyNames) {
      const rule = this.policies.get(policyName)
      if (!rule) continue

      const exactResult = this.checkExactMatch(rule, policyName, context)
      if (exactResult) {
        results.push(exactResult)
        // Blocking exact match — return immediately, don't bother with LLM
        if (exactResult.result === 'blocked') {
          return this.buildResult(hook, results, hitCounts)
        }
      }
    }

    // Phase 2: LLM-based policies (batched into single API call)
    const llmPolicies: Array<{ name: string; prompt: string }> = []
    for (const policyName of policyNames) {
      const rule = this.policies.get(policyName)
      if (!rule?.evaluationPrompt) continue
      // enableLlm: false → skip LLM evaluation entirely
      if (rule.enableLlm === false) continue
      // Skip if context has no skillOutput (nothing to evaluate)
      if (!context.skillOutput) continue

      // hook_skills filtering (postTool only): skip if no executed skill matches
      if (hook === 'postTool' && rule.hook_skills && rule.hook_skills.length > 0) {
        const executed = context.executedSkills || []
        const matched = rule.hook_skills.some((s) => executed.includes(s))
        if (!matched) {
          console.warn(`[PolicyEngine] Skipping "${policyName}" — executed skills [${executed.join(', ')}] do not match hook_skills [${rule.hook_skills.join(', ')}]`)
          continue
        }
      }

      const resolved = this.resolvePlaceholders(rule.evaluationPrompt, context, policyName)
      llmPolicies.push({ name: policyName, prompt: resolved })
    }

    if (llmPolicies.length > 0) {
      try {
        const batchResults = await this.evaluateBatch(llmPolicies)
        results.push(...batchResults)
      } catch (err) {
        console.warn('[PolicyEngine] Batch LLM evaluation failed:', err)
        for (const p of llmPolicies) {
          results.push({
            policyName: p.name,
            result: 'hint',
            reason: 'Policy evaluation unavailable — flagged for human awareness',
            modelUsed: this.policyModel,
          })
        }
      }
    }

    return this.buildResult(hook, results, hitCounts)
  }

  // ── Exact-match checks (no LLM) ──────────────────────────────────────

  private checkExactMatch(
    rule: PolicyRule,
    policyName: string,
    context: PolicyContext,
  ): PolicyCheckResult | null {
    // hook_skills gate (Phase 1 defense-in-depth): if a policy declares hook_skills
    // and the current tool is NOT in that list, skip the policy entirely.
    // This prevents noisy [POLICY] hints from firing on irrelevant tools.
    if (rule.hook_skills && rule.hook_skills.length > 0 && context.skillName) {
      if (!rule.hook_skills.includes(context.skillName)) {
        return null
      }
    }

    // deny_skills — block specific skills by name
    if (rule.deny_skills && context.skillName && rule.deny_skills.includes(context.skillName)) {
      return {
        policyName,
        result: 'blocked',
        reason: `Skill "${context.skillName}" is denied`,
      }
    }

    // require_skills — all listed skills must have been called.
    // Gated by hook_skills (if set) or applies to terminal tools by default.
    if (rule.require_skills) {
      const isGated = !rule.hook_skills || rule.hook_skills.length === 0 ||
        (context.skillName && rule.hook_skills.includes(context.skillName))
      if (isGated) {
        const called = context.skillsCalled || []
        const missing = rule.require_skills.filter((s) => !called.includes(s))
        if (missing.length > 0) {
          return {
            policyName,
            result: 'blocked',
            reason: `Required skills not called: ${missing.join(', ')}`,
          }
        }
      }
    }

    // require_skills_any — at least one must have been called (by main agent OR sub-agent).
    // Gated by hook_skills (if set) or applies to terminal tools by default.
    if (rule.require_skills_any && rule.require_skills_any.length > 0) {
      const isGated = !rule.hook_skills || rule.hook_skills.length === 0 ||
        (context.skillName && rule.hook_skills.includes(context.skillName))
      if (isGated) {
      const called = context.skillsCalled || []
      let ok = rule.require_skills_any.some((s) => called.includes(s))

      // Also check sub-agent evidence — sub-agents may have called the required
      // skills even though the main agent hasn't yet.
      if (!ok && context.skillResults) {
        ok = rule.require_skills_any.some((requiredSkill) => {
          for (const [key, value] of Object.entries(context.skillResults!)) {
            if (key.startsWith('subagent:') && value && typeof value === 'object') {
              const evidence = (value as any).evidence as Array<{ source: string }> | undefined
              if (evidence?.some((e) => e.source === requiredSkill)) {
                return true
              }
            }
          }
          return false
        })
      }

      if (!ok) {
        return {
          policyName,
          result: 'blocked',
          reason: `Must call at least one of: ${rule.require_skills_any.join(', ')} before ${context.skillName}`,
        }
      }
      } // close isGated
    }

    return null
  }

  // ── Batch LLM evaluation ─────────────────────────────────────────────

  /**
   * Evaluate multiple evaluationPrompt policies in a single LLM call.
   * The model calls evaluate_policy tool once per policy.
   */
  private async evaluateBatch(
    policies: Array<{ name: string; prompt: string }>,
  ): Promise<PolicyCheckResult[]> {
    const systemPrompt = [
      'You are a policy evaluation engine. Your job is to check whether an agent action violates policy rules.',
      'For each policy below, call the evaluate_policy tool once with your decision.',
      '',
      'Guidelines:',
      '- "pass" — the action complies with the policy',
      '- "blocked" — the action violates the policy and must be stopped',
      '- "hint" — potential issue, flag for monitoring but do not block',
      '- "escalated" — conflict detected, requires human intervention',
    ].join('\n')

    const userPrompt = policies
      .map((p, i) => `## Policy ${i + 1}: ${p.name}\n\n${p.prompt}`)
      .join('\n\n---\n\n')

    const policyTool: Anthropic.Tool = {
      name: 'evaluate_policy',
      description: 'Record a policy evaluation decision. Call once per policy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          policyName: { type: 'string' as const, description: 'The policy name being evaluated' },
          result: { type: 'string' as const, enum: ['pass', 'blocked', 'hint', 'escalated'], description: 'The evaluation result' },
          reason: { type: 'string' as const, description: 'Brief explanation of the decision' },
        },
        required: ['policyName', 'result', 'reason'],
      },
    }

    const msg = await this.llmClient.messages.create({
      model: this.policyModel,
      max_tokens: 512,
      temperature: 0,
      system: systemPrompt,
      tools: [policyTool as any],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const results: PolicyCheckResult[] = []
    const seen = new Set<string>()
    const validResults = new Set<PolicyResult>(['pass', 'blocked', 'hint', 'escalated'])

    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const input = (block as any).input as Record<string, unknown> | undefined
        if (input?.policyName && !seen.has(input.policyName as string)) {
          seen.add(input.policyName as string)
          results.push({
            policyName: input.policyName as string,
            result: validResults.has(input.result as PolicyResult) ? (input.result as PolicyResult) : 'pass',
            reason: (input.reason as string) || undefined,
            modelUsed: this.policyModel,
          })
        }
      }
    }

    // If model didn't use tool_use, try text fallback
    if (results.length === 0) {
      const text = (msg.content[0] as any)?.text || ''
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          const pr = validResults.has(parsed.result) ? parsed.result : 'pass'
          // Attribute to the first policy; any other policies in the batch
          // get 'hint' since we can't distinguish their results from text.
          results.push({
            policyName: policies[0]?.name || 'unknown',
            result: pr as PolicyResult,
            reason: parsed.reason || undefined,
            modelUsed: this.policyModel,
          })
          for (let i = 1; i < policies.length; i++) {
            results.push({
              policyName: policies[i].name,
              result: 'hint',
              reason: 'Policy evaluation unavailable — text fallback could not distinguish batch results',
              modelUsed: this.policyModel,
            })
          }
        }
      } catch { /* fall through */ }
    }

    // Any policy not evaluated by the model defaults to pass
    for (const p of policies) {
      if (!seen.has(p.name)) {
        results.push({ policyName: p.name, result: 'pass', modelUsed: this.policyModel })
      }
    }

    return results
  }

  // ── Placeholder resolution ───────────────────────────────────────────

  private resolvePlaceholders(template: string, context: PolicyContext, policyName: string): string {
    const facts = context.confirmedFacts
      ? JSON.stringify(context.confirmedFacts)
      : 'none'
    const output = context.skillOutput
      ? JSON.stringify(context.skillOutput)
      : 'none'
    const skillsCalled = context.skillsCalled
      ? JSON.stringify(context.skillsCalled)
      : '[]'

    return template
      .replace(/\{\{skill_name\}\}/g, policyName)
      .replace(/\{\{skill_output\}\}/g, output)
      .replace(/\{\{confirmed_facts\}\}/g, facts)
      .replace(/\{\{skills_called\}\}/g, skillsCalled)
  }

  // ── Result aggregation & feedback ────────────────────────────────────

  private buildResult(
    hook: PolicyHook,
    results: PolicyCheckResult[],
    hitCounts?: Map<string, number>,
  ): PolicyEvaluationResult {
    const summary = results.reduce(
      (worst, r) => (SEVERITY[r.result] > SEVERITY[worst] ? r.result : worst),
      'pass' as PolicyResult,
    )

    const feedbackMessage = this.buildFeedbackMessage(hook, results, summary, hitCounts)

    return { hook, results, summary, feedbackMessage }
  }

  private buildFeedbackMessage(
    hook: PolicyHook,
    results: PolicyCheckResult[],
    _summary: PolicyResult,
    hitCounts?: Map<string, number>,
  ): string | undefined {
    const nonPass = results.filter((r) => r.result !== 'pass')
    if (nonPass.length === 0) return undefined

    const lines: string[] = ['[POLICY]']

    for (const r of nonPass) {
      const count = hitCounts?.get(r.policyName) || 0
      const escalationNote = count >= 2 ? ` (violation #${count})` : ''
      lines.push(`"${r.policyName}": ${r.result}${escalationNote}${r.reason ? ` — ${r.reason}` : ''}`)
    }

    // Guidance based on hook and result type
    const escalated = nonPass.some((r) => r.result === 'escalated')
    const blocked = nonPass.some((r) => r.result === 'blocked')

    if (hook === 'preTool' && blocked) {
      lines.push('→ This tool was NOT executed. Do not attempt to call it again.')
      lines.push('→ Instead: explain the limitation to the customer, or call create_human_task to escalate.')
    } else if (hook === 'postTool' && escalated) {
      lines.push('→ Data contradiction detected. This case will be escalated to a human operator.')
    } else if (hook === 'postTool' && blocked) {
      lines.push('→ Your output violated policy. Adjust your approach in the next turn.')
    } else if (hook === 'preFinalize' && blocked) {
      lines.push('→ Finalization was REJECTED. Address the issues above and call finalize_case again.')
    }

    // Graduated escalation warning (aligns with stage executor nudge pattern)
    if (blocked || escalated) {
      const maxCount = Math.max(...nonPass.map((r) => hitCounts?.get(r.policyName) || 0), 0)
      if (maxCount >= 2) {
        lines.push(`→ WARNING: This policy has been violated ${maxCount} times. Further violations will escalate.`)
      }
    }

    return lines.join('\n')
  }

  // ── Configuration API ─────────────────────────────────────────────────

  /** Returns all registered policy names (used for graduated escalation tracking). */
  getPolicyNames(): string[] {
    return [...this.policies.keys()]
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
