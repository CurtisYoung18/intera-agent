// Intera Harness - Policy Engine (G11 Phase 1 — GuardrailHook primitive)
//
// Guardrail hooks are evaluated at preTool, postTool, and preFinalize checkpoints.
// Hooks load from DB (guardrailConfig JSON, falling back to legacy rule JSON).
// Hook assignment is driven by AgentConfig.capabilityBindings.guardrails.
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
//   F3 — ai_eval_filtered → ai_eval_targeted rename (in admin UI).

import Anthropic from '@anthropic-ai/sdk'
import { createAgentClient } from './api/provider-config'
import type {
  PolicyHook,
  PolicyResult,
  CapabilityBindings,
  PolicyCheckResult,
  PolicyEvaluationResult,
  PendingGuardrailToolCall,
  GuardrailHook,
  GuardrailCheckpoint,
} from '@intera/shared/types'
import { withRetry, CannotRetryError } from './api/with-retry'
import { writeAudit } from '@/lib/audit'

// ── Platform-owned safety constants (§7.6) ────────────────────────────────

/** Skills whose hooks forbid onUnavailable:'open'. */
const HIGH_RISK_SKILLS = new Set(['refund_money', 'change_ban_status', 'delete_account'])

/** Tools that invoke_tool is allowed to target (safe control-flow only). */
const SAFE_TOOL_ALLOWLIST = new Set(['create_human_task', 'request_user_input'])

/** Default fallback tool when the safety floor must coerce an unsafe config. */
const DEFAULT_FALLBACK_TOOL = 'create_human_task'

// ── Public interfaces ─────────────────────────────────────────────────────

export interface PolicyContext {
  skillName?: string
  skillInput?: Record<string, unknown>
  skillOutput?: unknown
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  /** Skill names executed this iteration (postTool filtering). */
  executedSkills?: string[]
  /** Full skill results including sub-agent outputs. */
  skillResults?: Record<string, unknown>
}

/** Severity ordering for computing the aggregate summary. */
const SEVERITY: Record<PolicyResult, number> = {
  pass: 0,
  hint: 1,
  blocked: 2,
  escalated: 3,
}

// ── Validation ────────────────────────────────────────────────────────────

/** Validate a GuardrailHook against the safety floor. Returns error messages. */
export function validateGuardrailHook(hook: GuardrailHook): string[] {
  const errors: string[] = []

  // Check: invoke_tool target must be in the safe-tool allowlist
  if (hook.onViolation.action === 'invoke_tool') {
    const tool = hook.onViolation.tool
    if (!tool || !SAFE_TOOL_ALLOWLIST.has(tool)) {
      errors.push(
        `onViolation.invoke_tool target "${tool || '(none)'}" is not in the safe-tool allowlist: ${[...SAFE_TOOL_ALLOWLIST].join(', ')}`,
      )
    }
  }

  if (hook.onUnavailable.action === 'invoke_tool') {
    const tool = hook.onUnavailable.tool
    if (!tool || !SAFE_TOOL_ALLOWLIST.has(tool)) {
      errors.push(
        `onUnavailable.invoke_tool target "${tool || '(none)'}" is not in the safe-tool allowlist: ${[...SAFE_TOOL_ALLOWLIST].join(', ')}`,
      )
    }
  }

  // High-risk skill hooks: forbid onUnavailable:'open'
  const hasHighRiskSkill = hook.match.skills.some((s) => HIGH_RISK_SKILLS.has(s))
  if (hasHighRiskSkill && hook.onUnavailable.action === 'open') {
    errors.push(
      `onUnavailable cannot be 'open' for hooks on high-risk skills (${hook.match.skills.filter((s) => HIGH_RISK_SKILLS.has(s)).join(', ')}). Use 'closed' or 'invoke_tool'.`,
    )
  }

  return errors
}

// ── Engine ────────────────────────────────────────────────────────────────

