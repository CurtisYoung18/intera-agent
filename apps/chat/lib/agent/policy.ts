// Intera Harness - Policy Engine
// Guardrail policies evaluated at preTool, postTool, and preFinalize checkpoints.
// Policies load from DB (overlay on built-in seed) and hooks are driven by AgentConfig.policyHooks.

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
}

export class PolicyEngine {
  private policies: Map<string, PolicyRule> = new Map()
  private hooks: Record<PolicyHook, string[]> = {
    preTool: [],
    postTool: [],
    preFinalize: [],
  }

  constructor(private customerId: string, policyHooks?: PolicyHooks) {
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
      deny_keywords: ['not received', '未到账', '没到账', '没收到', 'not credited', 'missing', '未入金'],
    })

    this.policies.set('evidence_required_before_resolution', {
      require_skills: ['query_order_status'],
    })

    this.policies.set('no_compensation_promise', {
      deny_keywords: ['赔偿', '退款', '补偿', 'compensate', 'refund'],
    })

    this.policies.set('must_cite_basis', {
      allow_keywords: ['basis'],
    })

    this.hooks.preTool = ['no_high_risk_account_change']
    this.hooks.postTool = ['conflict_requires_human']
    this.hooks.preFinalize = [
      'evidence_required_before_resolution',
      'no_compensation_promise',
      'must_cite_basis',
    ]
  }

  async check(
    hook: PolicyHook,
    context: PolicyContext,
  ): Promise<PolicyCheckResult> {
    const policyNames = this.hooks[hook]

    for (const policyName of policyNames) {
      const rule = this.policies.get(policyName)
      if (!rule) continue

      const result = this.evaluateRule(rule, policyName, context)
      if (result.result !== 'pass') {
        return result
      }
    }

    return { policyName: '', result: 'pass' }
  }

  private evaluateRule(
    rule: PolicyRule,
    policyName: string,
    context: PolicyContext,
  ): PolicyCheckResult {
    // ── deny_skills (preTool) ──
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

    // ── require_skills (preFinalize): verify required skills were actually called ──
    if (rule.require_skills && context.skillName === 'finalize_case') {
      const called = context.skillsCalled || []
      const missing = rule.require_skills.filter((s) => !called.includes(s))
      if (missing.length > 0) {
        return {
          policyName,
          result: 'blocked',
          reason: `Required skills not called before finalize: ${missing.join(', ')}`,
        }
      }
    }

    // ── deny_keywords in skill output (postTool / preFinalize) ──
    if (rule.deny_keywords && context.skillOutput) {
      const outputStr = JSON.stringify(context.skillOutput)
      for (const keyword of rule.deny_keywords) {
        if (outputStr.includes(keyword)) {
          // Special case: conflict_requires_human — does not block, escalates instead
          if (policyName === 'conflict_requires_human') {
            // Escalate when: user reported "not received" AND system/tool says "success"
            const userReportedNotReceived = context.confirmedFacts?.userReportedNotReceived === true
            const systemReportsSuccess = outputStr.includes('success') || outputStr.includes('ok')
            if (userReportedNotReceived && systemReportsSuccess) {
              return {
                policyName,
                result: 'escalated',
                reason: `Conflict detected: system reports success but user reports issue. Escalation required.`,
              }
            }
            if (userReportedNotReceived) {
              return { policyName, result: 'hint', reason: `User reported issue — monitor system result` }
            }
            return { policyName, result: 'hint', reason: `Potential conflict keyword detected: "${keyword}"` }
          }

          return {
            policyName,
            result: 'blocked',
            reason: `Output contains forbidden keyword: "${keyword}"`,
          }
        }
      }
    }

    // ── allow_keywords (preFinalize): require specific content in output ──
    if (rule.allow_keywords && context.skillName === 'finalize_case' && context.skillOutput) {
      const outputStr = JSON.stringify(context.skillOutput)
      const missing = rule.allow_keywords.filter((kw) => !outputStr.includes(kw))
      if (missing.length > 0) {
        return {
          policyName,
          result: 'blocked',
          reason: `Finalize output missing required content: ${missing.join(', ')}`,
        }
      }
    }

    // ── min_evidence_count ──
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

    return { policyName: '', result: 'pass' }
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
