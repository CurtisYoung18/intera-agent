export function stableToolNameSegment(value: string | null | undefined, fallback = 'source'): string {
  const normalized = (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || fallback
}

export function knowledgeSourceToolName(name: string | null | undefined, sourceId?: string | null): string {
  const segment = stableToolNameSegment(name, '')
  const fallback = stableToolNameSegment(sourceId, 'source')
  return `kb_search_${segment || fallback}`
}
