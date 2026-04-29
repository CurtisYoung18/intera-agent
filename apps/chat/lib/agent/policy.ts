// Intera Harness - Policy Engine
// Based on architecture doc: Policy / Guardrail system
//
// [MOCK] Hardcoded built-in policies. Production path:
//   - Load policies from Policy table (Prisma) for the active Customer
//   - Policies are configured via Admin console per hook point

import type { PolicyHook, PolicyResult, PolicyRule } from '@intera/shared/types'

export interface PolicyContext {
  skillName?: string
  skillInput?: Record<string, unknown>
  skillOutput?: unknown
  confirmedFacts?: Record<string, unknown>
}

export interface PolicyCheckResult {
  policyName: string
  result: PolicyResult
  reason?: string
}

/**
 * Policy Engine — evaluates guardrail policies at preTool, postTool,
 * and preFinalize checkpoints.
 */
export class PolicyEngine {
  private policies: Map<string, PolicyRule> = new Map()
  private hooks: Record<PolicyHook, string[]> = {
    preTool: [],
    postTool: [],
    preFinalize: [],
  }

  constructor(private customerId: string) {
    // [MOCK] Built-in policies. Production loads from DB:
    //   const rows = await prisma.policy.findMany({ where: { customerId, enabled: true } })
    this.loadBuiltInPolicies()
  }

  private loadBuiltInPolicies(): void {
    // Block high-risk skills in preTool phase
    this.policies.set('no_high_risk_account_change', {
      deny_skills: ['refund_money', 'change_ban_status', 'delete_account'],
    })

    // Detect conflict between system result and user report
    this.policies.set('conflict_requires_human', {})

    // Require evidence gathering before resolution
    this.policies.set('evidence_required_before_resolution', {
      require_skills: ['query_order_status'],
    })

    // Forbid compensation/refund promises in finalize output
    this.policies.set('no_compensation_promise', {
      deny_keywords: ['赔偿', '退款', '补偿', 'compensate', 'refund'],
    })

    // Require evidence citations in conclusions
    this.policies.set('must_cite_basis', {})

    // Wire hooks (in production, this comes from AgentConfig.policyHooks)
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
    // Check deny_skills (preTool)
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

    // Check deny_keywords in skill output (postTool / preFinalize)
    if (rule.deny_keywords && context.skillOutput) {
      const outputStr = JSON.stringify(context.skillOutput)
      for (const keyword of rule.deny_keywords) {
        if (outputStr.includes(keyword)) {
          return {
            policyName,
            result: 'blocked',
            reason: `Output contains forbidden keyword: "${keyword}"`,
          }
        }
      }
    }

    // Check require_skills (preFinalize)
    if (rule.require_skills && context.skillName === 'finalize_case') {
      // Production: verify required skills were actually called during this case
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
}
