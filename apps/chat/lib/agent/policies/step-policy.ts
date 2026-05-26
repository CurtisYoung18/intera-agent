// Intera Harness — StepPolicy
// HIGH-DETERMINISM execution policy for executionMode='step'.
// The engine enforces step sequences, not the LLM.
//
// Each step has a whitelist of requiredTools ∪ optionalTools. After every LLM turn,
// completionCriteria are evaluated. When all criteria pass, the engine advances to the
// next step. When all steps complete, a stage transition is signalled.
//
// Reference: doc/to-do/unified-agent-audit-and-architecture.md §2.5, §2.6

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  Message,
  AssistantMessage,
  LoopResult,
  ExecutionStep,
  StepCriterion,
  CaseMemoryData,
} from '@intera/shared/types'
import type { ExecutionPolicy, ContinueDecision, TerminalToolResult } from './types'
import type { StageExecutor } from '../stage-executor'

// ── Constructor options ─────────────────────────────────────────────

export interface StepPolicyOptions {
  /** Ordered step sequence for the current stage. */
  steps?: ExecutionStep[]
  /** Stage executor for transition evaluation after all steps complete. */
  stageExecutor?: StageExecutor
  /** SOP document appended to the prompt as an appendix. */
  sop?: string
  /** Live accessor for case memory (needed for fact_extracted criteria). */
  getCaseMemory?: () => CaseMemoryData
}

// ── StepPolicy ──────────────────────────────────────────────────────

export class StepPolicy implements ExecutionPolicy {
  private steps: ExecutionStep[]
  private stageExecutor?: StageExecutor
  private sop?: string
  private getCaseMemory?: () => CaseMemoryData

  /** 0-based index into the steps array. */
  private currentStepIndex = 0

  /** Number of consecutive turns where criteria were NOT met for the current step. */
  private retryCount = 0

  constructor(options: StepPolicyOptions = {}) {
    this.steps = options.steps ?? []
    this.stageExecutor = options.stageExecutor
    this.sop = options.sop
    this.getCaseMemory = options.getCaseMemory
  }

  // ── ExecutionPolicy: buildPrompt ──────────────────────────────────

  buildPrompt(basePrompt: string): string {
    const parts: string[] = [basePrompt]

    if (this.steps.length === 0) return basePrompt

    const step = this.currentStep
    if (!step) return basePrompt

    const stepNumber = this.currentStepIndex + 1
    const total = this.steps.length

    // ── Step header ──
    const header = [
      `\n## Current Step (${stepNumber}/${total}): ${step.name}`,
      '',
      `**Goal**: ${step.goal}`,
    ]

    if (step.requiredTools.length > 0) {
      header.push(`**Required tools**: ${step.requiredTools.join(', ')}`)
    }

    if (step.optionalTools && step.optionalTools.length > 0) {
      header.push(`**Optional tools**: ${step.optionalTools.join(', ')}`)
    }

    if (step.completionCriteria.length > 0) {
      const criteriaLines = step.completionCriteria.map(
        (c) => `  - \`${c.type}\`: ${c.value}`,
      )
      header.push(`**Completion criteria**:\n${criteriaLines.join('\n')}`)
    }

    header.push('')
    header.push(
      'You MUST complete this step before proceeding. Only call the tools listed above.',
    )

    parts.push(header.join('\n'))

    // ── SOP appendix ──
    if (this.sop) {
      parts.push(`\n## SOP (Standard Operating Procedure)\n${this.sop}`)
    }

    return parts.join('\n')
  }

  // ── ExecutionPolicy: filterTools ──────────────────────────────────

  filterTools(allTools: Tool[], _iteration: number): Tool[] {
    if (this.steps.length === 0) return allTools

    const step = this.currentStep
    if (!step) return allTools

    // Build the whitelist: required + optional from the current step.
    const allowedNames = new Set<string>(step.requiredTools)
    for (const t of step.optionalTools ?? []) {
      allowedNames.add(t)
    }

    // Terminal tools are always available so the agent can resolve/escalate
    // when all steps are complete or when onFailure triggers escalate_to_human.
    allowedNames.add('finalize_case')
    allowedNames.add('create_human_task')

    return allTools.filter((t) => allowedNames.has(t.name))
  }

  // ── ExecutionPolicy: evaluateContinuation ─────────────────────────

  evaluateContinuation(
    lastMessage: Message,
    toolResults: import('@intera/shared/types').ToolResult[],
    _iteration: number,
  ): ContinueDecision {
    // No steps configured → let the caller decide.
    if (this.steps.length === 0) {
      return { action: 'continue' }
    }

    const step = this.currentStep
    if (!step) {
      // All steps completed — signal stage transition.
      return { action: 'transition', nextStage: '' }
    }

    const maxRetries = step.maxRetries ?? 2

    // Evaluate all completion criteria for the current step.
    const criteriaMet = this.evaluateCriteria(step, lastMessage, toolResults)

    if (criteriaMet) {
      // Step complete — advance.
      this.currentStepIndex++
      this.retryCount = 0

      if (this.currentStepIndex >= this.steps.length) {
        // All steps done — signal stage transition.
        return { action: 'transition', nextStage: '' }
      }

      // More steps remain — continue the loop.
      return { action: 'continue' }
    }

    // Criteria not met — increment retry count.
    this.retryCount++

    if (this.retryCount > maxRetries) {
      return this.applyFailureAction(step)
    }

    return { action: 'continue' }
  }

  // ── ExecutionPolicy: handleTerminalTool ───────────────────────────

