// Shared UserProfile merge utilities — used by agent loop + Console compact route.

/**
 * Merge a new compact summary into the existing UserProfile Markdown document.
 * - Appends new summary under a dated header
 * - Truncates oldest content at paragraph boundaries when over maxTokens
 * - Does NOT cut in the middle of a paragraph or heading
 */
export function mergeProfile(oldProfile: string, newSummary: string, maxTokens: number): string {
  const now = new Date().toISOString().slice(0, 10)
  const header = `\n\n## Compacted ${now}\n\n`

  const candidate = oldProfile
    ? `${oldProfile}${header}${newSummary}`
    : `# User Profile (auto-generated)\n\n${newSummary}`

  if (maxTokens <= 0) return candidate

  const estimatedTokens = candidate.length / 4 // rough: 4 chars ≈ 1 token
  if (estimatedTokens <= maxTokens) return candidate

  // Truncate oldest content at paragraph boundaries (double newline = paragraph break)
  const paragraphs = candidate.split(/\n\n+/)
  let result = ''
  // Walk from the end (keep newest)
  const kept: string[] = []
  let chars = 0
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i]
    if (chars + p.length > maxTokens * 4) break
    kept.unshift(p)
    chars += p.length + 2 // account for the \n\n separator
  }
  return kept.join('\n\n')
}
