/** Display suffix after stripping optional `case_` prefix; truncated for headings. */
export function caseIdSuffix(id: string, maxLen = 14): string {
  const suffix = id.replace(/^case_/i, '')
  if (suffix.length <= maxLen) return suffix
  return `${suffix.slice(0, maxLen)}…`
}

export function caseIdBadge(id: string): { short: string; titleAttr: string } {
  return { short: `#${caseIdSuffix(id)}`, titleAttr: id }
}
