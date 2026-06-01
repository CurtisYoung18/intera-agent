// Intera Harness - Stage Executor
// Stage-gated execution engine that enforces case schema flow.
// Each stage defines: required skills, evidence requirements, guardrails,
// tool allowlist, model/prompt overrides, and transition evaluation rules.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import { createAgentClient } from './api/provider-config'
import type {
  CaseSchemaConfig,
  StageConfig,
  StageGuardrail,
  EvidenceRequirement,
  AgentConfigData,
  ChatMemoryData,
} from '@intera/shared/types'
import { DEFAULT_STAGE_CONFIGS } from '@intera/shared/defaults'
import { withRetry, CannotRetryError } from './api/with-retry'
import type { ChatMemoryManager } from './memory'

export interface StageCheckResult {
  met: boolean
  missing: string[]
  details: string[]
}

export interface TransitionEval {
  shouldTransition: boolean
  nextStage?: string
  reason: string
  modelUsed?: string
  evaluationFallbackTriggered?: boolean
}

export class StageExecutor {
  private stageConfigs: Record<string, StageConfig>
  private consecutiveEvalParseFailures = 0
  private bootstrapNewCase: boolean

  constructor(
    private caseSchema: CaseSchemaConfig,
    private agentConfig: AgentConfigData,
    private chatMemory: ChatMemoryManager,
    bootstrapNewCase?: boolean,
  ) {
    this.bootstrapNewCase = bootstrapNewCase ?? false
    // Parse stage configs from case schema, with fallback to defaults
    this.stageConfigs = this.loadStageConfigs()
  }

  // -----------------------------------------------------------------------
  // Stage resolution
  // -----------------------------------------------------------------------

  /** Map case status to the current stage name from the schema. */
  getCurrentStage(): string {
    const mem = this.chatMemory.getSummary()
    const status = mem.caseStatus

    if (status && this.caseSchema.stages.includes(status)) {
      return status
    }

    // Fallback: first stage
    return this.caseSchema.stages[0] || 'created'
  }

  /** Get the stage config for a given stage name. */
  getStageConfig(stage: string): StageConfig | null {
    return this.stageConfigs[stage] || null
  }

  /** Get the index of the next stage (for transition). */
  getNextStageName(currentStage: string): string | null {
    const idx = this.caseSchema.stages.indexOf(currentStage)
    if (idx >= 0 && idx < this.caseSchema.stages.length - 1) {
      return this.caseSchema.stages[idx + 1]
    }
    return null
  }

  /** Whether any stage configs are defined (enables gated execution). */
  hasStageConfigs(): boolean {
    return Object.keys(this.stageConfigs).length > 0
  }

  // -----------------------------------------------------------------------
  // Prompt building
  // -----------------------------------------------------------------------

  buildStagePrompt(stage: string, basePrompt?: string): string {
    const cfg = this.getStageConfig(stage)
    const base = basePrompt || this.agentConfig.systemPrompt

    if (!cfg) return base

    const parts: string[] = [base]

    if (cfg.systemPrompt) {
      parts.push(`\n## Stage: ${stage}\n${cfg.systemPrompt}`)
    } else if (cfg.description) {
      parts.push(`\n## Current Stage: ${stage}\n${cfg.description}`)
    }

    // Inject required skills hint
    if (cfg.requiredSkills?.length) {
      parts.push(`\n**Required actions in this stage:** ${cfg.requiredSkills.join(', ')}`)
    }

    // Inject evidence requirements
    if (cfg.evidenceRequirements?.length) {
      const reqs = cfg.evidenceRequirements
        .filter((e) => e.required)
        .map((e) => e.description)
      parts.push(`**Evidence needed:** ${reqs.join('; ')}`)
    }

    // Inject transition info
    if (cfg.transition) {
      parts.push(`**Stage transition:** ${cfg.transition.type} — you may proceed when conditions are met.`)
    }

    return parts.join('\n')
  }

  // -----------------------------------------------------------------------
  // Tool filtering
  // -----------------------------------------------------------------------

