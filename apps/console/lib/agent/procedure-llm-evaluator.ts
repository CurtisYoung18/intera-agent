import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { AgentConfigData } from '@intera/shared/types'
import { createAgentClient } from './api/provider-config'
import { withRetry } from './api/with-retry'
import type {
  PendingProcedureLlmEvaluation,
  ProcedureConditionEvaluationDecision,
} from './session-store'

export interface ProcedureLlmEvaluationResult {
  decision: ProcedureConditionEvaluationDecision
  reason: string
  model: string
  metadata?: Record<string, unknown>
}

export function resolveProcedureEvaluationModel(config: AgentConfigData): string {
  return (
    process.env.PROCEDURE_EVALUATION_MODEL ||
    config.memoryStrategy.factExtractionModel ||
    config.fallbackModel ||
    config.model
  )
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex')
}

function sanitizeEvaluationReason(reason: string): string {
  const trimmed = reason.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 240) return trimmed
  return `${trimmed.slice(0, 237)}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function summarizePromptValue(value: unknown, limit = 320): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, Math.max(0, limit - 3))}...`
}

function summarizeEvidenceForPrompt(
  entry: PendingProcedureLlmEvaluation['recentEvidence'][number],
): string {
  const summaryParts = [`- ${entry.kind}`]
  if (entry.stepId) summaryParts.push(`step=${entry.stepId}`)
  if (entry.actionId) summaryParts.push(`action=${entry.actionId}`)
  if (entry.branchId) summaryParts.push(`branch=${entry.branchId}`)
  if (entry.toolName) summaryParts.push(`toolName=${entry.toolName}`)
  if (typeof entry.basedOnInputEpoch === 'number') summaryParts.push(`epoch=${entry.basedOnInputEpoch}`)
  summaryParts.push(`state=${entry.state}`)

  const metadata = isRecord(entry.metadata) ? entry.metadata : null
  if (typeof metadata?.outcome === 'string') summaryParts.push(`outcome=${metadata.outcome}`)
  if (typeof metadata?.field === 'string') summaryParts.push(`field=${metadata.field}`)
  if ('value' in (metadata ?? {})) {
    const valueSummary = summarizePromptValue(metadata?.value, 160)
    if (valueSummary) summaryParts.push(`value=${valueSummary}`)
  }
  if ('output' in (metadata ?? {})) {
    const outputSummary = summarizePromptValue(metadata?.output, 480)
    if (outputSummary) summaryParts.push(`output=${outputSummary}`)
  }
  if (typeof metadata?.error === 'string' && metadata.error.trim().length > 0) {
    summaryParts.push(`error=${summarizePromptValue(metadata.error, 200)}`)
  }
  if (typeof metadata?.reason === 'string' && metadata.reason.trim().length > 0) {
    summaryParts.push(`reason=${summarizePromptValue(metadata.reason, 200)}`)
  }

  return `${summaryParts.join(' ')}: ${entry.label}`
}

function buildEvaluationMetadata(
  task: PendingProcedureLlmEvaluation,
  prompt: string,
): Record<string, unknown> {
  return {
    conditionId: task.conditionId,
    basedOnInputEpoch: task.basedOnInputEpoch,
    promptHash: promptHash(prompt),
    recentInputCount: task.recentInputs.length,
    recentEvidenceCount: task.recentEvidence.length,
    source: 'provider_evaluator',
  }
}

export async function evaluateProcedureLlmCondition(
  task: PendingProcedureLlmEvaluation,
  config: AgentConfigData,
  client?: Anthropic,
): Promise<ProcedureLlmEvaluationResult> {
  const model = resolveProcedureEvaluationModel(config)
  const recordTool: Anthropic.Tool = {
    name: 'record_procedure_evaluation',
    description: 'Return the branch decision for this Procedure condition exactly once.',
    input_schema: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          enum: ['matched', 'skipped', 'pending'],
        },
        reason: {
          type: 'string',
        },
      },
      required: ['decision', 'reason'],
    },
  }

  const prompt = [
    `Procedure: ${task.procedureDisplayName} (${task.procedureId})`,
    `Run: ${task.runId}`,
    `Step: ${task.stepId}${task.stepTitle ? ` — ${task.stepTitle}` : ''}`,
    `Branch: ${task.branchId}${task.branchLabel ? ` — ${task.branchLabel}` : ''}`,
    `Condition prompt: ${task.prompt}`,
    `Current input epoch: ${task.basedOnInputEpoch}`,
    '',
    'Recent structured inputs:',
    ...task.recentInputs.map((entry) => {
      const content = entry.content?.trim()
      const form = entry.formAnswers && Object.keys(entry.formAnswers).length > 0
        ? ` form=${JSON.stringify(entry.formAnswers)}`
        : ''
      return `- [epoch ${entry.inputEpoch}] ${entry.source}${form}${content ? ` content=${JSON.stringify(content.slice(0, 320))}` : ''}`
    }),
    '',
    'Recent runtime evidence:',
    ...task.recentEvidence.map((entry) => summarizeEvidenceForPrompt(entry)),
    '',
    'Rules:',
    '- Use only the structured inputs and runtime evidence provided here.',
    '- Do not treat safety hints, customer sentiment, or missing evidence as positive proof.',
    '- Return "matched" only when the condition is affirmatively satisfied.',
    '- Return "skipped" only when the condition is affirmatively disproven.',
    '- Return "pending" when evidence is insufficient, ambiguous, or the condition cannot be safely decided.',
  ].join('\n')

  try {
    const runtimeClient = client ?? createAgentClient(model)
    const response = await withRetry(
      (retryClient) => retryClient.messages.create({
        model,
        max_tokens: 256,
        temperature: 0,
        system: 'You evaluate Intera Procedure branch conditions. Use one record_procedure_evaluation tool call and do not invent evidence.',
        tools: [recordTool as Anthropic.Tool],
        messages: [{ role: 'user', content: prompt }],
      }),
      { querySource: 'main_loop', model },
      () => runtimeClient,
    ) as Anthropic.Messages.Message

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const input = (block as { input?: Record<string, unknown> }).input
      const decision = input?.decision
      const reason = typeof input?.reason === 'string'
        ? sanitizeEvaluationReason(input.reason)
        : ''
      if (
        (decision === 'matched' || decision === 'skipped' || decision === 'pending') &&
        reason.length > 0
      ) {
        return {
          decision,
          reason,
          model,
          metadata: buildEvaluationMetadata(task, prompt),
        }
      }
    }

    return {
      decision: 'error',
      reason: 'Procedure evaluator returned no usable tool call.',
      model,
      metadata: buildEvaluationMetadata(task, prompt),
    }
  } catch (error) {
    return {
      decision: 'error',
      reason: sanitizeEvaluationReason(error instanceof Error ? error.message : 'Procedure evaluator unavailable.'),
      model,
      metadata: buildEvaluationMetadata(task, prompt),
    }
  }
}
