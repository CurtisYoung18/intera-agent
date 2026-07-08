import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@intera/shared/types'
import type { PlaygroundCapabilityTruth } from '../../trace-aggregator'
import { enrichTraceRecord } from '../../playground-runner'

const capabilityTruth: PlaygroundCapabilityTruth = {
  model: 'test-model',
  imageSupport: {
    status: 'supported',
    label: 'Supported',
    source: 'configured_model_registry',
  },
  executionSurface: {
    mode: 'runtime_only',
    label: 'Runtime-backed surface',
  },
  toolSummary: {
    mockedDryRun: 0,
    runtimeBacked: 1,
    runtimeManaged: 0,
    staticFixture: 0,
    unknown: 0,
  },
  warnings: [],
}

function searchKnowledgeDefinition(): ToolDefinition {
  return {
    name: 'search_knowledge',
    description: 'Search knowledge',
    inputSchema: { type: 'object', properties: {}, required: [] },
    mode: 'http',
    endpoint: 'https://example.test/vector/match',
    httpMethod: 'POST',
    timeoutMs: 1000,
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'system_info',
    knowledgeProvider: 'gptbots',
  }
}

describe('playground trace enrichment', () => {
  it('preserves dynamic search_knowledge source metadata from the trace payload', () => {
    const enriched = enrichTraceRecord(
      {
        caseId: 'case-1',
        actionType: 'tool_result',
        title: 'Tool: search_knowledge',
        payload: JSON.stringify({
          toolName: 'search_knowledge',
          knowledgeSourceId: 'kb_deposit_123456',
          knowledgeSourceName: 'Deposit Bonus',
          knowledgeProvider: 'gptbots',
        }),
      },
      new Map([['search_knowledge', searchKnowledgeDefinition()]]),
      capabilityTruth,
      false,
    )

    const payload = JSON.parse(enriched.payload ?? '{}')
    expect(payload).toMatchObject({
      toolName: 'search_knowledge',
      knowledgeSourceId: 'kb_deposit_123456',
      knowledgeSourceName: 'Deposit Bonus',
      knowledgeProvider: 'gptbots',
      executionTruth: {
        effectiveMode: 'runtime_backed',
        label: 'Runtime-backed knowledge tool',
      },
    })
  })
})
