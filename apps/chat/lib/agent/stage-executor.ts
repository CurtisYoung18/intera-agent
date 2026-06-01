// Intera Harness - Stage Executor
// Stage-gated execution engine that enforces case schema flow.
// Each stage defines: required skills, evidence requirements, guardrails,
// tool allowlist, model/prompt overrides, and transition evaluation rules.

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  CaseSchemaConfig,
  StageConfig,
  StageGuardrail,
  EvidenceRequirement,
  AgentConfigData,
  ChatMemoryData,
} from '@intera/shared/types'
import { DEFAULT_STAGE_CONFIGS } from '@intera/shared/defaults'
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
}

export class StageExecutor {
  private stageConfigs: Record<string, StageConfig>
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
        forced.add('propose_cases')
        forced.add('finalize_consultation')
        return allTools.filter((t) => forced.has(t.name))
      }
    }

    const allowed = new Set(cfg.availableSkills)
    // Always allow terminal tools regardless of stage
    allowed.add('create_human_task')
    allowed.add('finalize_case')
    allowed.add('request_user_input')
    allowed.add('propose_cases')
    // finalize_consultation is the terminal tool for human-chat consultation mode.
    // Adding it here is safe: customer-facing chat won't call it because it has no
    // reason to (no human task context), and the human-chat agent MUST be able to
    // call it to complete the consultation.
    allowed.add('finalize_consultation')

    // Prevent duplicate case creation — when a case is already active (past "created"
    // stage), remove dispatch_case_agent so the agent doesn't call it again. propose_cases
    // stays available for multi-intent situations at any stage.
    if (stage !== 'created') {
      allowed.delete('dispatch_case_agent')
    }

    // When the case was created from an intent selection card, remove propose_cases
    // entirely — the user already made their choice. Prompt-based guards are not
    // reliable enough for this critical path.
    if (this.bootstrapNewCase) {
      allowed.delete('propose_cases')
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