  /** Filter tools to only those allowed in the current stage. */
  filterTools(stage: string, allTools: Tool[], nudgeCount = 0): Tool[] {
    const cfg = this.getStageConfig(stage)
    if (!cfg?.availableSkills?.length) return allTools

    // Hard constraint on nudge 2+: restrict to ONLY missing required skills
    // so the LLM cannot generate text to avoid calling required tools.
    if (nudgeCount >= 2 && cfg?.requiredSkills?.length) {
      const requiredCheck = this.checkRequiredSkills(stage)
      if (!requiredCheck.met) {
        const forced = new Set(requiredCheck.missing)
        forced.add('create_human_task')
        forced.add('finalize_case')
        forced.add('request_user_input')
        forced.add('finalize_consultation')
        return allTools.filter((t) => forced.has(t.name))
      }
    }

    const allowed = new Set(cfg.availableSkills)
    // Always allow terminal tools regardless of stage
    allowed.add('create_human_task')
    allowed.add('finalize_case')
    allowed.add('request_user_input')
    // finalize_consultation is the terminal tool for human-chat consultation mode.
    // Adding it here is safe: customer-facing chat won't call it because it has no
    // reason to (no human task context), and the human-chat agent MUST be able to
    // call it to complete the consultation.
    allowed.add('finalize_consultation')

    // Prevent duplicate case creation — when a case is already active (past "created"
    // stage), remove dispatch_case_agent so the agent doesn't call it again.
    if (stage !== 'created') {
      allowed.delete('dispatch_case_agent')
    }

    return allTools.filter((t) => allowed.has(t.name))
  }

  // -----------------------------------------------------------------------
  // Evidence requirements
  // -----------------------------------------------------------------------

  /** Check if all required evidence for the stage has been gathered. */
  checkEvidenceRequirements(stage: string): StageCheckResult {
    const cfg = this.getStageConfig(stage)
    if (!cfg?.evidenceRequirements?.length) {
      return { met: true, missing: [], details: [] }
    }

    const mem = this.chatMemory.getSummary()
    const facts = (mem.confirmedFacts || {}) as Record<string, unknown>
    const skillResults = (mem.skillResults || {}) as Record<string, unknown>

    const missing: string[] = []
    const details: string[] = []

    for (const req of cfg.evidenceRequirements) {
      if (!req.required) continue

      let hasEvidence = false

      if (req.source === 'user_input' || req.source === 'evaluation') {
        hasEvidence = facts[req.factKey] !== undefined && facts[req.factKey] !== null
      } else if (req.source === 'skill_output' && req.skillName) {
        const result = skillResults[req.skillName]
        if (result && typeof result === 'object') {
          hasEvidence = (result as Record<string, unknown>)[req.factKey] !== undefined
        }
      }

      if (hasEvidence) {
        details.push(`✓ ${req.description}`)
      } else {
        missing.push(req.factKey)
        details.push(`✗ ${req.description} (missing)`)
      }
    }

    return { met: missing.length === 0, missing, details }
  }

  // -----------------------------------------------------------------------
  // Required skills
  // -----------------------------------------------------------------------

  /** Check if all required skills for the stage have been called. */
  checkRequiredSkills(stage: string): StageCheckResult {
    const cfg = this.getStageConfig(stage)
    if (!cfg?.requiredSkills?.length) {
      return { met: true, missing: [], details: [] }
    }

    const mem = this.chatMemory.getSummary()
    const called = new Set((mem.skillsCalled || []) as string[])

    const missing: string[] = []
    const details: string[] = []

    for (const skill of cfg.requiredSkills) {
      if (called.has(skill)) {
        details.push(`✓ ${skill} called`)
      } else {
        missing.push(skill)
        details.push(`✗ ${skill} NOT called`)
      }
    }

    return { met: missing.length === 0, missing, details }
  }

  /** Reset the evaluation parse failure counter (called on successful stage transition). */
  resetEvalParseFailures(): void {
    this.consecutiveEvalParseFailures = 0
  }

  // -----------------------------------------------------------------------
  // Transition evaluation (optional LLM gate)
  // -----------------------------------------------------------------------

