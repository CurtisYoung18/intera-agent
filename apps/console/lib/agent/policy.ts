// Intera Harness - Policy Engine (G11 Phase 1 — GuardrailHook primitive)
//
// Guardrail hooks are evaluated at preTool, postTool, and preFinalize checkpoints.
// Hooks load from DB (guardrailConfig JSON), scoped to agentConfigId.
//
// SAFETY FLOOR (platform-owned, NOT configurable):
//   - Hooks on high-risk skills {refund_money, change_ban_status, delete_account}
//     CANNOT have onUnavailable:'open' — coerced to invoke_tool(create_human_task).
//   - invoke_tool may target ONLY the safe-tool allowlist {create_human_task, request_user_input}.
//   - Every hook resolution writes an AuditLog row (F6).
//
// FIXES:
//   F1 — preTool input-based eval: resolve {{skill_input}}/{{skill_name}} at preTool
//        (skillOutput is absent by definition); stop silently skipping ai checks at preTool.
//   F2 — Fail-closed: on ai check failure, follow onUnavailable instead of silent pass.
//   F6 — Audit: every hook resolution → AuditLog.

import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_MEMORY_MODEL } from '@intera/shared/memory/contract'
import { createAgentClient } from './api/provider-config'
import type {
  PolicyHook,
  PolicyResult,
  PolicyCheckResult,
  PolicyEvaluationResult,
  PendingGuardrailToolCall,
  GuardrailHook,
  GuardrailCheckpoint,
} from '@intera/shared/types'
import { withRetry, CannotRetryError } from './api/with-retry'
import { writeAudit } from '@/lib/audit'

// ── Platform-owned safety constants (§7.6) ────────────────────────────────

const HIGH_RISK_SKILLS = new Set(['refund_money', 'change_ban_status', 'delete_account'])
const SAFE_TOOL_ALLOWLIST = new Set(['create_human_task', 'request_user_input'])
const DEFAULT_FALLBACK_TOOL = 'create_human_task'

// ── Public interfaces ─────────────────────────────────────────────────────

export interface PolicyContext {
  skillName?: string
  skillInput?: Record<string, unknown>
  skillOutput?: unknown
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  executedSkills?: string[]
  skillResults?: Record<string, unknown>
}

const SEVERITY: Record<PolicyResult, number> = {
  pass: 0, hint: 1, blocked: 2, escalated: 3,
}

// ── Validation ────────────────────────────────────────────────────────────

export function validateGuardrailHook(hook: GuardrailHook): string[] {
  const errors: string[] = []

  if (hook.onViolation.action === 'invoke_tool') {
    const tool = hook.onViolation.tool
    if (!tool || !SAFE_TOOL_ALLOWLIST.has(tool)) {
      errors.push(`onViolation.invoke_tool target "${tool || '(none)'}" is not in the safe-tool allowlist: ${[...SAFE_TOOL_ALLOWLIST].join(', ')}`)
    }
  }

  if (hook.onUnavailable.action === 'invoke_tool') {
    const tool = hook.onUnavailable.tool
    if (!tool || !SAFE_TOOL_ALLOWLIST.has(tool)) {
      errors.push(`onUnavailable.invoke_tool target "${tool || '(none)'}" is not in the safe-tool allowlist: ${[...SAFE_TOOL_ALLOWLIST].join(', ')}`)
    }
  }

  const hasHighRiskSkill = hook.match.skills.some((s) => HIGH_RISK_SKILLS.has(s))
  if (hasHighRiskSkill && hook.onUnavailable.action === 'open') {
    errors.push(`onUnavailable cannot be 'open' for hooks on high-risk skills (${hook.match.skills.filter((s) => HIGH_RISK_SKILLS.has(s)).join(', ')}). Use 'closed' or 'invoke_tool'.`)
  }

  return errors
}

// ── Engine ────────────────────────────────────────────────────────────────

export class PolicyEngine {
  private hooks: GuardrailHook[] = []
  private policyModel: string
  private llmClient: Anthropic
  private agentConfigId: string

  constructor(agentConfigId: string) {
    this.agentConfigId = agentConfigId
    this.policyModel = process.env.POLICY_EVAL_MODEL || DEFAULT_MEMORY_MODEL
    this.llmClient = createAgentClient(this.policyModel)
  }