export class PolicyEngine {
  private hooks: GuardrailHook[] = []
  private legacyPolicies: Map<string, any> = new Map()
  private policyModel: string
  private llmClient: Anthropic
  private orgId: string

  constructor(orgId: string, _guardrails?: CapabilityBindings['guardrails']) {
    this.orgId = orgId
    this.policyModel = process.env.POLICY_EVAL_MODEL || 'MiniMax-M2.7-highspeed'
    this.llmClient = createAgentClient(this.policyModel)
  }

  /** Create and initialize a PolicyEngine — loads built-ins + DB hooks.
   *  @param guardrails — capabilityBindings.guardrails from the active AgentConfig version. */
  static async create(orgId: string, guardrails?: CapabilityBindings['guardrails']): Promise<PolicyEngine> {
    const engine = new PolicyEngine(orgId, guardrails)

    // Load DB policies/hooks
    try {
      const { prisma } = await import('@intera/shared/prisma')
      const dbPolicies = await prisma.policy.findMany({
        where: { orgId, enabled: true },
      })

      for (const p of dbPolicies) {
        // Prefer guardrailConfig (G11), fall back to legacy rule
        if (p.guardrailConfig) {
          try {
            const hook: GuardrailHook = JSON.parse(p.guardrailConfig)
            // Validate and register
            const errors = validateGuardrailHook(hook)
            if (errors.length > 0) {
              console.warn(`[PolicyEngine] Hook "${p.name}" has config errors:`, errors)
            }
            // Still register it — the engine enforces the floor at runtime too
            engine.hooks.push(hook)
          } catch (err) {
            console.warn(`[PolicyEngine] Failed to parse guardrailConfig for "${p.name}":`, err)
          }
        } else if (p.rule) {
          // Legacy path — store for compatibility
          try {
            engine.legacyPolicies.set(p.name, JSON.parse(p.rule))
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      console.warn('[PolicyEngine] Failed to load policies from DB, using built-ins only:', err)
    }

    // If no hooks loaded from DB, seed built-in defaults
    if (engine.hooks.length === 0) {
      engine.loadBuiltInHooks()
    }

    // Filter to only hooks named in guardrails binding (if provided)
    if (guardrails) {
      const names = new Set([
        ...(guardrails.preTool || []),
        ...(guardrails.postTool || []),
        ...(guardrails.preFinalize || []),
      ])
      if (names.size > 0) {
        engine.hooks = engine.hooks.filter((h) => {
          // Match by hook name — we store the name in the hook object via a synthetic field
          return names.has((h as any).__name)
        })
      }
    }

    return engine
  }

  // ── Built-in hooks (G11 shape, §7.6 defaults) ──────────────────────────

  private loadBuiltInHooks(): void {
    const builtIns: Array<{ name: string; hook: GuardrailHook }> = [
      {
        name: 'no_high_risk_account_change',
        hook: {
          when: 'preTool',
          match: { skills: ['refund_money', 'change_ban_status', 'delete_account'] },
          check: { kind: 'rule', denySkills: ['refund_money', 'change_ban_status', 'delete_account'] },
          onViolation: { action: 'block', guidance: 'High-risk account changes are not allowed. Escalate to human if needed.' },
          onUnavailable: { action: 'closed' },
          guidance: 'This tool is blocked by policy. If the customer needs this action, call create_human_task to escalate.',
        },
      },
      {
        name: 'investigate_before_escalation',
        hook: {
          when: 'preTool',
          match: { skills: ['create_human_task'] },
          check: { kind: 'rule', requireSkillsAny: ['get_latest_deposit', 'get_withdraw_conditions', 'get_account_status', 'get_kyc_status'] },
          onViolation: { action: 'block', guidance: 'Complete the required investigation first before escalating.' },
          onUnavailable: { action: 'closed' },
          guidance: 'Investigation required before escalation. Call the required skills first.',
        },
      },
      {
        name: 'conflict_requires_human',
        hook: {
          when: 'postTool',
          match: { skills: ['get_latest_deposit', 'get_withdraw_conditions', 'get_account_status', 'get_kyc_status'] },
          check: {
            kind: 'ai',
            evaluationPrompt: [
              'Check whether the skill outputs contradict what the customer reported.',
              '',
              'Skill output: {{skill_output}}',
              'Confirmed facts: {{confirmed_facts}}',
              '',
              'Escalate to human (result=escalated) when:',
              '(1) the system shows a completed/successful transaction but the customer says funds are missing or not received,',
              '(2) the system shows account status is normal but the customer reports access issues,',
              '(3) the payment channel shows normal operation but the customer says the payment failed.',
              '',
              'If outputs are consistent with the customer issue, pass.',
              'If data is ambiguous or incomplete, hint.',
            ].join('\n'),
          },
          onViolation: { action: 'invoke_tool', tool: 'create_human_task' },
          onUnavailable: { action: 'invoke_tool', tool: 'create_human_task' },
        },
      },
      {
        name: 'evidence_required_before_resolution',
        hook: {
          when: 'preFinalize',
          match: { skills: [] },
          check: { kind: 'rule', requireSkillsAny: ['get_latest_deposit', 'get_account_status', 'get_kyc_status'] },
          onViolation: { action: 'block', guidance: 'Evidence required before resolution. Call at least one investigation skill first.' },
          onUnavailable: { action: 'closed' },
        },
      },
      {
        name: 'no_compensation_promise',
        hook: {
          when: 'preFinalize',
          match: { skills: [] },
          check: {
            kind: 'ai',
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
          },
          onViolation: { action: 'block', guidance: 'Only human operators may authorize compensation. Do not promise refunds or financial remedies.' },
          onUnavailable: { action: 'invoke_tool', tool: 'create_human_task' },
        },
      },
      {
        name: 'must_cite_basis',
        hook: {
          when: 'preFinalize',
          match: { skills: [] },
          check: {
            kind: 'ai',
            evaluationPrompt: [
              'Check whether the finalize conclusion references specific evidence gathered during case investigation.',
              '',
              'Finalize output: {{skill_output}}',
              'Confirmed facts: {{confirmed_facts}}',
              'Skills called: {{skills_called}}',
              '',
              'The conclusion must cite at least one of:',
              '(1) a specific skill result (e.g. get_latest_deposit showed status=completed),',
              '(2) confirmed facts collected from the user,',
              '(3) a knowledge base article or policy reference.',
              '',
              'Block (result=blocked) if the conclusion makes claims without any factual grounding.',
              'Pass if evidence is properly cited and the reasoning is traceable to collected facts.',
            ].join('\n'),
          },
          onViolation: { action: 'block', guidance: 'Conclusions must cite specific evidence. Reference skill results, confirmed facts, or policy.' },
          onUnavailable: { action: 'open' },
        },
      },
    ]

    for (const { name, hook } of builtIns) {
      (hook as any).__name = name
      this.hooks.push(hook)
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Evaluate all hooks for a checkpoint.
   * Returns aggregate result with pending tool calls for invoke_tool outcomes.
   */
  async evaluate(
    hook: PolicyHook,
    context: PolicyContext,
    hitCounts?: Map<string, number>,
  ): Promise<PolicyEvaluationResult> {
    // Map PolicyHook to GuardrailCheckpoint
    const checkpoint = hook as GuardrailCheckpoint
    const checkpointHooks = this.hooks.filter((h) => h.when === checkpoint)

    if (checkpointHooks.length === 0) {
      return { hook, results: [], summary: 'pass' }
    }

    const results: PolicyCheckResult[] = []
    const pendingToolCalls: PendingGuardrailToolCall[] = []

    // Phase 1: Rule-based hooks (synchronous, fast)
    for (const gh of checkpointHooks) {
      const hookName = (gh as any).__name || 'unnamed'

      // Match filter: does this hook apply to the current skill?
      if (!this.matchesContext(gh, context, checkpoint)) continue

      if (gh.check.kind === 'rule') {
        const ruleResult = this.checkRule(gh, context, hookName)
        if (ruleResult) {
          results.push(ruleResult)
          // Resolve outcome
          const outcome = this.resolveOutcome(gh, ruleResult, hookName)
          if (outcome.pendingToolCall) {
            pendingToolCalls.push(outcome.pendingToolCall)
          }
          // Audit
          this.auditResolution(hookName, gh, ruleResult, checkpoint)
          // Blocking rule match — return immediately
          if (ruleResult.result === 'blocked') {
            return this.buildResult(hook, results, pendingToolCalls, hitCounts)
          }
        }
      }
    }

    // Phase 2: AI-based hooks (batched into single LLM call)
    const aiHooks: Array<{ name: string; hook: GuardrailHook; prompt: string }> = []
    for (const gh of checkpointHooks) {
      const hookName = (gh as any).__name || 'unnamed'
      if (gh.check.kind !== 'ai') continue
      if (!gh.check.evaluationPrompt) continue
      if (!this.matchesContext(gh, context, checkpoint)) continue

      // F1 FIX: at preTool, skillOutput is absent — resolve with skillInput instead
      const resolved = this.resolvePlaceholders(gh.check.evaluationPrompt, context, checkpoint, hookName)
      aiHooks.push({ name: hookName, hook: gh, prompt: resolved })
    }

    if (aiHooks.length > 0) {
      try {
        const batchResults = await this.evaluateBatch(aiHooks.map((h) => ({ name: h.name, prompt: h.prompt })))
        for (let i = 0; i < batchResults.length; i++) {
          const br = batchResults[i]
          const ah = aiHooks[i]
          results.push(br)

          // Resolve outcome for AI results
          const outcome = this.resolveOutcome(ah.hook, br, ah.name)
          if (outcome.pendingToolCall) {
            pendingToolCalls.push(outcome.pendingToolCall)
          }
          // Audit
          this.auditResolution(ah.name, ah.hook, br, checkpoint)
        }
      } catch (err) {
        // F2 FIX: on LLM failure, follow each hook's onUnavailable instead of silent pass
        for (const ah of aiHooks) {
          const unavailableResult = this.resolveUnavailable(ah.hook, ah.name, err)
          results.push(unavailableResult)
          // Audit the unavailable resolution
          this.auditResolution(ah.name, ah.hook, unavailableResult, checkpoint)
          // Collect pending tool calls from unavailable→invoke_tool
          if (unavailableResult.result === 'escalated') {
            const tool = this.getUnavailableTool(ah.hook)
            if (tool) {
              pendingToolCalls.push({
                tool,
                reason: `Guardrail "${ah.name}" evaluation unavailable: ${unavailableResult.reason}`,
                hookName: ah.name,
              })
            }
          }
        }
      }
    }

    return this.buildResult(hook, results, pendingToolCalls, hitCounts)
  }

  // ── Context matching ────────────────────────────────────────────────────

  private matchesContext(gh: GuardrailHook, context: PolicyContext, checkpoint: GuardrailCheckpoint): boolean {
    // If hook specifies skills, the current skill must match
    if (gh.match.skills.length > 0) {
      if (!context.skillName) return false
      if (!gh.match.skills.includes(context.skillName)) return false
    }

    // ifPattern: cheap pre-filter on the payload
    if (gh.match.ifPattern) {
      const payload = checkpoint === 'preTool'
        ? JSON.stringify(context.skillInput ?? {})
        : JSON.stringify(context.skillOutput ?? {})
      try {
        const regex = new RegExp(gh.match.ifPattern, 'i')
        if (!regex.test(payload)) return false
      } catch {
        // Invalid regex — skip the filter (don't block the hook)
      }
    }

    return true
  }

  // ── Rule evaluation ─────────────────────────────────────────────────────

  private checkRule(
    gh: GuardrailHook,
    context: PolicyContext,
    hookName: string,
  ): PolicyCheckResult | null {
    const ch = gh.check

    // denySkills — block specific skills by name
    if (ch.denySkills && context.skillName && ch.denySkills.includes(context.skillName)) {
      return {
        policyName: hookName,
        result: 'blocked',
        reason: `Skill "${context.skillName}" is denied by policy`,
      }
    }

    // requireSkills — all listed skills must have been called
    if (ch.requireSkills && ch.requireSkills.length > 0) {
      const called = context.skillsCalled || []
      const missing = ch.requireSkills.filter((s) => !called.includes(s))
      if (missing.length > 0) {
        return {
          policyName: hookName,
          result: 'blocked',
          reason: `Required skills not called: ${missing.join(', ')}`,
        }
      }
    }

    // requireSkillsAny — at least one must have been called
    if (ch.requireSkillsAny && ch.requireSkillsAny.length > 0) {
      const called = context.skillsCalled || []
      let ok = ch.requireSkillsAny.some((s) => called.includes(s))

      // Also check sub-agent evidence
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
        return {
          policyName: hookName,
          result: 'blocked',
          reason: `Must call at least one of: ${ch.requireSkillsAny.join(', ')} before ${context.skillName || 'this action'}`,
        }
      }
    }

    return null
  }

  // ── Outcome resolution ──────────────────────────────────────────────────

  private resolveOutcome(
    gh: GuardrailHook,
    result: PolicyCheckResult,
    hookName: string,
  ): { pendingToolCall?: PendingGuardrailToolCall } {
    if (result.result === 'pass' || result.result === 'hint') {
      return {}
    }

    // blocked or escalated → follow onViolation
    if (gh.onViolation.action === 'invoke_tool') {
      const tool = this.safeToolTarget(gh.onViolation.tool)
      if (tool) {
        // Map to 'escalated' so loop.ts enqueues the tool
        result.result = 'escalated'
        return {
          pendingToolCall: {
            tool,
            reason: `Guardrail "${hookName}" violated: ${result.reason}`,
            hookName,
          },
        }
      }
    }

    if (gh.onViolation.action === 'block') {
      result.result = 'blocked'
    }

    return {}
  }

  /** Resolve onUnavailable when the LLM call fails. */
  private resolveUnavailable(
    gh: GuardrailHook,
    hookName: string,
    err: unknown,
  ): PolicyCheckResult {
    // Safety floor: for hooks on high-risk skills, coerce 'open' → invoke_tool
    const hasHighRisk = gh.match.skills.some((s) => HIGH_RISK_SKILLS.has(s))
    let unavailableAction = gh.onUnavailable.action

    if (hasHighRisk && unavailableAction === 'open') {
      unavailableAction = 'invoke_tool'
      console.warn(
        `[PolicyEngine] SAFETY FLOOR: coercing onUnavailable:'open' → 'invoke_tool' for hook "${hookName}" on high-risk skill(s)`,
      )
    }

    const errorClass = err instanceof CannotRetryError ? err.errorClass : 'unknown'

    switch (unavailableAction) {
      case 'closed':
        return {
          policyName: hookName,
          result: 'blocked',
          reason: `Policy evaluation unavailable — blocked for safety (${errorClass})`,
        }
      case 'invoke_tool': {
        const tool = this.safeToolTarget(gh.onUnavailable.tool)
        return {
          policyName: hookName,
          result: 'escalated',
          reason: `Policy evaluation unavailable — escalating via ${tool || DEFAULT_FALLBACK_TOOL} (${errorClass})`,
        }
      }
      case 'open':
      default:
        return {
          policyName: hookName,
          result: 'hint',
          reason: `Policy evaluation unavailable — allowed with warning (${errorClass})`,
        }
    }
  }

  /** Enforce the safe-tool allowlist. Returns the tool name or null. */
  private safeToolTarget(tool?: string): string | null {
    if (tool && SAFE_TOOL_ALLOWLIST.has(tool)) return tool
    return DEFAULT_FALLBACK_TOOL
  }

  /** Get the tool for onUnavailable invoke_tool (with safety floor). */
  private getUnavailableTool(gh: GuardrailHook): string | null {
    const hasHighRisk = gh.match.skills.some((s) => HIGH_RISK_SKILLS.has(s))
    let action = gh.onUnavailable.action
    if (hasHighRisk && action === 'open') {
      action = 'invoke_tool'
    }
    if (action === 'invoke_tool') {
      return gh.onUnavailable.tool && SAFE_TOOL_ALLOWLIST.has(gh.onUnavailable.tool)
        ? gh.onUnavailable.tool
        : DEFAULT_FALLBACK_TOOL
    }
    return null
  }

  // ── Audit (F6) ──────────────────────────────────────────────────────────

  private auditResolution(
    hookName: string,
    gh: GuardrailHook,
    result: PolicyCheckResult,
    checkpoint: string,
  ): void {
    const action = result.result === 'pass'
      ? 'guardrail.pass'
      : result.result === 'blocked'
        ? 'guardrail.block'
        : result.result === 'escalated'
          ? 'guardrail.escalate'
          : 'guardrail.hint'

    writeAudit({
      actorUserId: 'system',
      orgId: this.orgId,
      action,
      target: `policy:${hookName}`,
      after: {
        checkpoint,
        result: result.result,
        reason: result.reason,
        modelUsed: result.modelUsed,
      },
    }).catch((err) => {
      console.warn('[PolicyEngine] Audit write failed (non-fatal):', err)
    })
  }

  // ── Batch LLM evaluation ────────────────────────────────────────────────

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

    let msg: Anthropic.Messages.Message
    try {
      msg = await withRetry(
        (retryClient) => retryClient.messages.create({
          model: this.policyModel,
          max_tokens: 512,
          temperature: 0,
          system: systemPrompt,
          tools: [policyTool as any],
          messages: [{ role: 'user', content: userPrompt }],
        }),
        { querySource: 'policy_eval', model: this.policyModel },
        () => this.llmClient,
      )
    } catch (err) {
      // F2 FIX: propagate the error so evaluate() can follow onUnavailable
      // (was: silently passing all checks)
      throw err
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
            reason: (input.reason as string) || undefined,
            modelUsed: this.policyModel,
          })
        }
      }
    }