  /**
   * Evaluate whether the case should transition to the next stage.
   * Primary path: rule-based (checkRequiredSkills + checkEvidenceRequirements).
   * Optional LLM gate: only runs when transition.evaluationModel is explicitly set.
   */
  async evaluateTransition(
    stage: string,
    iterationCount: number,
  ): Promise<TransitionEval> {
    const cfg = this.getStageConfig(stage)
    if (!cfg?.transition) {
      return { shouldTransition: false, reason: 'no transition rule defined' }
    }

    const rule = cfg.transition

    // ── Manual: never auto-transition ──
    if (rule.type === 'manual') {
      return { shouldTransition: false, reason: 'manual transition' }
    }

    // ── Auto: check conditions ──
    if (rule.type === 'auto' && rule.conditions) {
      for (const cond of rule.conditions) {
        if (cond.type === 'all_evidence_gathered') {
          const check = this.checkEvidenceRequirements(stage)
          if (!check.met) {
            return { shouldTransition: false, reason: `evidence missing: ${check.missing.join(', ')}` }
          }
        }
        if (cond.type === 'all_skills_called') {
          const check = this.checkRequiredSkills(stage)
          if (!check.met) {
            return { shouldTransition: false, reason: `skills not called: ${check.missing.join(', ')}` }
          }
        }
        if (cond.type === 'min_iterations') {
          const min = Number(cond.value) || 1
          if (iterationCount < min) {
            return { shouldTransition: false, reason: `min iterations not met (${iterationCount} < ${min})` }
          }
        }
      }
      const nextStage = this.getNextStageName(stage)
      return {
        shouldTransition: true,
        nextStage: nextStage || undefined,
        reason: `all conditions met, transitioning to ${nextStage || 'end'}`,
      }
    }

    // ── Evaluation: optional LLM gate ──
    // Only runs when evaluationModel is explicitly set in Console.
    if (rule.type === 'evaluation') {
      if (rule.evaluationModel) {
        try {
          const result = await this.runEvaluation(stage, rule.evaluationPrompt, rule.evaluationModel)
          this.consecutiveEvalParseFailures = 0
          return { ...result, modelUsed: rule.evaluationModel }
        } catch (err) {
          console.warn('[StageExecutor] Evaluation failed, defaulting to stay:', err)
          return { shouldTransition: false, reason: `evaluation failed: ${err}`, modelUsed: rule.evaluationModel }
        }
      }
      // Fallback when no model set: use simple rule-based check
      const skillCheck = this.checkRequiredSkills(stage)
      const evidenceCheck = this.checkEvidenceRequirements(stage)
      const nextStage = this.getNextStageName(stage)
      if (skillCheck.met && evidenceCheck.met && nextStage) {
        return { shouldTransition: true, nextStage, reason: 'Rule-based: all requirements met (no eval model set).' }
      }
      return { shouldTransition: false, reason: 'Requirements not met (no eval model set).' }
    }

    return { shouldTransition: false, reason: 'no applicable transition rule' }
  }

