export const UNIFIED_KNOWLEDGE_DISPLAY_NAME = 'search_knowledge'
export const LEGACY_KNOWLEDGE_TOOL_PREFIX = 'kb_search_'

export interface KnowledgeToolDisplayInput {
  toolName?: string | null
  payload?: unknown
  knowledgeSourceName?: string | null
  knowledgeSourceKey?: string | null
  fallback?: string
}

export interface KnowledgeToolDisplay {
  label: string
  rawName?: string
  sourceLabel?: string
  isKnowledge: boolean
  isLegacy: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanToolName(value: unknown): string | null {
  const raw = cleanString(value)
  if (!raw) return null
  const matched = raw.match(/Tool(?: called| result)?:\s*([A-Za-z0-9_-]+)/i)
  return matched?.[1]?.trim() || raw
}

export function isLegacyKnowledgeToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(LEGACY_KNOWLEDGE_TOOL_PREFIX)
}

export function isUnifiedKnowledgeToolName(name: string | null | undefined): boolean {
  return name === UNIFIED_KNOWLEDGE_DISPLAY_NAME
}

export function isKnowledgeToolName(name: string | null | undefined): boolean {
  return isUnifiedKnowledgeToolName(name) || isLegacyKnowledgeToolName(name)
}

export function knowledgeSourceKeyFromLegacyToolName(name: string | null | undefined): string | null {
  if (!isLegacyKnowledgeToolName(name)) return null
  return name!.slice(LEGACY_KNOWLEDGE_TOOL_PREFIX.length).trim() || null
}

export function humanizeKnowledgeSource(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const spaced = trimmed
    .replace(/^kb_search_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return null
  return spaced
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(' ')
}

export function knowledgeSourceDisplayLabel(sourceName: string, sourceId?: string | null): string {
  return `${UNIFIED_KNOWLEDGE_DISPLAY_NAME} · ${humanizeKnowledgeSource(sourceName) ?? sourceId ?? 'Source'}`
}

export function knowledgeToolDisplay(input: KnowledgeToolDisplayInput): KnowledgeToolDisplay {
  const payload = asRecord(input.payload)
  const nestedInput = asRecord(payload?.input)
  const toolName = cleanToolName(input.toolName)
    ?? cleanToolName(payload?.toolName)
    ?? cleanToolName(input.fallback)

  const sourceName =
    cleanString(input.knowledgeSourceName) ??
    cleanString(payload?.knowledgeSourceName)
  const sourceKey =
    cleanString(input.knowledgeSourceKey) ??
    cleanString(payload?.knowledgeSourceKey) ??
    cleanString(nestedInput?.source) ??
    cleanString(payload?.source) ??
    knowledgeSourceKeyFromLegacyToolName(toolName)
  const sourceLabel = humanizeKnowledgeSource(sourceName ?? sourceKey)

  const isLegacy = isLegacyKnowledgeToolName(toolName)
  const isKnowledge =
    isLegacy ||
    isUnifiedKnowledgeToolName(toolName) ||
    cleanString(payload?.knowledgeProvider) != null ||
    cleanString(payload?.knowledgeSourceId) != null ||
    sourceLabel != null && toolName === UNIFIED_KNOWLEDGE_DISPLAY_NAME

  if (!isKnowledge) {
    return {
      label: toolName ?? input.fallback ?? '',
      rawName: toolName ?? undefined,
      isKnowledge: false,
      isLegacy: false,
    }
  }

  return {
    label: sourceLabel
      ? `${UNIFIED_KNOWLEDGE_DISPLAY_NAME} · ${sourceLabel}`
      : UNIFIED_KNOWLEDGE_DISPLAY_NAME,
    rawName: toolName ?? undefined,
    sourceLabel: sourceLabel ?? undefined,
    isKnowledge: true,
    isLegacy,
  }
}

export function normalizeExpectedKnowledgeToolName(name: string): string {
  return isLegacyKnowledgeToolName(name) ? UNIFIED_KNOWLEDGE_DISPLAY_NAME : name
}