    // Text fallback
    if (results.length === 0) {
      const text = (msg.content[0] as any)?.text || ''
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          const pr = validResults.has(parsed.result) ? parsed.result : 'pass'
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

    // Any policy not evaluated defaults to pass
    for (const p of policies) {
      if (!seen.has(p.name)) {
        results.push({ policyName: p.name, result: 'pass', modelUsed: this.policyModel })
      }
    }

    return results
  }

  // ── Placeholder resolution ──────────────────────────────────────────────

  private resolvePlaceholders(
    template: string,
    context: PolicyContext,
    checkpoint: GuardrailCheckpoint,
    _policyName: string,
  ): string {
    const facts = context.confirmedFacts
      ? JSON.stringify(context.confirmedFacts)
      : 'none'

    // F1 FIX: at preTool, skillOutput is absent — use skillInput
    const hasOutput = context.skillOutput !== undefined && context.skillOutput !== null
    const output = hasOutput
      ? JSON.stringify(context.skillOutput)
      : (checkpoint === 'preTool' && context.skillInput
          ? JSON.stringify(context.skillInput)
          : 'none')

    const skillsCalled = context.skillsCalled
      ? JSON.stringify(context.skillsCalled)
      : '[]'

    const skillName = context.skillName || 'unknown'

    return template
      .replace(/\{\{skill_name\}\}/g, skillName)
      .replace(/\{\{skill_output\}\}/g, output)
      .replace(/\{\{skill_input\}\}/g, context.skillInput ? JSON.stringify(context.skillInput) : 'none')
      .replace(/\{\{confirmed_facts\}\}/g, facts)
      .replace(/\{\{skills_called\}\}/g, skillsCalled)
  }

