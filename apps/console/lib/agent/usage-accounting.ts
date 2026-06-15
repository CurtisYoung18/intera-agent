function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readInputTokens(usage: Record<string, unknown> | null | undefined): number {
  return asNumber(usage?.input_tokens)
    ?? asNumber(usage?.inputTokens)
    ?? asNumber(usage?.prompt_tokens)
    ?? 0
}

export function readOutputTokens(usage: Record<string, unknown> | null | undefined): number {
  return asNumber(usage?.output_tokens)
    ?? asNumber(usage?.outputTokens)
    ?? asNumber(usage?.completion_tokens)
    ?? 0
}

export function readCacheReadTokens(usage: Record<string, unknown> | null | undefined): number {
  const promptDetails = asRecord(usage?.prompt_tokens_details)
  return asNumber(usage?.cache_read_input_tokens)
    ?? asNumber(promptDetails?.cached_tokens)
    ?? 0
}

export function readCacheWriteTokens(usage: Record<string, unknown> | null | undefined): number {
  const promptDetails = asRecord(usage?.prompt_tokens_details)
  return asNumber(usage?.cache_creation_input_tokens)
    ?? asNumber(promptDetails?.cache_write_tokens)
    ?? 0
}

export function hasRecognizedTokenUsage(usage: Record<string, unknown> | null | undefined): boolean {
  return asNumber(usage?.input_tokens) != null
    || asNumber(usage?.inputTokens) != null
    || asNumber(usage?.prompt_tokens) != null
    || asNumber(usage?.output_tokens) != null
    || asNumber(usage?.outputTokens) != null
    || asNumber(usage?.completion_tokens) != null
}