  /** Run LLM-based transition evaluation using native tool_use. */
  private async runEvaluation(
    stage: string,
    evalPrompt?: string,
    evalModel?: string,
  ): Promise<TransitionEval> {
    const mem = this.chatMemory.getSummary()
    const model = evalModel || this.agentConfig.model
    const nextStage = this.getNextStageName(stage)
    const stages = this.caseSchema.stages

    const prompt = evalPrompt ||
      `Determine if the case should transition from "${stage}" to the next stage. ` +
      `Available stages: ${stages.join(' → ')}. ` +
      `Next stage: ${nextStage || 'none'}. ` +
      `Call the stage_transition_decision tool with your decision.`

    const contextBlock = [
      `Current stage: ${stage}`,
      `Stages: ${stages.join(' → ')}`,
      `Confirmed facts: ${JSON.stringify(mem.confirmedFacts)}`,
      `Missing facts: ${JSON.stringify(mem.missingFacts)}`,
      `Skills called: ${JSON.stringify(mem.skillsCalled)}`,
      `Skill results: ${JSON.stringify(mem.skillResults)}`,
      `Key events: ${JSON.stringify(mem.keyEvents)}`,
    ].join('\n')

    const transitionTool: Tool = {
      name: 'stage_transition_decision',
      description: 'Record your stage transition decision with structured fields.',
      input_schema: {
        type: 'object' as const,
        properties: {
          shouldTransition: { type: 'boolean' as const, description: 'Whether the case should move to the next stage' },
          nextStage: { type: 'string' as const, description: `Target stage name. Must be one of: ${stages.join(', ')}` },
          reason: { type: 'string' as const, description: 'Brief explanation of why this decision was made' },
        },
        required: ['shouldTransition', 'reason'],
      },
    }

    let msg: Anthropic.Messages.Message
    try {
      msg = await withRetry(
        (retryClient) => retryClient.messages.create({
          model,
          max_tokens: 256,
          temperature: 0.1,
          system: 'You are a case stage transition evaluator. Call the stage_transition_decision tool with your decision.',
          tools: [transitionTool],
          messages: [
            { role: 'user', content: `${prompt}\n\nCase context:\n${contextBlock}` },
          ],
        }),
        { querySource: 'policy_eval', model },
        () => createAgentClient(model),
      )
    } catch (err) {
      if (err instanceof CannotRetryError) {
        this.consecutiveEvalParseFailures++
        return { shouldTransition: false, reason: `evaluation error: ${err.errorClass}` }
      }
      throw err
    }

    // Try tool_use blocks FIRST
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const input = (block as any).input as Record<string, unknown> | undefined
        if (input) {
          return {
            shouldTransition: !!input.shouldTransition,
            nextStage: (input.nextStage as string) || nextStage || undefined,
            reason: (input.reason as string) || 'evaluation complete',
          }
        }
      }
    }

    // Fallback: text parsing
    const text = (msg.content[0] as any)?.text || ''
    const parsed = (() => {
      try {
        const trimmed = text.trim()
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null
      } catch { return null }
    })() as Record<string, unknown> | null

    if (parsed?.shouldTransition !== undefined) {
      this.consecutiveEvalParseFailures = 0
      return {
        shouldTransition: !!parsed.shouldTransition,
        nextStage: (parsed.nextStage as string) || nextStage || undefined,
        reason: (parsed.reason as string) || 'evaluation complete',
      }
    }

    this.consecutiveEvalParseFailures++
    console.warn('[StageExecutor] Could not parse evaluation response:', text.slice(0, 200))

    // Circuit breaker: after 2 consecutive failures, auto-transition if rule-based checks pass
    if (this.consecutiveEvalParseFailures >= 2) {
      const failCount = this.consecutiveEvalParseFailures
      const check = this.checkEvidenceRequirements(stage)
      const skillCheck = this.checkRequiredSkills(stage)
      if (check.met && skillCheck.met && nextStage) {
        console.warn(`[StageExecutor] Circuit breaker — auto-transition (${stage} → ${nextStage})`)
        this.consecutiveEvalParseFailures = 0
        return {
          shouldTransition: true,
          nextStage,
          reason: `fallback auto-transition after ${failCount} failures`,
          evaluationFallbackTriggered: true,
        }
      }
      this.consecutiveEvalParseFailures = 0
      return {
        shouldTransition: false,
        reason: `evaluation failed (${failCount} consecutive failures)`,
        evaluationFallbackTriggered: true,
      }
    }

    return { shouldTransition: false, reason: 'evaluation could not produce valid result' }
  }

  // -----------------------------------------------------------------------
  // Guardrails
  // -----------------------------------------------------------------------

  /** Get stage-specific guardrails (merged with global). */
  getStageGuardrails(stage: string): StageGuardrail[] {
    const cfg = this.getStageConfig(stage)
    return cfg?.guardrails || []
  }

  // -----------------------------------------------------------------------
  // Nudge generation
  // -----------------------------------------------------------------------

  /** Generate a nudge message when the LLM fails to call required tools. Escalates intensity per nudgeCount. */
  buildNudge(stage: string, nudgeCount = 1): string {
    const cfg = this.getStageConfig(stage)
    const parts: string[] = ['[SYSTEM NUDGE]']

    const skillCheck = this.checkRequiredSkills(stage)
    const evidenceCheck = this.checkEvidenceRequirements(stage)

    if (nudgeCount <= 1) {
      // Gentle reminder (belt-and-suspenders: treat 0 as 1 so callers
      // that pass the pre-increment count still get the gentle message)
      if (!skillCheck.met) {
        parts.push(`Stage "${stage}" expects: ${skillCheck.missing.join(', ')}. Please call these tools.`)
      }
      if (!evidenceCheck.met) {
        const userMissing = cfg?.evidenceRequirements
          ?.filter((e) => evidenceCheck.missing.includes(e.factKey) && e.source === 'user_input')
        if (userMissing?.length) {
          const withKeys = userMissing.map((e) => `${e.description} (field key: "${e.factKey}")`)
          parts.push(`Still need from customer: ${withKeys.join(', ')}. Use request_user_input with these exact field keys.`)
        }
      }
    } else if (nudgeCount === 2) {
      // Direct instruction — no more text, just tools
      parts.push('STOP generating text. You MUST call tools NOW.')
      if (!skillCheck.met) {
        parts.push(`Required tools you have NOT called: ${skillCheck.missing.join(', ')}. Call each one using the tool calling mechanism immediately.`)
      }
      if (!evidenceCheck.met) {
        const skillMissing = cfg?.evidenceRequirements
          ?.filter((e) => evidenceCheck.missing.includes(e.factKey) && e.source === 'skill_output')
          .map((e) => e.description) || []
        if (skillMissing.length) {
          parts.push(`Missing evidence: ${skillMissing.join(', ')}. Only tool calls can provide this — not text.`)
        }
      }
    } else {
      // Final warning — minimal context, maximal urgency
      parts.push(`FINAL WARNING (attempt ${nudgeCount}): You have repeatedly failed to call the tools required for stage "${stage}".`)
      if (!skillCheck.met) {
        parts.push(`Call NOW: ${skillCheck.missing.join(', ')}. No text. No explanation. Just call the tools.`)
      }
      parts.push('If you do not call the required tools now, this case will be escalated to a human operator.')
    }

    // When all stage requirements are met but no terminal action taken,
    // nudge the agent to finalize or escalate (works for any stage).
    if (skillCheck.met && evidenceCheck.met && !stage.toLowerCase().includes('resolved') && !stage.toLowerCase().includes('waiting')) {
      parts.push('All stage requirements are met. Call finalize_case to resolve this case, or create_human_task to escalate to a human specialist.')
    }

    return parts.join('\n')
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private mergeStageLayer(base: StageConfig | undefined, over: StageConfig | undefined): StageConfig | null {
    if (!base && !over) return null
    if (!base) return over ?? null
    if (!over) return base

    return {
      name: over.name ?? base.name,
      description: over.description !== undefined ? over.description : base.description,
      model: over.model !== undefined ? over.model : base.model,
      systemPrompt: over.systemPrompt !== undefined ? over.systemPrompt : base.systemPrompt,
      temperature: over.temperature !== undefined ? over.temperature : base.temperature,
      thinkingBudget: over.thinkingBudget !== undefined ? over.thinkingBudget : base.thinkingBudget,
      requiredSkills: over.requiredSkills !== undefined ? over.requiredSkills : base.requiredSkills,
      availableSkills: over.availableSkills !== undefined ? over.availableSkills : base.availableSkills,
      guardrails: over.guardrails !== undefined ? over.guardrails : base.guardrails,
      evidenceRequirements:
        over.evidenceRequirements !== undefined ? over.evidenceRequirements : base.evidenceRequirements,
      transition: over.transition !== undefined ? over.transition : base.transition,
      subAgents: over.subAgents !== undefined ? over.subAgents : base.subAgents,
    }
  }

  private mergeStageRecord(
    defaults: Record<string, StageConfig>,
    overlay: Record<string, StageConfig>,
  ): Record<string, StageConfig> {
    const keys = new Set([...Object.keys(defaults), ...Object.keys(overlay)])
    const result: Record<string, StageConfig> = {}
    for (const k of keys) {
      const merged = this.mergeStageLayer(defaults[k], overlay[k])
      if (merged) result[k] = merged
    }
    return result
  }

  private loadStageConfigs(): Record<string, StageConfig> {
    const defaultsRaw = (DEFAULT_STAGE_CONFIGS as Record<string, Record<string, unknown>>)[this.caseSchema.type]
    const defaults = (defaultsRaw || {}) as Record<string, StageConfig>
    const overlay = (this.caseSchema.stageConfigs || {}) as Record<string, StageConfig>

    if (Object.keys(defaults).length === 0 && Object.keys(overlay).length === 0) {
      return {}
    }

    return this.mergeStageRecord(defaults, overlay)
  }
}
