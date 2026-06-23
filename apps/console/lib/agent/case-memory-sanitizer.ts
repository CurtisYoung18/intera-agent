const RAW_PROVIDER_TRANSCRIPT_PATTERNS = [
  /\[(?:assistant\s+)?tool_use\b/i,
  /\[(?:user\s+)?tool_result\b/i,
  /\btool_use_id\b/i,
  /\bproviderContent\b/i,
  /\btranscriptKind\b/i,
]

function isRawProviderTranscriptLine(line: string): boolean {
  return RAW_PROVIDER_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(line))
}

export function sanitizeCaseMemorySummary(summary: string): string {
  const lines = summary
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !isRawProviderTranscriptLine(line))

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
