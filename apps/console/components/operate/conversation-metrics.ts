export interface ConversationTraceMetricItem {
  actionType: string
  title: string
  payload: string | null
  createdAt: string
}

export interface ConversationMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  compactTokens: number
  turnWallMs: number
  toolPhaseMs: number
  llmCalls: number
}

export function computeConversationMetrics(traces: ConversationTraceMetricItem[]): ConversationMetrics {
  const metrics: ConversationMetrics = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    compactTokens: 0,
    turnWallMs: 0,
    toolPhaseMs: 0,
    llmCalls: 0,
  }

  let firstTs: number | null = null
  let lastTs: number | null = null
  let explicitWallMs = 0
  let explicitToolPhaseMs = 0

  for (const trace of traces) {
    const ts = new Date(trace.createdAt).getTime()
    if (firstTs == null || ts < firstTs) firstTs = ts
    if (lastTs == null || ts > lastTs) lastTs = ts

    let payload: Record<string, unknown> | null = null
    if (trace.payload) {
      try {
        payload = JSON.parse(trace.payload) as Record<string, unknown>
      } catch {
        payload = null
      }
    }

    if (trace.actionType === 'llm_response' && payload) {
      const usage = (payload.usage ?? {}) as Record<string, number>
      metrics.inputTokens += usage.input_tokens ?? usage.inputTokens ?? 0
      metrics.outputTokens += usage.output_tokens ?? usage.outputTokens ?? 0
      metrics.cacheReadTokens += usage.cache_read_input_tokens ?? 0
      metrics.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
      metrics.compactTokens += (payload as Record<string, number>).compactTokens ?? 0
      metrics.totalTokens += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      metrics.llmCalls++
    }

    if (trace.actionType === 'tool_result' && typeof payload?.latencyMs === 'number') {
      explicitToolPhaseMs += payload.latencyMs
    }

    if (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot' && payload) {
      if (typeof payload.wallMs === 'number') explicitWallMs += payload.wallMs
      if (typeof payload.toolsWallMs === 'number') explicitToolPhaseMs += payload.toolsWallMs
    }
  }

  if (explicitWallMs > 0) {
    metrics.turnWallMs = explicitWallMs
  } else if (firstTs != null && lastTs != null) {
    metrics.turnWallMs = lastTs - firstTs
  }

  if (explicitToolPhaseMs > 0) {
    metrics.toolPhaseMs = explicitToolPhaseMs
  }

  return metrics
}
