import type { ToolDefinition } from '@intera/shared/types'
import { parseKnowledgeSourceGroupIds } from '@/lib/knowledge/source-groups'
import { knowledgeSourceToolName, stableToolNameSegment } from './tool-names'

export const UNIFIED_KNOWLEDGE_TOOL_ENV = 'INTERA_UNIFIED_KNOWLEDGE_TOOL'
export const UNIFIED_KNOWLEDGE_TOOL_NAME = 'search_knowledge'
export const KNOWLEDGE_PROVIDER_GPTBOTS = 'gptbots'

export interface KnowledgeSourceRuntimeRow {
  id: string
  name: string
  description: string | null
  groupIds: string | string[] | null
  topK: number
  embeddingRate: number
  docCorrelation: number | null
  rerankVersion: string | null
  modelControlTopK: boolean
}

export interface KnowledgeSourceOption {
  id: string
  key: string
  name: string
  description?: string
  groupIds: string[]
  topK: number
  embeddingRate: number
  docCorrelation: number | null
  rerankVersion: string | null
  modelControlTopK: boolean
  legacyToolName: string
}

export interface KnowledgeSourceDefinitionRef {
  id: string
  key: string
  name: string
  description?: string
  legacyToolName: string
}

export function isUnifiedKnowledgeToolEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[UNIFIED_KNOWLEDGE_TOOL_ENV]?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function isUnifiedKnowledgeToolName(name: string | undefined): boolean {
  return name === UNIFIED_KNOWLEDGE_TOOL_NAME
}

export function isLegacyKnowledgeToolName(name: string | undefined): boolean {
  return typeof name === 'string' && name.startsWith('kb_search_')
}

export function isKnowledgeToolName(name: string | undefined): boolean {
  return isUnifiedKnowledgeToolName(name) || isLegacyKnowledgeToolName(name)
}

export function isKnowledgeToolDefinition(definition: Pick<ToolDefinition, 'name' | 'knowledgeSourceId' | 'knowledgeProvider'> | undefined): boolean {
  if (!definition) return false
  return isKnowledgeToolName(definition.name) || !!definition.knowledgeSourceId || definition.knowledgeProvider === KNOWLEDGE_PROVIDER_GPTBOTS
}

export function providerVisibleToolDefinitions(definitions: ToolDefinition[]): ToolDefinition[] {
  return definitions.filter((definition) => definition.enabled && !definition.providerHidden)
}

export function toolNeedsMemberId(definition: ToolDefinition): boolean {
  const schema = definition.inputSchema as { properties?: Record<string, unknown> } | null | undefined
  return !!schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, 'member_id')
}

export function toolSummariesFromDefinitions(definitions: ToolDefinition[]): Array<{
  name: string
  description: string
  needsMemberId: boolean
  knowledgeSourceId?: string
  knowledgeProvider?: string
  knowledgeTool?: boolean
}> {
  return providerVisibleToolDefinitions(definitions).map((definition) => ({
    name: definition.name,
    description: definition.description,
    needsMemberId: toolNeedsMemberId(definition),
    knowledgeSourceId: definition.knowledgeSourceId,
    knowledgeProvider: definition.knowledgeProvider,
    knowledgeTool: isKnowledgeToolDefinition(definition),
  }))
}

export function buildKnowledgeSourceOptions(
  sources: KnowledgeSourceRuntimeRow[],
  refs: KnowledgeSourceDefinitionRef[] = [],
): KnowledgeSourceOption[] {
  const keyById = new Map(refs.map((ref) => [ref.id, ref.key]))
  const legacyToolNameById = new Map(refs.map((ref) => [ref.id, ref.legacyToolName]))
  const usedKeys = new Map<string, number>()
  const options: KnowledgeSourceOption[] = []

  for (const source of sources) {
    const groupIds = parseKnowledgeSourceGroupIds(source.groupIds)
    if (groupIds.length === 0) continue

    const configuredKey = keyById.get(source.id)
    const baseKey = configuredKey?.trim()
      || stableToolNameSegment(source.name, '')
      || 'source'
    const seen = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, seen + 1)
    const key = seen === 0 ? baseKey : `${baseKey}_${seen + 1}`
    options.push({
      id: source.id,
      key,
      name: source.name,
      description: source.description?.trim() || undefined,
      groupIds,
      topK: source.topK,
      embeddingRate: source.embeddingRate,
      docCorrelation: source.docCorrelation,
      rerankVersion: source.rerankVersion,
      modelControlTopK: source.modelControlTopK,
      legacyToolName: legacyToolNameById.get(source.id)?.trim() || knowledgeSourceToolName(source.name, source.id),
    })
  }

  return options
}

export function buildKnowledgeSourceRefs(options: KnowledgeSourceOption[]): KnowledgeSourceDefinitionRef[] {
  return options.map((option) => ({
    id: option.id,
    key: option.key,
    name: option.name,
    description: option.description,
    legacyToolName: option.legacyToolName,
  }))
}

export function buildUnifiedKnowledgeToolDescription(options: KnowledgeSourceOption[]): string {
  const sourceLines = options.map((option) => {
    const description = option.description || `Search the "${option.name}" knowledge base`
    return `- source="${option.key}" - ${option.name}: ${description}`
  })
  return [
    'Search the configured knowledge bases for factual support answers, FAQs, policies, catalog details, contact info, and how-to guidance.',
    'If older instructions mention a kb_search_* tool, call search_knowledge instead and choose the matching source.',
    'Available sources:',
    ...sourceLines,
    'When more than one source is available, source is required. topK is clamped to 1-15 and honored only for sources that allow model-controlled topK.',
  ].join('\n')
}

export function buildUnifiedKnowledgeToolDefinition(
  options: KnowledgeSourceOption[],
  gptbotsApiKey: string,
): ToolDefinition | null {
  if (options.length === 0) return null

  const sourceEnum = options.map((option) => option.key)
  return {
    name: UNIFIED_KNOWLEDGE_TOOL_NAME,
    description: buildUnifiedKnowledgeToolDescription(options),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query in the user\'s language.' },
        source: {
          type: 'string',
          enum: sourceEnum,
          description: 'Knowledge source key. Required when more than one source is available.',
        },
        topK: {
          type: 'number',
          description: 'Optional number of results to return. Runtime clamps to 1-15 and honors this only when the selected source allows it.',
          default: options[0]?.topK ?? 15,
        },
      },
      required: options.length > 1 ? ['query', 'source'] : ['query'],
    },
    mode: 'http',
    endpoint: 'https://api-sg.gptbots.ai/v1/vector/match',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${gptbotsApiKey}` },
    timeoutMs: 10000,
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Searching knowledge', icon: 'dots' },
    knowledgeProvider: KNOWLEDGE_PROVIDER_GPTBOTS,
    knowledgeSources: buildKnowledgeSourceRefs(options),
  }
}

export function normalizeKnowledgeSourceSelector(value: string): string {
  return stableToolNameSegment(value, '')
}