  // ── Result aggregation & feedback ───────────────────────────────────────

  private buildResult(
    hook: PolicyHook,
    results: PolicyCheckResult[],
    pendingToolCalls: PendingGuardrailToolCall[],
    hitCounts?: Map<string, number>,
  ): PolicyEvaluationResult {
    const summary = results.reduce(
      (worst, r) => (SEVERITY[r.result] > SEVERITY[worst] ? r.result : worst),
      'pass' as PolicyResult,
    )

    const feedbackMessage = this.buildFeedbackMessage(hook, results, summary, hitCounts)

    return {
      hook,
      results,
      summary,
      feedbackMessage,
      ...(pendingToolCalls.length > 0 ? { pendingToolCalls } : {}),
    }
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

    const escalated = nonPass.some((r) => r.result === 'escalated')
    const blocked = nonPass.some((r) => r.result === 'blocked')

    if (hook === 'preTool' && blocked) {
      const isEscalationBlocked = nonPass.some(
        (r) => r.policyName === 'investigate_before_escalation' && r.result === 'blocked',
      )
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
      if (maxCount >= 2) {
        lines.push(`→ WARNING: This policy has been violated ${maxCount} times. Further violations will escalate.`)
      }
    }

    return lines.join('\n')
  }

  // ── Configuration API ───────────────────────────────────────────────────

