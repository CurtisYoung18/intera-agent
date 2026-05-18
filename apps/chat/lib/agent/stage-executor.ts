// Intera Harness - Stage Executor
// Stage-gated execution engine that enforces case schema flow.
// Each stage defines: required skills, evidence requirements, guardrails,
// tool allowlist, model/prompt overrides, and transition evaluation rules.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  CaseSchemaConfig,
  StageConfig,
  StageGuardrail,
  EvidenceRequirement,
  AgentConfigData,
  CaseMemoryData,
} from '@intera/shared/types'
import { DEFAULT_STAGE_CONFIGS } from '@intera/shared/defaults'
import type { CaseMemoryManager } from './memory'

/** Extract a JSON object from LLM output that may be wrapped in markdown code fences. */
function extractJsonFromLlmOutput(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()

  // 1. Direct parse (works when assistant pre-fill forces clean JSON start)
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
    // Retry: truncate at last complete brace pair (model may append trailing text)
    const lastBrace = trimmed.lastIndexOf('}')
    if (lastBrace > 0) {
      try { return JSON.parse(trimmed.slice(0, lastBrace + 1)) } catch { /* fall through */ }
    }
    // Retry: auto-close unclosed braces
    const openCount = (trimmed.match(/\{/g) || []).length
    const closeCount = (trimmed.match(/\}/g) || []).length
    if (openCount > closeCount) {
      try { return JSON.parse(trimmed + '}'.repeat(openCount - closeCount)) } catch { /* fall through */ }
    }
  }

  // 2. Try ```json ... ``` fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    const inner = fenceMatch[1].trim()
    try { return JSON.parse(inner) } catch { /* fall through */ }
  }

  // 3. Try regex extraction (last resort)
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* fall through */ }
  }

  return null
}

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

  constructor(
    private caseSchema: CaseSchemaConfig,
    private agentConfig: AgentConfigData,
    private caseMemory: CaseMemoryManager,
  ) {
    // Parse stage configs from case schema, with fallback to defaults
    this.stageConfigs = this.loadStageConfigs()
  }

  // -----------------------------------------------------------------------
  // Stage resolution
  // -----------------------------------------------------------------------

  /** Map case status to the current stage name from the schema. */
  getCurrentStage(): string {
    const mem = this.caseMemory.getSummary()
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

  /** Reset the evaluation parse failure counter (called on successful stage transition). */
  resetEvalParseFailures(): void {
    this.consecutiveEvalParseFailures = 0
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
  filterTools(stage: string, allTools: Tool[]): Tool[] {
    const cfg = this.getStageConfig(stage)
    if (!cfg?.availableSkills?.length) return allTools

    const allowed = new Set(cfg.availableSkills)
    // Always allow terminal tools regardless of stage
    allowed.add('create_human_task')
    allowed.add('finalize_case')
    allowed.add('request_user_input')
    // NOTE: finalize_consultation is human-chat context only — NOT auto-allowed

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

    const mem = this.caseMemory.getSummary()
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

    const mem = this.caseMemory.getSummary()
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

  // -----------------------------------------------------------------------
  // Transition evaluation
  // -----------------------------------------------------------------------

  /** Evaluate whether the case should transition to the next stage. */
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

    // ── Evaluation: use LLM to decide ──
    if (rule.type === 'evaluation') {
      const evalModel = rule.evaluationModel || this.agentConfig.evaluationModel || this.agentConfig.model
      try {
        const result = await this.runEvaluation(stage, rule.evaluationPrompt, rule.evaluationModel)
        if (result.evaluationFallbackTriggered) {
          return { ...result, modelUsed: evalModel }
        }
        this.consecutiveEvalParseFailures = 0
        return { ...result, modelUsed: evalModel }
      } catch (err) {
        console.warn('[StageExecutor] Evaluation failed, defaulting to stay:', err)
        return { shouldTransition: false, reason: `evaluation failed: ${err}`, modelUsed: evalModel }
      }
    }

    return { shouldTransition: false, reason: 'no applicable transition rule' }
  }

  /** Run LLM-based transition evaluation. */
  private async runEvaluation(
    stage: string,
    evalPrompt?: string,
    evalModel?: string,
  ): Promise<TransitionEval> {
    const mem = this.caseMemory.getSummary()
    const model = evalModel || this.agentConfig.model
    const nextStage = this.getNextStageName(stage)
    const stages = this.caseSchema.stages

    const prompt = evalPrompt ||
      `Determine if the case should transition from "${stage}" to the next stage. ` +
      `Available stages: ${stages.join(' → ')}. ` +
      `Next stage: ${nextStage || 'none'}. ` +
      `Respond with JSON: {"shouldTransition": true/false, "nextStage": "stage_name", "reason": "explanation"}`

    const contextBlock = [
      `Current stage: ${stage}`,
      `Stages: ${stages.join(' → ')}`,
      `Confirmed facts: ${JSON.stringify(mem.confirmedFacts)}`,
      `Missing facts: ${JSON.stringify(mem.missingFacts)}`,
      `Skills called: ${JSON.stringify(mem.skillsCalled)}`,
      `Skill results: ${JSON.stringify(mem.skillResults)}`,
      `Key events: ${JSON.stringify(mem.keyEvents)}`,
    ].join('\n')

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })

    // Assistant pre-fill: force the model to start with `{"` so the response
    // begins with valid JSON. Pattern: Anthropic Messages API trailing assistant
    // message (Claude Code acknowledges this in speculation.ts line 888).
    // Falls back gracefully if the provider doesn't support it.
    const usePrefill = this.agentConfig.evaluationPrefillEnabled ?? true
    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: `${prompt}\n\nCase context:\n${contextBlock}` },
    ]
    if (usePrefill) {
      messages.push({ role: 'assistant', content: '{"' })
    }

    let msg: any
    try {
      msg = await client.messages.create({
        model,
        max_tokens: 256,
        temperature: 0.1,
        system: 'You are a case stage transition evaluator. Respond with JSON only.',
        messages: messages as any,
      })
    } catch (prefillErr) {
      // If pre-fill is rejected by the provider, retry without it
      if (usePrefill) {
        console.warn('[StageExecutor] Pre-fill rejected by provider, retrying without pre-fill:', prefillErr)
        msg = await client.messages.create({
          model,
          max_tokens: 256,
          temperature: 0.1,
          system: 'You are a case stage transition evaluator. Respond with JSON only.',
          messages: [{ role: 'user', content: `${prompt}\n\nCase context:\n${contextBlock}` }],
        })
      } else {
        throw prefillErr
      }
    }

    const text = (msg.content[0] as any)?.text || ''
    const parsed = extractJsonFromLlmOutput(text) as Record<string, unknown> | null
    if (parsed) {
      this.consecutiveEvalParseFailures = 0
      return {
        shouldTransition: !!parsed.shouldTransition,
        nextStage: (parsed.nextStage as string) || nextStage || undefined,
        reason: (parsed.reason as string) || 'evaluation complete',
      }
    }

    this.consecutiveEvalParseFailures++
    console.warn('[StageExecutor] Could not parse JSON from evaluation response:', text.slice(0, 200))

    // Circuit breaker: after 3 consecutive parse failures, fall back to
    // rule-based auto transition (check evidence + skills) instead of calling LLM again.
    // Pattern: Claude Code's MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES circuit breaker.
    if (this.consecutiveEvalParseFailures >= 3) {
      const failCount = this.consecutiveEvalParseFailures
      const check = this.checkEvidenceRequirements(stage)
      const skillCheck = this.checkRequiredSkills(stage)
      if (check.met && skillCheck.met && nextStage) {
        console.warn(`[StageExecutor] Circuit breaker triggered — falling back to auto transition (${stage} → ${nextStage})`)
        this.consecutiveEvalParseFailures = 0
        return {
          shouldTransition: true,
          nextStage,
          reason: `fallback auto-transition after ${failCount} parse failures (evidence + skills met)`,
          evaluationFallbackTriggered: true,
        }
      }
      return {
        shouldTransition: false,
        reason: `evaluation could not parse result (${failCount} consecutive failures, fallback not met — missing: ${[...check.missing, ...skillCheck.missing].join(', ')})`,
        evaluationFallbackTriggered: true,
      }
    }

    return { shouldTransition: false, reason: 'evaluation could not parse result' }
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

    if (nudgeCount === 1) {
      // Gentle reminder — include exact field keys so the LLM uses the right ones
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
