export type ProcedureToolOutcome = 'succeeded' | 'failed' | 'empty_result' | 'schema_invalid' | 'requested'

export interface ProcedureToolAssessment {
  outcome: ProcedureToolOutcome
  label: string
  error?: string
}

export function assessProcedureToolOutcome(
  toolName: string,
  toolOutput: unknown,
  toolError?: string,
  isKnowledgeTool = false,
): ProcedureToolAssessment {
  if (toolError?.trim()) {
    return {
      outcome: 'failed',
      label: `${toolName} failed`,
      error: toolError.trim(),
    }
  }

  if (toolName === 'create_human_task') {
    if (isRecord(toolOutput) && toolOutput.persisted === true && typeof toolOutput.taskId === 'string') {
      return { outcome: 'succeeded', label: 'Human handoff persisted' }
    }
    if (isRecord(toolOutput) && typeof toolOutput.taskId === 'string' && toolOutput.status === 'pending') {
      return { outcome: 'requested', label: 'Human handoff requested but not yet persisted' }
    }
    return { outcome: 'schema_invalid', label: 'Human handoff returned an unexpected payload' }
  }

  if (isKnowledgeTool) {
    if (Array.isArray(toolOutput)) {
      return toolOutput.length > 0
        ? { outcome: 'succeeded', label: 'Knowledge search returned hits' }
        : { outcome: 'empty_result', label: 'Knowledge search returned no hits' }
    }
    if (isRecord(toolOutput) && Array.isArray(toolOutput.hits)) {
      return toolOutput.hits.length > 0
        ? { outcome: 'succeeded', label: 'Knowledge search returned hits' }
        : { outcome: 'empty_result', label: 'Knowledge search returned no hits' }
    }
    if (isRecord(toolOutput) && Array.isArray(toolOutput.list)) {
      return toolOutput.list.length > 0
        ? { outcome: 'succeeded', label: 'Knowledge search returned hits' }
        : { outcome: 'empty_result', label: 'Knowledge search returned no hits' }
    }
    return { outcome: 'schema_invalid', label: 'Knowledge search returned an unexpected payload' }
  }

  if (toolOutput == null) {
    return { outcome: 'empty_result', label: `${toolName} returned no payload` }
  }
  if (Array.isArray(toolOutput)) {
    return toolOutput.length > 0
      ? { outcome: 'succeeded', label: `${toolName} returned data` }
      : { outcome: 'empty_result', label: `${toolName} returned an empty list` }
  }
  if (isRecord(toolOutput)) {
    if (toolOutput.ok === false || toolOutput.success === false) {
      return {
        outcome: 'failed',
        label: `${toolName} reported a failed result`,
        error: typeof toolOutput.error === 'string'
          ? toolOutput.error
          : Array.isArray(toolOutput.errors)
            ? toolOutput.errors.join('; ')
            : isRecord(toolOutput.errors)
              ? Object.entries(toolOutput.errors).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('; ')
              : undefined,
      }
    }
    if (typeof toolOutput.error === 'string' && toolOutput.error.trim().length > 0) {
      return {
        outcome: 'failed',
        label: `${toolName} reported an error`,
        error: toolOutput.error.trim(),
      }
    }
    if (Array.isArray(toolOutput.errors) && toolOutput.errors.length > 0) {
      return {
        outcome: 'failed',
        label: `${toolName} reported validation errors`,
        error: toolOutput.errors.map((entry) => String(entry)).join('; '),
      }
    }
    if (isRecord(toolOutput.errors) && Object.keys(toolOutput.errors).length > 0) {
      return {
        outcome: 'failed',
        label: `${toolName} reported field errors`,
        error: Object.entries(toolOutput.errors).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('; '),
      }
    }
    if (Object.keys(toolOutput).length === 0 || !hasSubstantiveToolPayload(toolOutput)) {
      return { outcome: 'empty_result', label: `${toolName} returned an empty object` }
    }
    return { outcome: 'succeeded', label: `${toolName} returned data` }
  }
  if (typeof toolOutput === 'string' && toolOutput.trim().length === 0) {
    return { outcome: 'empty_result', label: `${toolName} returned an empty string` }
  }
  return { outcome: 'succeeded', label: `${toolName} returned data` }
}

export function blockerForToolAssessment(
  toolName: string,
  assessment: ProcedureToolAssessment,
): string | undefined {
  switch (assessment.outcome) {
    case 'failed':
      return `${toolName} failed${assessment.error ? `: ${assessment.error}` : '.'} Retry, ask a clarifying question, or hand off safely before proceeding.`
    case 'empty_result':
      return `${toolName} returned no usable result. Ask a clarifying question, retry with a better query, or hand off safely before proceeding.`
    case 'schema_invalid':
      return `${toolName} returned an unexpected payload. Treat it as unusable and recover before proceeding.`
    case 'requested':
      return `${toolName} has not produced persisted handoff evidence yet.`
    default:
      return undefined
  }
}

function hasSubstantiveToolPayload(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(([key, value]) => {
    if (['ok', 'success', 'is_v3', 'ver', 'error', 'errors', 'persisted'].includes(key)) return false
    return hasSubstantiveToolValue(value)
  })
}

function hasSubstantiveToolValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.values(value).some((entry) => hasSubstantiveToolValue(entry))
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