  getPolicyNames(): string[] {
    return this.hooks.map((h) => (h as any).__name || 'unnamed')
  }

  /** Register a guardrail hook programmatically. */
  setHook(hook: GuardrailHook & { __name?: string }): void {
    const errors = validateGuardrailHook(hook)
    if (errors.length > 0) {
      console.warn('[PolicyEngine] Hook validation errors:', errors)
    }
    this.hooks.push(hook)
  }

  /** Legacy: programmatically update hook bindings. */
  setHooks(_hook: PolicyHook, _policyNames: string[]): void {
    // No-op in G11 — hooks are self-describing (each has its own `when`)
  }

  /** Legacy: register a policy rule. */
  setPolicy(_name: string, _rule: any): void {
    // No-op in G11 — use setHook instead
  }

  // Stage-loaded guardrail tracking
  private stageLoadedHookNames: string[] = []

  /** Load stage-specific guardrails on top of global hooks. */
  loadStageGuardrails(guardrails: any[]): void {
    for (const g of guardrails) {
      const stageName = `stage:${g.name}`
      // Convert legacy StageGuardrail to GuardrailHook
      const gh: GuardrailHook = {
        when: g.hook as GuardrailCheckpoint,
        match: { skills: g.rule?.hook_skills || [] },
        check: {
          kind: g.rule?.evaluationPrompt ? 'ai' : 'rule',
          denySkills: g.rule?.deny_skills,
          requireSkills: g.rule?.require_skills,
          requireSkillsAny: g.rule?.require_skills_any,
          evaluationPrompt: g.rule?.evaluationPrompt,
        },
        onViolation: { action: 'block' },
        onUnavailable: { action: 'closed' },
      }
      ;(gh as any).__name = stageName
      this.hooks.push(gh)
      this.stageLoadedHookNames.push(stageName)
    }
  }

  /** Remove previously loaded stage-specific guardrails. */
  clearStageGuardrails(): void {
    this.hooks = this.hooks.filter(
      (h) => !this.stageLoadedHookNames.includes((h as any).__name),
    )
    this.stageLoadedHookNames = []
  }
}
