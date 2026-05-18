/**
 * Case slugs used only as DB / session defaults — not real investigation workflows.
 * These must not open the split rail or consume intent as a routable case type.
 */
const PLACEHOLDER_SLUGS = new Set(['general'])

export function isInvestigableCaseType(type: string | undefined | null): boolean {
  if (type == null || typeof type !== 'string') return false
  const s = type.trim().toLowerCase()
  return s.length > 0 && !PLACEHOLDER_SLUGS.has(s)
}
