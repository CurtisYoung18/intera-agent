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

export interface StageCheckResult {
  met: boolean
  missing: string[]
  details: string[]
}

export interface TransitionEval {
  shouldTransition: boolean
  nextStage?: string
  reason: string
}

export class StageExecutor {
  private stageConfigs: Record<string, StageConfig>

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
    const status = (mem as any).caseStatus as string | undefined

    // CaseMemory doesn't store caseStatus directly — derive from CaseSchema stages
    // The case status maps to a stage name (e.g. 'investigating' → stage 'investigating')
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

  /** Build the system prompt for the current stage. */
  buildStagePrompt(stage: string): string {
    const cfg = this.getStageConfig(stage)
    const base = this.agentConfig.systemPrompt

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
    allowed.add('finalize_consultation')
    allowed.add('request_user_input')

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
          const min = (cond.value as number) || 1
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
      try {
        const result = await this.runEvaluation(stage, rule.evaluationPrompt, rule.evaluationModel)
        return result
      } catch (err) {
        console.warn('[StageExecutor] Evaluation failed, defaulting to stay:', err)
        return { shouldTransition: false, reason: `evaluation failed: ${err}` }
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

    const msg = await client.messages.create({
      model,
      max_tokens: 256,
      temperature: 0.1,
      system: 'You are a case stage transition evaluator. Respond with JSON only.',
      messages: [
        { role: 'user', content: `${prompt}\n\nCase context:\n${contextBlock}` },
      ],
    })

    const text = (msg.content[0] as any)?.text || ''
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          shouldTransition: !!parsed.shouldTransition,
          nextStage: parsed.nextStage || nextStage || undefined,
          reason: parsed.reason || 'evaluation complete',
        }
      }
    } catch {
      // fall through
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

  /** Generate a nudge message when the LLM fails to call required tools. */
  buildNudge(stage: string): string {
    const cfg = this.getStageConfig(stage)
    const parts: string[] = ['[SYSTEM NUDGE]']

    const skillCheck = this.checkRequiredSkills(stage)
    if (!skillCheck.met) {
      parts.push(`Stage "${stage}" requires these tools to be called: ${skillCheck.missing.join(', ')}.`)
      parts.push('You MUST call them using the tool calling mechanism. Do not just describe what you will do — actually call the tools now.')
    }

    const evidenceCheck = this.checkEvidenceRequirements(stage)
    if (!evidenceCheck.met) {
      const userMissing = cfg?.evidenceRequirements
        ?.filter((e) => evidenceCheck.missing.includes(e.factKey) && e.source === 'user_input')
        .map((e) => e.description) || []
      const skillMissing = cfg?.evidenceRequirements
        ?.filter((e) => evidenceCheck.missing.includes(e.factKey) && e.source === 'skill_output')
        .map((e) => e.description) || []

      if (userMissing.length) {
        parts.push(`Missing info from customer: ${userMissing.join(', ')}. Use request_user_input to collect it.`)
      }
      if (skillMissing.length) {
        parts.push(`Missing evidence from skills: ${skillMissing.join(', ')}. Call the required tools.`)
      }
    }

    if (parts.length === 1) {
      parts.push('Take action — call tools or request input. Do not end the turn without progress.')
    }

    return parts.join('\n')
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private loadStageConfigs(): Record<string, StageConfig> {
    // 1. CaseSchema has explicit stageConfigs → use them
    if (this.caseSchema.stageConfigs && Object.keys(this.caseSchema.stageConfigs).length > 0) {
      return this.caseSchema.stageConfigs
    }

    // 2. Fall back to defaults for known case types
    const defaults = (DEFAULT_STAGE_CONFIGS as Record<string, Record<string, unknown>>)[this.caseSchema.type]
    if (defaults) {
      return defaults as Record<string, StageConfig>
    }

    // 3. No stage configs — gated execution disabled (backward compat)
    return {}
  }
}
