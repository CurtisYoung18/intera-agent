function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readInputTokens(usage: Record<string, unknown> | null | undefined): number {
  const promptTokens = asNumber(usage?.prompt_tokens)
  if (promptTokens != null) return promptTokens

  const inputTokens = asNumber(usage?.input_tokens) ?? asNumber(usage?.inputTokens)
  if (inputTokens == null) return 0

  const hasIncludedCacheDetails = asRecord(usage?.input_tokens_details) != null
  const hasTopLevelCacheBuckets =
    asNumber(usage?.cache_read_input_tokens) != null ||
    asNumber(usage?.cache_creation_input_tokens) != null

  return hasTopLevelCacheBuckets && !hasIncludedCacheDetails
    ? inputTokens + readCacheReadTokens(usage) + readCacheWriteTokens(usage)
    : inputTokens
}

export function readOutputTokens(usage: Record<string, unknown> | null | undefined): number {
  return asNumber(usage?.output_tokens)
    ?? asNumber(usage?.outputTokens)
    ?? asNumber(usage?.completion_tokens)
    ?? 0
}

export function readCacheReadTokens(usage: Record<string, unknown> | null | undefined): number {
  const promptDetails = asRecord(usage?.prompt_tokens_details)
  const inputDetails = asRecord(usage?.input_tokens_details)
  return asNumber(usage?.cache_read_input_tokens)
    ?? asNumber(usage?.cacheReadTokens)
    ?? asNumber(promptDetails?.cached_tokens)
    ?? asNumber(inputDetails?.cached_tokens)
    ?? 0
}

export function readCacheWriteTokens(usage: Record<string, unknown> | null | undefined): number {
  const promptDetails = asRecord(usage?.prompt_tokens_details)
  const inputDetails = asRecord(usage?.input_tokens_details)
  return asNumber(usage?.cache_creation_input_tokens)
    ?? asNumber(usage?.cacheWriteTokens)
    ?? asNumber(promptDetails?.cache_write_tokens)
    ?? asNumber(inputDetails?.cache_write_tokens)
    ?? 0
}

export function promptTokenTotalFromParts(
  inputTokens: number | null | undefined,
  cacheReadTokens?: number | null,
  cacheWriteTokens?: number | null,
): number {
  const input = asNumber(inputTokens) ?? 0
  const cacheRead = asNumber(cacheReadTokens) ?? 0
  const cacheWrite = asNumber(cacheWriteTokens) ?? 0
  const cacheBuckets = cacheRead + cacheWrite
  return input >= cacheBuckets ? input : input + cacheBuckets
}

export function cacheHitRateFromParts(
  inputTokens: number | null | undefined,
  cacheReadTokens?: number | null,
  cacheWriteTokens?: number | null,
): number {
  const promptTotal = promptTokenTotalFromParts(inputTokens, cacheReadTokens, cacheWriteTokens)
  return promptTotal > 0 ? (cacheReadTokens ?? 0) / promptTotal : 0
}

export function hasRecognizedTokenUsage(usage: Record<string, unknown> | null | undefined): boolean {
  return asNumber(usage?.input_tokens) != null
    || asNumber(usage?.inputTokens) != null
    || asNumber(usage?.prompt_tokens) != null
    || asNumber(usage?.output_tokens) != null
    || asNumber(usage?.outputTokens) != null
    || asNumber(usage?.completion_tokens) != null
}