  handleTerminalTool(toolName: string, _input: unknown): TerminalToolResult | null {
    if (toolName === 'finalize_case') {
      return {
        type: 'handled',
        result: {
          messages: [],
          caseStatus: 'resolved' as const,
          transition: 'stage_continue' as const,
          reason: 'Case finalized via step policy',
        },
      }
    }

    if (toolName === 'create_human_task') {
      return {
        type: 'handled',
        result: {
          messages: [],
          caseStatus: 'waiting_human' as const,
          transition: 'stage_continue' as const,
          reason: 'Human task created via step policy',
        },
      }
    }

    return null
  }

  // ── Public helpers ────────────────────────────────────────────────

  /** Reset internal state (e.g. when entering a new stage). */
  reset(): void {
    this.currentStepIndex = 0
    this.retryCount = 0
  }

  /** Expose the current step for debugging / trace. */
  getCurrentStepIndex(): number {
    return this.currentStepIndex
  }

  /** Expose total step count for debugging / trace. */
  getTotalSteps(): number {
    return this.steps.length
  }

  // ── Private helpers ───────────────────────────────────────────────

  private get currentStep(): ExecutionStep | null {
    if (this.steps.length === 0) return null
    if (this.currentStepIndex >= this.steps.length) return null
    return this.steps[this.currentStepIndex]
  }

  /**
   * Evaluate all completionCriteria for the current step.
   * Returns true only when every criterion is satisfied.
   */
  private evaluateCriteria(
    step: ExecutionStep,
    lastMessage: Message,
    toolResults: import('@intera/shared/types').ToolResult[],
  ): boolean {
    if (step.completionCriteria.length === 0) return true

    // Extract tool-use names from the last assistant message.
    const calledToolNames = this.extractToolNames(lastMessage)

    // Cache confirmedFacts once (needed for fact_extracted checks).
    let confirmedFacts: Record<string, unknown> | null = null
    const getFacts = (): Record<string, unknown> => {
      if (confirmedFacts === null) {
        confirmedFacts = this.getCaseMemory?.()?.confirmedFacts ?? {}
      }
      return confirmedFacts
    }

    for (const criterion of step.completionCriteria) {
      switch (criterion.type) {
        case 'tool_called':
          if (!calledToolNames.has(criterion.value)) return false
          break

        case 'fact_extracted': {
          const facts = getFacts()
          if (!(criterion.value in facts)) return false
          break
        }

        case 'output_matches': {
          // Validate that at least one tool output satisfies the JSON schema.
          const schemaMatch = this.checkOutputMatches(criterion.value, toolResults)
          if (!schemaMatch) return false
          break
        }

        case 'llm_evaluation':
          // Deferred — LLM-based evaluation is not yet implemented.
          // The loop engine (or a higher-level component) will handle this.
          // For now, this criterion does NOT block advancement.
          break

        default:
          console.warn(`[StepPolicy] Unknown criterion type: ${(criterion as any).type}`)
          break
      }
    }

    return true
  }

  /**
   * Extract unique tool names called in the last assistant turn.
   */
  private extractToolNames(message: Message): Set<string> {
    const names = new Set<string>()

    if (message.role !== 'assistant') return names

    const assistantMsg = message as AssistantMessage
    if (!assistantMsg.toolUses || assistantMsg.toolUses.length === 0) return names

    for (const tu of assistantMsg.toolUses) {
      if (tu.name) names.add(tu.name)
    }

    return names
  }

  /**
   * Check whether any tool output matches the given JSON schema string.
   * The schema value is expected to be a JSON Schema object (serialized as JSON).
   * This is a lightweight structural check — full JSON Schema validation
   * can be added later via ajv or zod.
   */
  private checkOutputMatches(
    schemaJson: string,
    toolResults: import('@intera/shared/types').ToolResult[],
  ): boolean {
    if (toolResults.length === 0) return false

    let schema: Record<string, unknown>
    try {
      schema = JSON.parse(schemaJson) as Record<string, unknown>
    } catch {
      console.warn(`[StepPolicy] Invalid output_matches schema JSON: ${schemaJson.slice(0, 100)}`)
      return false
    }

    // Collect required properties from the schema (if it has "properties").
    const requiredKeys: string[] =
      (schema.required as string[] | undefined) ??
      (schema.properties ? Object.keys(schema.properties as object) : [])

    if (requiredKeys.length === 0) {
      // No structural requirements — any non-null output passes.
      return toolResults.some((r) => r.output != null)
    }

    // Check each tool result: does its output contain all required keys?
    return toolResults.some((r) => {
      if (r.output == null || typeof r.output !== 'object') return false
      const output = r.output as Record<string, unknown>
      return requiredKeys.every((key) => key in output)
    })
  }

  /**
   * Apply the onFailure action when maxRetries is exceeded.
   */
  private applyFailureAction(step: ExecutionStep): ContinueDecision {
    const failure = step.onFailure
    const action = failure.action

    switch (action) {
      case 'retry':
        // Reset retry count and try again.
        this.retryCount = 0
        return { action: 'continue' }

      case 'skip_step':
        // Skip this step and advance.
        this.currentStepIndex++
        this.retryCount = 0

        if (this.currentStepIndex >= this.steps.length) {
          return { action: 'transition', nextStage: '' }
        }
        return { action: 'continue' }

      case 'escalate_to_human':
        return {
          action: 'stop',
          reason: failure.escalationNote ?? `Step "${step.name}" failed after max retries — escalating to human (queue: ${failure.escalationQueue ?? 'general'})`,
        }

      case 'abort_case':
        return {
          action: 'stop',
          reason: `Step "${step.name}" failed after max retries — aborting case`,
          isError: true,
        }

      default:
        return {
          action: 'stop',
          reason: `Step "${step.name}" failed after max retries — unknown failure action: ${action}`,
          isError: true,
        }
    }
  }
}
