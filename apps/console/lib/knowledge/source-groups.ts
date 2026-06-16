export function parseKnowledgeSourceGroupIds(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item): item is string => item.length > 0)
  }

  if (typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item): item is string => item.length > 0)
    }
  } catch {
    // Plain string inputs are still accepted as a single group id.
  }

  return [trimmed]
}

export function hasKnowledgeSourceGroupIds(raw: string | string[] | null | undefined): boolean {
  return parseKnowledgeSourceGroupIds(raw).length > 0
}