  static async create(agentConfigId: string): Promise<PolicyEngine> {
    const engine = new PolicyEngine(agentConfigId)

    try {
      const { prisma } = await import('@intera/shared/prisma')
      const dbPolicies = await prisma.policy.findMany({ where: { agentConfigId, enabled: true } })

      for (const p of dbPolicies) {
        if (p.guardrailConfig) {
          try {
            const hook: GuardrailHook = JSON.parse(p.guardrailConfig)
            const errors = validateGuardrailHook(hook)
            if (errors.length > 0) {
              console.warn(`[PolicyEngine] Hook "${p.name}" has config errors:`, errors)
            }
            (hook as any).__name = p.name
            engine.hooks.push(hook)
          } catch (err) {
            console.warn(`[PolicyEngine] Failed to parse guardrailConfig for "${p.name}":`, err)
          }
        }
      }
    } catch (err) {
      console.warn('[PolicyEngine] Failed to load policies from DB:', err)
    }

    return engine
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async evaluate(
    hook: PolicyHook,
    context: PolicyContext,
    hitCounts?: Map<string, number>,
  ): Promise<PolicyEvaluationResult> {
    const checkpoint = hook as GuardrailCheckpoint
    const checkpointHooks = this.hooks.filter((h) => h.when === checkpoint)

    if (checkpointHooks.length === 0) {
      return { hook, results: [], summary: 'pass' }
    }

    const results: PolicyCheckResult[] = []
    const pendingToolCalls: PendingGuardrailToolCall[] = []

    // Phase 1: Rule-based hooks
    for (const gh of checkpointHooks) {
      const hookName = (gh as any).__name || 'unnamed'
      if (!this.matchesContext(gh, context, checkpoint)) continue

      if (gh.check.kind === 'rule') {
        const ruleResult = this.checkRule(gh, context, hookName)
        if (ruleResult) {
          results.push(ruleResult)
          const outcome = this.resolveOutcome(gh, ruleResult, hookName)
          if (outcome.pendingToolCall) pendingToolCalls.push(outcome.pendingToolCall)
          this.auditResolution(hookName, gh, ruleResult, checkpoint)
          if (ruleResult.result === 'blocked') {
            return this.buildResult(hook, results, pendingToolCalls, hitCounts)
          }
        }
      }
    }

    // Phase 2: AI-based hooks
    const aiHooks: Array<{ name: string; hook: GuardrailHook; prompt: string }> = []
    for (const gh of checkpointHooks) {
      const hookName = (gh as any).__name || 'unnamed'
      if (gh.check.kind !== 'ai') continue
      if (!gh.check.evaluationPrompt) continue
      if (!this.matchesContext(gh, context, checkpoint)) continue

      const resolved = this.resolvePlaceholders(gh.check.evaluationPrompt, context, checkpoint)
      aiHooks.push({ name: hookName, hook: gh, prompt: resolved })
    }

    if (aiHooks.length > 0) {
      try {
        const batchResults = await this.evaluateBatch(aiHooks.map((h) => ({ name: h.name, prompt: h.prompt })))
        for (let i = 0; i < batchResults.length; i++) {
          const br = batchResults[i]
          const ah = aiHooks[i]
          results.push(br)
          const outcome = this.resolveOutcome(ah.hook, br, ah.name)
          if (outcome.pendingToolCall) pendingToolCalls.push(outcome.pendingToolCall)
          this.auditResolution(ah.name, ah.hook, br, checkpoint)
        }
      } catch (err) {
        // F2 FIX: follow each hook's onUnavailable instead of silent pass
        for (const ah of aiHooks) {
          const unavailableResult = this.resolveUnavailable(ah.hook, ah.name, err)
          results.push(unavailableResult)
          this.auditResolution(ah.name, ah.hook, unavailableResult, checkpoint)
          if (unavailableResult.result === 'escalated') {
            const tool = this.getUnavailableTool(ah.hook)
            if (tool) {
              pendingToolCalls.push({ tool, reason: `Guardrail "${ah.name}" evaluation unavailable: ${unavailableResult.reason}`, hookName: ah.name })
            }
          }
        }
      }
    }

    return this.buildResult(hook, results, pendingToolCalls, hitCounts)
  }

  // ── Context matching ────────────────────────────────────────────────────

  private matchesContext(gh: GuardrailHook, context: PolicyContext, checkpoint: GuardrailCheckpoint): boolean {
    if (gh.match.skills.length > 0) {
      if (!context.skillName) return false
      if (!gh.match.skills.includes(context.skillName)) return false
    }
    if (gh.match.ifPattern) {
      const payload = checkpoint === 'preTool'
        ? JSON.stringify(context.skillInput ?? {})
        : JSON.stringify(context.skillOutput ?? {})
      try {
        if (!new RegExp(gh.match.ifPattern, 'i').test(payload)) return false
      } catch { /* invalid regex — skip filter */ }
    }
    return true
  }

  // ── Rule evaluation ─────────────────────────────────────────────────────

  private checkRule(gh: GuardrailHook, context: PolicyContext, hookName: string): PolicyCheckResult | null {
    const ch = gh.check

    if (ch.denySkills && context.skillName && ch.denySkills.includes(context.skillName)) {
      return { policyName: hookName, result: 'blocked', reason: `Skill "${context.skillName}" is denied by policy` }
    }

    if (ch.requireSkills && ch.requireSkills.length > 0) {
      const called = context.skillsCalled || []
      const missing = ch.requireSkills.filter((s) => !called.includes(s))
      if (missing.length > 0) {
        return { policyName: hookName, result: 'blocked', reason: `Required skills not called: ${missing.join(', ')}` }
      }
    }

    if (ch.requireSkillsAny && ch.requireSkillsAny.length > 0) {
      const called = context.skillsCalled || []
      let ok = ch.requireSkillsAny.some((s) => called.includes(s))
      if (!ok && context.skillResults) {
        ok = ch.requireSkillsAny.some((requiredSkill) => {
          for (const [key, value] of Object.entries(context.skillResults!)) {
            if (key.startsWith('subagent:') && value && typeof value === 'object') {
              const evidence = (value as any).evidence as Array<{ source: string }> | undefined
              if (evidence?.some((e) => e.source === requiredSkill)) return true
            }
          }
          return false
        })
      }
      if (!ok) {
        return { policyName: hookName, result: 'blocked', reason: `Must call at least one of: ${ch.requireSkillsAny.join(', ')} before ${context.skillName || 'this action'}` }
      }
    }

    return null
  }

  // ── Outcome resolution ──────────────────────────────────────────────────

  private resolveOutcome(gh: GuardrailHook, result: PolicyCheckResult, hookName: string): { pendingToolCall?: PendingGuardrailToolCall } {
    if (result.result === 'pass' || result.result === 'hint') return {}
    if (gh.onViolation.action === 'invoke_tool') {
      const tool = this.safeToolTarget(gh.onViolation.tool)
      if (tool) {
        result.result = 'escalated'
        return { pendingToolCall: { tool, reason: `Guardrail "${hookName}" violated: ${result.reason}`, hookName } }
      }
    }
    if (gh.onViolation.action === 'block') result.result = 'blocked'
    return {}
  }

  private resolveUnavailable(gh: GuardrailHook, hookName: string, err: unknown): PolicyCheckResult {
    const hasHighRisk = gh.match.skills.some((s) => HIGH_RISK_SKILLS.has(s))
    let unavailableAction = gh.onUnavailable.action
    if (hasHighRisk && unavailableAction === 'open') {
      unavailableAction = 'invoke_tool'
      console.warn(`[PolicyEngine] SAFETY FLOOR: coercing onUnavailable:'open' → 'invoke_tool' for hook "${hookName}" on high-risk skill(s)`)
    }
    const errorClass = err instanceof CannotRetryError ? err.errorClass : 'unknown'
    switch (unavailableAction) {
      case 'closed':
        return { policyName: hookName, result: 'blocked', reason: `Policy evaluation unavailable — blocked for safety (${errorClass})` }
      case 'invoke_tool': {
        const tool = this.safeToolTarget(gh.onUnavailable.tool)
        return { policyName: hookName, result: 'escalated', reason: `Policy evaluation unavailable — escalating via ${tool || DEFAULT_FALLBACK_TOOL} (${errorClass})` }
      }
      case 'open':
      default:
        return { policyName: hookName, result: 'hint', reason: `Policy evaluation unavailable — allowed with warning (${errorClass})` }
    }
  }

  private safeToolTarget(tool?: string): string | null {
    if (tool && SAFE_TOOL_ALLOWLIST.has(tool)) return tool
    return DEFAULT_FALLBACK_TOOL
  }

  private getUnavailableTool(gh: GuardrailHook): string | null {
    const hasHighRisk = gh.match.skills.some((s) => HIGH_RISK_SKILLS.has(s))
    let action = gh.onUnavailable.action
    if (hasHighRisk && action === 'open') action = 'invoke_tool'
    if (action === 'invoke_tool') {
      return gh.onUnavailable.tool && SAFE_TOOL_ALLOWLIST.has(gh.onUnavailable.tool) ? gh.onUnavailable.tool : DEFAULT_FALLBACK_TOOL
    }
    return null
  }

  // ── Audit (F6) ──────────────────────────────────────────────────────────

  private auditResolution(hookName: string, _gh: GuardrailHook, result: PolicyCheckResult, checkpoint: string): void {
    const action = result.result === 'pass' ? 'guardrail.pass'
      : result.result === 'blocked' ? 'guardrail.block'
      : result.result === 'escalated' ? 'guardrail.escalate'
      : 'guardrail.hint'

    writeAudit({
      actorUserId: 'system', orgId: this.agentConfigId, action, target: `policy:${hookName}`,
      after: { checkpoint, result: result.result, reason: result.reason, modelUsed: result.modelUsed },
    }).catch((err) => { console.warn('[PolicyEngine] Audit write failed (non-fatal):', err) })
  }

  // ── Batch LLM evaluation ────────────────────────────────────────────────

  private async evaluateBatch(policies: Array<{ name: string; prompt: string }>): Promise<PolicyCheckResult[]> {
    const systemPrompt = [
      'You are a policy evaluation engine. Your job is to check whether an agent action violates policy rules.',
      'For each policy below, call the evaluate_policy tool once with your decision.',
      '', 'Guidelines:',
      '- "pass" — the action complies with the policy',
      '- "blocked" — the action violates the policy and must be stopped',
      '- "hint" — potential issue, flag for monitoring but do not block',
      '- "escalated" — conflict detected, requires human intervention',
    ].join('\n')

    const userPrompt = policies.map((p, i) => `## Policy ${i + 1}: ${p.name}\n\n${p.prompt}`).join('\n\n---\n\n')

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

    let msg: Anthropic.Messages.Message
    try {
      msg = await withRetry(
        (retryClient) => retryClient.messages.create({
          model: this.policyModel, max_tokens: 512, temperature: 0,
          system: systemPrompt, tools: [policyTool as any],
          messages: [{ role: 'user', content: userPrompt }],
        }),
        { querySource: 'policy_eval', model: this.policyModel },
        () => this.llmClient,
      )
    } catch (err) {
      throw err // propagate so evaluate() follows onUnavailable
    }

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
            reason: (input.reason as string) || undefined, modelUsed: this.policyModel,
          })
        }
      }
    }

    if (results.length === 0) {
      const text = (msg.content[0] as any)?.text || ''
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          const pr = validResults.has(parsed.result) ? parsed.result : 'pass'
          results.push({ policyName: policies[0]?.name || 'unknown', result: pr as PolicyResult, reason: parsed.reason || undefined, modelUsed: this.policyModel })
          for (let i = 1; i < policies.length; i++) {
            results.push({ policyName: policies[i].name, result: 'hint', reason: 'Policy evaluation unavailable — text fallback could not distinguish batch results', modelUsed: this.policyModel })
          }
        }
      } catch { /* fall through */ }
    }

    for (const p of policies) {
      if (!seen.has(p.name)) {
        results.push({ policyName: p.name, result: 'pass', modelUsed: this.policyModel })
      }
    }
    return results
  }

  // ── Placeholder resolution ──────────────────────────────────────────────

  private resolvePlaceholders(template: string, context: PolicyContext, checkpoint: GuardrailCheckpoint): string {
    const facts = context.confirmedFacts ? JSON.stringify(context.confirmedFacts) : 'none'
    const hasOutput = context.skillOutput !== undefined && context.skillOutput !== null
    const output = hasOutput ? JSON.stringify(context.skillOutput)
      : (checkpoint === 'preTool' && context.skillInput ? JSON.stringify(context.skillInput) : 'none')
    const skillsCalled = context.skillsCalled ? JSON.stringify(context.skillsCalled) : '[]'
    const skillName = context.skillName || 'unknown'

    return template
      .replace(/\{\{skill_name\}\}/g, skillName)
      .replace(/\{\{skill_output\}\}/g, output)
      .replace(/\{\{skill_input\}\}/g, context.skillInput ? JSON.stringify(context.skillInput) : 'none')
      .replace(/\{\{confirmed_facts\}\}/g, facts)
      .replace(/\{\{skills_called\}\}/g, skillsCalled)
  }

  // ── Result aggregation ──────────────────────────────────────────────────

  private buildResult(
    hook: PolicyHook, results: PolicyCheckResult[],
    pendingToolCalls: PendingGuardrailToolCall[], hitCounts?: Map<string, number>,
  ): PolicyEvaluationResult {
    const summary = results.reduce((worst, r) => (SEVERITY[r.result] > SEVERITY[worst] ? r.result : worst), 'pass' as PolicyResult)
    const feedbackMessage = this.buildFeedbackMessage(hook, results, summary, hitCounts)
    return { hook, results, summary, feedbackMessage, ...(pendingToolCalls.length > 0 ? { pendingToolCalls } : {}) }
  }

  private buildFeedbackMessage(hook: PolicyHook, results: PolicyCheckResult[], _summary: PolicyResult, hitCounts?: Map<string, number>): string | undefined {
    const nonPass = results.filter((r) => r.result !== 'pass')
    if (nonPass.length === 0) return undefined

    const lines: string[] = ['[POLICY]']
    for (const r of nonPass) {
      const count = hitCounts?.get(r.policyName) || 0
      const escalationNote = count >= 2 ? ` (violation #${count})` : ''
      lines.push(`"${r.policyName}": ${r.result}${escalationNote}${r.reason ? ` — ${r.reason}` : ''}`)
    }

    const escalated = nonPass.some((r) => r.result === 'escalated')
    const blocked = nonPass.some((r) => r.result === 'blocked')

    if (hook === 'preTool' && blocked) {
      const isEscalationBlocked = nonPass.some((r) => r.policyName === 'investigate_before_escalation' && r.result === 'blocked')
      if (isEscalationBlocked) {
        lines.push('→ This tool was NOT executed.')
        lines.push('→ Complete the required investigation first (call the listed skills above), then retry create_human_task once you have the results.')
      } else {
        lines.push('→ This tool was NOT executed. Address the policy requirement above before retrying.')
        lines.push('→ If the issue cannot be resolved by tool calls, explain the limitation to the customer or call create_human_task to escalate.')
      }
    } else if (hook === 'postTool' && escalated) {
      lines.push('→ Data contradiction detected. This case will be escalated to a human operator.')
    } else if (hook === 'postTool' && blocked) {
      lines.push('→ Your output violated policy. Adjust your approach in the next turn.')
    } else if (hook === 'preFinalize' && blocked) {
      lines.push('→ Finalization was REJECTED. Address the issues above and call finalize_case again.')
    }

    if (blocked || escalated) {
      const maxCount = Math.max(...nonPass.map((r) => hitCounts?.get(r.policyName) || 0), 0)
      if (maxCount >= 2) lines.push(`→ WARNING: This policy has been violated ${maxCount} times. Further violations will escalate.`)
    }
    return lines.join('\n')
  }

  // ── Configuration API ───────────────────────────────────────────────────

  getPolicyNames(): string[] { return this.hooks.map((h) => (h as any).__name || 'unnamed') }

  setHook(hook: GuardrailHook & { __name?: string }): void {
    const errors = validateGuardrailHook(hook)
    if (errors.length > 0) console.warn('[PolicyEngine] Hook validation errors:', errors)
    this.hooks.push(hook)
  }

  setHooks(_hook: PolicyHook, _policyNames: string[]): void { /* no-op in G11 */ }
  setPolicy(_name: string, _rule: any): void { /* no-op in G11 */ }

  private stageLoadedHookNames: string[] = []

  loadStageGuardrails(guardrails: any[]): void {
    for (const g of guardrails) {
      const stageName = `stage:${g.name}`
      const gh: GuardrailHook = {
        when: g.hook as GuardrailCheckpoint,
        match: { skills: g.rule?.hook_skills || [] },
        check: {
          kind: g.rule?.evaluationPrompt ? 'ai' : 'rule',
          denySkills: g.rule?.deny_skills, requireSkills: g.rule?.require_skills,
          requireSkillsAny: g.rule?.require_skills_any, evaluationPrompt: g.rule?.evaluationPrompt,
        },
        onViolation: { action: 'block' },
        onUnavailable: { action: 'closed' },
      };
      (gh as any).__name = stageName
      this.hooks.push(gh)
      this.stageLoadedHookNames.push(stageName)
    }
  }

  clearStageGuardrails(): void {
    this.hooks = this.hooks.filter((h) => !this.stageLoadedHookNames.includes((h as any).__name))
    this.stageLoadedHookNames = []
  }
}
